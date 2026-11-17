import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { createStudentAccount } from '@/lib/student-onboarding'
import {
  ROSTER_HEADERS,
  classifyRosterRows,
  createRosterTemplateBuffer,
  hashRosterFile,
  loadUsedLoginIds,
  parseRosterBufferWithMetadata,
} from '@/lib/roster-import'
import { buildStudentPatternPassword, maskStudentPhone } from '@/lib/student-password-pattern'
import { generateStudentLoginId } from '@/lib/student-login-id'
import { normalizeParticipantName } from '@/lib/attendance-matching'
import { loadBatchAliases, saveAlias } from '@/lib/attendance-domain'
import { reconcileWaitingAttendanceSafely } from '@/lib/attendance-reconciliation'
import { appendActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

function safeRow(row) {
  return {
    rowNumber: row.rowNumber,
    name: row.name,
    email: row.email,
    phone: maskStudentPhone(row.phone),
    currentPhone: maskStudentPhone(row.matchedStudent?.phone),
    phoneUpdate: Boolean(row.phoneUpdate),
    phoneStatus: row.phoneStatus,
    passwordReady: Boolean(row.passwordReady),
    loginIdReady: Boolean(row.loginIdReady),
    currentLoginId: row.matchedStudent?.login_id || null,
    newLoginId: row.newLoginId || null,
    passwordCollisionCount: row.passwordCollisionCount || 0,
    externalStudentId: row.externalStudentId,
    teamsDisplayName: row.teamsDisplayName,
    joinDate: row.joinDate || '',
    status: row.status,
    reason: row.reason,
    matchedStudent: row.matchedStudent ? { id: row.matchedStudent.id, name: row.matchedStudent.name, batch: row.matchedStudent.batch, loginId: row.matchedStudent.login_id || null, status: row.matchedStudent.status || 'active' } : null,
  }
}

async function loadAllExisting(supabase) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('students').select('id,name,batch,email,phone,external_student_id,login_id,status,created_at').order('id').range(offset, offset + 999)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  return rows
}

function summarize(classified, registeredCount, uploadedCount, phoneColumnDetected) {
  const existing = classified.filter(row => row.status === 'existing')
  const existingDifferentBatch = classified.filter(row => row.status === 'existing_different_batch').length
  const possibleDuplicates = classified.filter(row => row.status === 'possible_duplicate').length
  return {
    total: classified.length,
    new: classified.filter(row => row.status === 'new').length,
    existing: existing.length,
    existingDifferentBatch,
    possibleDuplicates,
    reviewNeeded: existingDifferentBatch + possibleDuplicates,
    invalid: classified.filter(row => row.status === 'invalid').length,
    phoneUpdates: existing.filter(row => row.phoneUpdate).length,
    passwordReady: existing.filter(row => row.passwordReady).length,
    loginIdReady: existing.filter(row => row.loginIdReady).length,
    newLoginIdReady: classified.filter(row => row.status === 'new' && row.loginIdReady).length,
    phoneMissing: existing.filter(row => row.phoneStatus === 'missing').length,
    invalidPhone: existing.filter(row => row.phoneStatus === 'invalid').length,
    registeredCount,
    uploadedCount,
    matchedExistingCount: existing.length,
    notIncludedCount: Math.max(registeredCount - existing.length, 0),
    phoneColumnDetected,
    passwordCollisionWarnings: new Set(classified.filter(row => row.passwordCollisionCount > 1).map(row => row.passwordPattern)).size,
  }
}

function allocateLoginIdCandidates(classified, usedLoginIds) {
  const newUsed = new Set(usedLoginIds)
  for (const row of classified) {
    if (row.status !== 'new' || !row.passwordReady) continue
    try {
      row.loginIdCandidate = generateStudentLoginId({ name: row.name, phone: row.phone }, newUsed)
      row.loginIdReady = true
    } catch {
      row.loginIdReady = false
    }
  }
  return classified
}

