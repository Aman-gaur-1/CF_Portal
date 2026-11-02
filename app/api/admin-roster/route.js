import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { hashStudentPasswordSecure } from '@/lib/student-auth'
import {
  ROSTER_HEADERS,
  classifyRosterRows,
  createRosterTemplateBuffer,
  generateLoginId,
  generateTemporaryPassword,
  hashRosterFile,
  loadUsedLoginIds,
  parseRosterBuffer,
} from '@/lib/roster-import'
import { isMissingHealthCardSchema, isUniqueViolation } from '@/lib/student-health-card'
import { normalizeParticipantName } from '@/lib/attendance-matching'
import { loadBatchAliases, saveAlias } from '@/lib/attendance-domain'
import { reconcileWaitingAttendanceSafely } from '@/lib/attendance-reconciliation'
import { appendActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

function safeClassifiedRow(row) {
  const matched = row.matchedStudent
  return {
    rowNumber: row.rowNumber,
    name: row.name,
    email: row.email,
    phone: row.phone,
    externalStudentId: row.externalStudentId,
    teamsDisplayName: row.teamsDisplayName,
    status: row.status,
    reason: row.reason,
    matchedStudent: matched ? {
      id: matched.id,
      name: matched.name,
      batch: matched.batch,
      loginId: matched.login_id || null,
      status: matched.status || 'active',
    } : null,
  }
}

async function readRoster(request) {
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  const batch = String(formData?.get('batch') || '').trim()
  const action = String(formData?.get('action') || 'preview').trim().toLowerCase()
  if (!formData || !file || typeof file === 'string') return { error: 'A roster file is required.' }
  if (!batch) return { error: 'Batch is required.' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Roster file exceeds the 5 MB limit.' }
  const buffer = Buffer.from(await file.arrayBuffer())
  return { file, batch, action, buffer, fileHash: hashRosterFile(buffer) }
}

async function loadAllExisting(supabase) {
  const rows = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('students')
      .select('id,name,batch,email,phone,external_student_id,login_id,status,created_at')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < pageSize) break
  }
  return rows
}

async function validateBatch(supabase, batch) {
  const { data, error } = await supabase.from('batches').select('name').eq('name', batch).maybeSingle()
  if (error) throw error
  return data || null
}

function summarize(classified) {
  const possibleDuplicates = classified.filter(row => row.status === 'possible_duplicate').length
  const existingDifferentBatch = classified.filter(row => row.status === 'existing_different_batch').length
  return {
    total: classified.length,
    new: classified.filter(row => row.status === 'new').length,
    existing: classified.filter(row => row.status === 'existing').length,
    existingDifferentBatch,
    possibleDuplicates,
    reviewNeeded: possibleDuplicates + existingDifferentBatch,
    invalid: classified.filter(row => row.status === 'invalid').length,
  }
}

async function createStudentWithUniqueLogin({ supabase, row, batch, usedLoginIds, temporaryPassword }) {
  const passwordHash = await hashStudentPasswordSecure(temporaryPassword)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loginId = generateLoginId(row.name, usedLoginIds)
    const { data, error } = await supabase.from('students').insert({
      name: row.name.trim().replace(/\s+/g, ' '),
      batch,
      email: row.email || null,
      phone: row.phone || null,
      external_student_id: row.externalStudentId || null,
      login_id: loginId,
      password_hash: passwordHash,
      must_change_password: true,
    }).select('id,name,batch,login_id,must_change_password,status,created_at').single()
    if (!error) return data
    if (!isUniqueViolation(error) || !/login/i.test(error.message || '')) throw error
  }
  throw new Error('Could not allocate a unique Login ID.')
}

async function rememberTeamsName({ supabase, student, teamsDisplayName, admin }) {
  const alias = String(teamsDisplayName || '').trim()
  if (!alias || normalizeParticipantName(alias) === normalizeParticipantName(student.name)) return { created: false }
  return saveAlias({
    supabase,
    student,
    alias,
    source: 'roster_import',
    actor: { role: 'admin', name: admin.name },
  })
}