async function readUpload(request) {
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const batch = String(form?.get('batch') || '').trim()
  const action = String(form?.get('action') || 'preview').trim().toLowerCase()
  if (!form || !file || typeof file === 'string') return { error: 'A roster file is required.' }
  if (!batch) return { error: 'Batch is required.' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Roster file exceeds the 5 MB limit.' }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name || '')) return { error: 'Upload an XLSX, XLS, or CSV roster file.' }
  const buffer = Buffer.from(await file.arrayBuffer())
  return { file, batch, action, buffer, fileHash: hashRosterFile(buffer) }
}

export async function GET(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    const url = new URL(request.url)
    const mode = String(url.searchParams.get('mode') || 'template').toLowerCase()
    if (mode !== 'overview') {
      const format = String(url.searchParams.get('format') || 'xlsx').toLowerCase()
      if (format === 'csv') return new NextResponse(`${ROSTER_HEADERS.join(',')}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="consoleflare-student-roster-template.csv"', 'Cache-Control': 'no-store, max-age=0' } })
      return new NextResponse(createRosterTemplateBuffer(), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="consoleflare-student-roster-template.xlsx"', 'Cache-Control': 'no-store, max-age=0' } })
    }
    const batch = String(url.searchParams.get('batch') || '').trim()
    if (!scope.batchNames.includes(batch)) return jsonNoStore({ error: 'Select a batch assigned to you.' }, { status: 403 })
    const [{ data: students, error: studentsError }, { data: imports, error: importsError }, aliases] = await Promise.all([
      supabase.from('students').select('id,name,batch,login_id,status,created_at').eq('batch', batch).order('name'),
      supabase.from('student_roster_imports').select('id,batch,original_filename,uploaded_by_role,uploaded_by_name,total_rows,new_count,existing_count,possible_duplicate_count,invalid_count,status,created_at,completed_at').eq('batch', batch).order('created_at', { ascending: false }).limit(20),
      loadBatchAliases(supabase, batch),
    ])
    if (studentsError) throw studentsError
    if (importsError) throw importsError
    const aliasesByStudent = new Map()
    for (const alias of aliases) aliasesByStudent.set(String(alias.student_id), [...(aliasesByStudent.get(String(alias.student_id)) || []), alias.alias])
    return jsonNoStore({ success: true, batch, students: (students || []).map(student => ({ ...student, attendanceAliases: aliasesByStudent.get(String(student.id)) || [] })), imports: imports || [], teacherName: scope.teacherName })
  } catch (error) {
    console.error('[teacher-roster] GET failed', error?.message)
    return jsonNoStore({ error: 'Could not load the batch roster.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const upload = await readUpload(request)
    if (upload.error) return jsonNoStore({ error: upload.error }, { status: 400 })
    if (!['preview', 'commit-new'].includes(upload.action)) return jsonNoStore({ error: 'Trainer bulk onboarding supports preview and create accounts only.' }, { status: 400 })
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.includes(upload.batch)) return jsonNoStore({ error: 'You can only onboard students in a batch assigned to you.' }, { status: 403 })
    const parsedRoster = parseRosterBufferWithMetadata(upload.buffer, upload.file.name)
    if (!parsedRoster.rows.length) return jsonNoStore({ error: 'No roster rows found. Student Name is required.' }, { status: 400 })
    const [existing, aliases] = await Promise.all([loadAllExisting(supabase), loadBatchAliases(supabase, upload.batch)])
    const classified = classifyRosterRows(parsedRoster.rows, existing, { batch: upload.batch, aliases })
    const usedLoginIds = await loadUsedLoginIds(supabase)
    allocateLoginIdCandidates(classified, usedLoginIds)
    const registeredCount = existing.filter(student => String(student.batch) === upload.batch).length
    const summary = summarize(classified, registeredCount, parsedRoster.rows.length, parsedRoster.phoneColumnDetected)
    if (upload.action === 'preview') return jsonNoStore({ success: true, batch: upload.batch, detectedColumns: parsedRoster.detectedColumns, phoneColumnDetected: parsedRoster.phoneColumnDetected, summary, rows: classified.map(safeRow) })

    const credentials = []
    const rowResults = []
    let aliasesCreated = 0
    for (const row of classified.filter(candidate => candidate.status === 'new')) {
      const password = buildStudentPatternPassword({ name: row.name, phone: row.phone })
      try {
        const result = await createStudentAccount({ supabase, input: { ...row, externalStudentId: row.externalStudentId, teamsDisplayName: row.teamsDisplayName, joinDate: row.joinDate, batch: upload.batch }, actorRole: 'teacher', actorName: scope.teacherName, password, loginIdCandidate: row.loginIdCandidate })
        credentials.push({ name: result.student.name, batch: result.student.batch, loginId: result.loginId, password, phoneEnding: String(row.phone || '').replace(/\D/g, '').slice(-3), externalStudentId: row.externalStudentId || '' })
        let aliasCreated = false
        if (row.teamsDisplayName && normalizeParticipantName(row.teamsDisplayName) !== normalizeParticipantName(result.student.name)) {
          const aliasResult = await saveAlias({ supabase, student: result.student, alias: row.teamsDisplayName, source: 'roster_import', actor: { role: 'teacher', name: scope.teacherName } })
          aliasCreated = Boolean(aliasResult.created)
          if (aliasCreated) aliasesCreated += 1
        }
        await reconcileWaitingAttendanceSafely({ supabase, student: result.student })
        rowResults.push({ rowNumber: row.rowNumber, name: result.student.name, studentId: result.student.id, loginId: result.loginId, status: 'created', aliasCreated })
      } catch (error) {
        rowResults.push({ rowNumber: row.rowNumber, name: row.name, status: 'failed', reason: error?.status === 409 ? error.message : 'Account creation could not be completed safely.' })
      }
    }
    const failed = rowResults.filter(row => row.status === 'failed').length
    const { error: auditError } = await supabase.from('student_roster_imports').insert({
      batch: upload.batch,
      original_filename: upload.file.name,
      file_hash: upload.fileHash,
      uploaded_by_role: 'teacher',
      uploaded_by_name: scope.teacherName,
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
    await appendActivity({ eventType: 'student_roster_onboarded', description: `Onboarded ${credentials.length} student account(s) into ${upload.batch}.`, actorName: scope.teacherName, actorRole: 'teacher', action: 'bulk_onboard', metadata: { batch: upload.batch, total_rows: classified.length, created: credentials.length, failed, aliases_created: aliasesCreated, password_collision_warnings: summary.passwordCollisionWarnings }, supabase })
    return jsonNoStore({ success: true, batch: upload.batch, detectedColumns: parsedRoster.detectedColumns, phoneColumnDetected: parsedRoster.phoneColumnDetected, summary: { ...summary, created: credentials.length, failed, aliasesCreated }, rows: classified.map(safeRow), createdRows: rowResults, credentials })
  } catch (error) {
    console.error('[teacher-roster] POST failed', error?.message)
    return jsonNoStore({ error: error?.message || 'Could not process the student roster.' }, { status: error?.status || 500 })
  }
}