export async function GET(request) {
  const admin = getAdminFromRequest(request)
  if (!admin) return new NextResponse('Unauthorized', { status: 401 })
  const url = new URL(request.url)
  const mode = String(url.searchParams.get('mode') || 'template').toLowerCase()

  if (mode === 'overview') {
    try {
      const batch = String(url.searchParams.get('batch') || '').trim()
      if (!batch) return jsonNoStore({ error: 'Batch is required.' }, { status: 400 })
      const supabase = getSupabaseAdmin()
      if (!await validateBatch(supabase, batch)) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
      const [{ data: students, error: studentError }, aliases, { data: imports, error: importError }] = await Promise.all([
        supabase.from('students').select('id,name,batch,login_id,status,created_at').eq('batch', batch).order('name'),
        loadBatchAliases(supabase, batch),
        supabase.from('student_roster_imports')
          .select('id,batch,original_filename,uploaded_by_name,total_rows,new_count,existing_count,possible_duplicate_count,invalid_count,status,row_results,created_at,completed_at')
          .eq('batch', batch)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (studentError) throw studentError
      if (importError) throw importError
      const aliasesByStudent = new Map()
      for (const alias of aliases) aliasesByStudent.set(String(alias.student_id), [...(aliasesByStudent.get(String(alias.student_id)) || []), alias.alias])
      return jsonNoStore({
        success: true,
        batch,
        students: (students || []).map(student => ({ ...student, attendanceAliases: aliasesByStudent.get(String(student.id)) || [] })),
        imports: imports || [],
      })
    } catch (error) {
      console.error('[admin-roster] overview failed', error?.message)
      return jsonNoStore({ error: 'Could not load the batch roster.' }, { status: 500 })
    }
  }

  const format = String(url.searchParams.get('format') || 'xlsx').toLowerCase()
  if (format === 'csv') {
    return new NextResponse(`${ROSTER_HEADERS.join(',')}\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="consoleflare-student-roster-template.csv"',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  }
  return new NextResponse(createRosterTemplateBuffer(), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="consoleflare-student-roster-template.xlsx"',
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const upload = await readRoster(request)
    if (upload.error) return jsonNoStore({ error: upload.error }, { status: 400 })
    const supabase = getSupabaseAdmin()
    if (!await validateBatch(supabase, upload.batch)) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })

    const rows = parseRosterBuffer(upload.buffer, upload.file.name)
    if (!rows.length) return jsonNoStore({ error: 'No roster rows found. Student Name is required.' }, { status: 400 })
    const [existing, aliases] = await Promise.all([loadAllExisting(supabase), loadBatchAliases(supabase, upload.batch)])
    const classified = classifyRosterRows(rows, existing, { batch: upload.batch, aliases })
    const summary = summarize(classified)
    const safeRows = classified.map(safeClassifiedRow)
    if (upload.action !== 'commit') return jsonNoStore({ success: true, batch: upload.batch, summary, rows: safeRows })

    const usedLoginIds = await loadUsedLoginIds(supabase)
    const credentials = []
    const rowResults = []
    let aliasesCreated = 0
    for (const row of classified.filter(candidate => candidate.status === 'new')) {
      const temporaryPassword = generateTemporaryPassword()
      let student = null
      try {
        student = await createStudentWithUniqueLogin({ supabase, row, batch: upload.batch, usedLoginIds, temporaryPassword })
      } catch {
        rowResults.push({ rowNumber: row.rowNumber, name: row.name, status: 'failed', reason: 'Account creation could not be completed safely.' })
        continue
      }

      credentials.push({ name: student.name, batch: student.batch, loginId: student.login_id, temporaryPassword, externalStudentId: row.externalStudentId || '' })
      const warnings = []
      let aliasCreated = false
      try {
        const aliasResult = await rememberTeamsName({ supabase, student, teamsDisplayName: row.teamsDisplayName, admin })
        aliasCreated = Boolean(aliasResult.created)
        if (aliasCreated) aliasesCreated += 1
      } catch {
        warnings.push('Teams Display Name needs review.')
      }
      try {
        const { data: membership, error: membershipError } = await supabase
          .from('student_batch_memberships')
          .select('student_id')
          .eq('student_id', student.id)
          .eq('batch', student.batch)
          .is('ends_on', null)
          .limit(1)
          .maybeSingle()
        if (membershipError) throw membershipError
        if (!membership) throw new Error('Student membership was not established.')
      } catch {
        warnings.push('Batch membership needs review.')
      }
      await reconcileWaitingAttendanceSafely({ supabase, student })
      rowResults.push({ rowNumber: row.rowNumber, name: student.name, studentId: student.id, loginId: student.login_id, status: 'created', aliasCreated, warnings })
    }

    for (const row of classified.filter(candidate => candidate.status === 'existing' && candidate.matchedStudent && candidate.teamsDisplayName)) {
      try {
        const aliasResult = await rememberTeamsName({ supabase, student: row.matchedStudent, teamsDisplayName: row.teamsDisplayName, admin })
        if (aliasResult.created) aliasesCreated += 1
        await reconcileWaitingAttendanceSafely({ supabase, student: row.matchedStudent })
        rowResults.push({ rowNumber: row.rowNumber, name: row.name, studentId: row.matchedStudent.id, loginId: row.matchedStudent.login_id || null, status: 'already_onboarded', aliasCreated: Boolean(aliasResult.created) })
      } catch {
        rowResults.push({ rowNumber: row.rowNumber, name: row.name, studentId: row.matchedStudent.id, loginId: row.matchedStudent.login_id || null, status: 'review_needed', reason: 'Teams Display Name could not be assigned safely.' })
      }
    }

    const failed = rowResults.filter(row => row.status === 'failed').length
    const { error: auditError } = await supabase.from('student_roster_imports').insert({
      batch: upload.batch,
      original_filename: upload.file.name,
      file_hash: upload.fileHash,
      uploaded_by_role: 'admin',
      uploaded_by_name: admin.name,
      total_rows: classified.length,
      new_count: summary.new,
      existing_count: summary.existing,
      possible_duplicate_count: summary.reviewNeeded,
      invalid_count: summary.invalid,
      status: 'completed',
      row_results: rowResults,
      completed_at: new Date().toISOString(),
    })
    if (auditError) throw auditError

    await appendActivity({
      eventType: 'student_roster_onboarded',
      description: `Onboarded ${credentials.length} student account(s) into ${upload.batch}.`,
      actorName: admin.name,
      actorRole: 'admin',
      action: 'bulk_onboard',
      metadata: { batch: upload.batch, total_rows: classified.length, created: credentials.length, failed, aliases_created: aliasesCreated },
      supabase,
    })
    return jsonNoStore({ success: true, batch: upload.batch, summary: { ...summary, created: credentials.length, failed, aliasesCreated }, rows: safeRows, createdRows: rowResults, credentials })
  } catch (error) {
    console.error('[admin-roster] failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Roster import schema is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not process the student roster.' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const studentId = String(body.studentId || '').trim()
    const batch = String(body.batch || '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId) || !batch) return jsonNoStore({ error: 'Student and target batch are required.' }, { status: 400 })
    const supabase = getSupabaseAdmin()
    if (!await validateBatch(supabase, batch)) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
    const { data: student, error: loadError } = await supabase.from('students').select('id,name,batch,login_id,status').eq('id', studentId).maybeSingle()
    if (loadError) throw loadError
    if (!student) return jsonNoStore({ error: 'Student not found.' }, { status: 404 })
    if (student.batch === batch) return jsonNoStore({ success: true, student })
    const previousBatch = student.batch
    const { data: updated, error: updateError } = await supabase.from('students').update({ batch }).eq('id', student.id).select('id,name,batch,login_id,status,created_at').single()
    if (updateError) throw updateError
    await appendActivity({
      eventType: 'student_batch_transferred',
      description: `Transferred ${student.name} from ${previousBatch} to ${batch}.`,
      actorName: admin.name,
      actorRole: 'admin',
      action: 'transfer_batch',
      metadata: { student_id: student.id, previous_batch: previousBatch, batch },
      supabase,
    })
    return jsonNoStore({ success: true, student: updated })
  } catch (error) {
    console.error('[admin-roster] transfer failed', error?.message)
    return jsonNoStore({ error: 'Could not transfer the existing student safely.' }, { status: 500 })
  }
}
