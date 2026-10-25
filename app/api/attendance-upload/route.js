import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { appendActivity } from '@/lib/activity-log'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { HEALTH_CARD_EPOCH, isMissingHealthCardSchema, isUniqueViolation } from '@/lib/student-health-card'
import { parseIsoDate } from '@/lib/health-card-admin'
import { parseTeamsReport, buildUploadPreview, stripTeamsSuffix } from '@/lib/attendance-upload'
import {
  createAttendanceImport,
  ensureAttendanceSession,
  findDuplicateImport,
  loadBatchAliases,
  loadBatchStudents,
  parseSessionInput,
  sha256Hex,
  updateAttendanceImport,
} from '@/lib/attendance-domain'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 5 * 1024 * 1024

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

function resolveAuth(request) {
  const admin = getAdminFromRequest(request)
  if (admin) return { role: 'admin', name: admin.name, batchFilter: null }
  const teacher = getTeacherFromRequest(request)
  if (teacher) return { role: 'teacher', name: teacher.name, batchFilter: 'scope' }
  return null
}

function sessionFields(formData, date) {
  return parseSessionInput({
    date,
    title: formData.get('sessionTitle'),
    startTime: formData.get('sessionStart'),
    endTime: formData.get('sessionEnd'),
  })
}

async function readUploadFile(formData) {
  const file = formData.get('file')
  if (!file || typeof file === 'string') return { error: 'An attendance file is required.' }
  if (file.size > MAX_FILE_SIZE) return { error: 'File size exceeds 5 MB limit.' }
  const buffer = Buffer.from(await file.arrayBuffer())
  return { file, buffer, fileHash: sha256Hex(buffer) }
}

export async function POST(request) {
  try {
    noStore()
    const auth = resolveAuth(request)
    if (!auth) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    let allowedBatches = null
    let resolvedName = auth.name
    if (auth.batchFilter === 'scope') {
      const scope = await getTeacherScope(supabase, auth.name)
      allowedBatches = scope.batchNames
      resolvedName = scope.teacherName || auth.name
      if (!allowedBatches.length) return jsonNoStore({ error: 'No batches assigned to this teacher.' }, { status: 403 })
    }

    const formData = await request.formData().catch(() => null)
    if (!formData) return jsonNoStore({ error: 'Invalid form data.' }, { status: 400 })

    const action = String(formData.get('action') || 'preview').trim().toLowerCase()
    const batch = String(formData.get('batch') || '').trim()
    const date = String(formData.get('date') || '').trim()
    if (!batch) return jsonNoStore({ error: 'Batch is required.' }, { status: 400 })
    if (!date || !parseIsoDate(date)) return jsonNoStore({ error: 'A valid date (YYYY-MM-DD) is required.' }, { status: 400 })
    if (date < HEALTH_CARD_EPOCH) return jsonNoStore({ error: `Date must be on or after ${HEALTH_CARD_EPOCH}.` }, { status: 400 })
    if (allowedBatches && !allowedBatches.includes(batch)) return jsonNoStore({ error: 'This batch is not assigned to you.' }, { status: 403 })

    const session = sessionFields(formData, date)
    if (session.error) return jsonNoStore({ error: session.error }, { status: 400 })
    if (action === 'preview') return handlePreview({ formData, supabase, batch, date, session: session.value })
    if (action === 'confirm') return handleConfirm({ formData, supabase, batch, date, session: session.value, auth, resolvedName })
    return jsonNoStore({ error: 'Invalid action. Use "preview" or "confirm".' }, { status: 400 })
  } catch (error) {
    console.error('[attendance-upload] failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Attendance operations are not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not process attendance upload.' }, { status: 500 })
  }
}

async function handlePreview({ formData, supabase, batch, date, session }) {
  const upload = await readUploadFile(formData)
  if (upload.error) return jsonNoStore({ error: upload.error }, { status: 400 })

  const parsed = parseTeamsReport(upload.buffer, upload.file.name)
  if (parsed.meta?.error) return jsonNoStore({ error: parsed.meta.error }, { status: 400 })
  if (!parsed.names.length) return jsonNoStore({ error: 'No names found in the uploaded file.' }, { status: 400 })

  const [students, aliases, sessionRow] = await Promise.all([
    loadBatchStudents(supabase, batch),
    loadBatchAliases(supabase, batch),
    findExistingSession(supabase, batch, date, session),
  ])
  let existing = []
  if (sessionRow) {
    const { data, error: existingError } = await supabase
      .from('student_attendance')
      .select('id,student_id,status,session_id,attendance_date')
      .eq('batch', batch)
      .eq('session_id', sessionRow.id)
    if (existingError) throw existingError
    existing = data || []
  }

  const preview = buildUploadPreview({
    fileNames: parsed.names,
    students,
    aliases,
    existingAttendance: existing,
    date,
    batch,
  })
  const duplicate = await findDuplicateImport({
    supabase,
    payload: { file_hash: upload.fileHash, batch, attendance_date: date, session_id: sessionRow?.id || null },
  })

  return jsonNoStore({
    success: true,
    preview: {
      ...preview,
      duplicate: duplicate ? {
        id: duplicate.id,
        uploadedAt: duplicate.created_at,
        uploadedBy: duplicate.uploaded_by_name,
        batch: duplicate.batch,
        date: duplicate.attendance_date,
        sessionTitle: sessionRow?.title || session.title,
      } : null,
      session: { title: session.title, startsAt: session.starts_at, endsAt: session.ends_at },
    },
    fileMeta: parsed.meta,
  })
}

async function handleConfirm({ formData, supabase, batch, date, session, auth, resolvedName }) {
  const upload = await readUploadFile(formData)
  if (upload.error) return jsonNoStore({ error: upload.error }, { status: 400 })

  const parsed = parseTeamsReport(upload.buffer, upload.file.name)
  if (parsed.meta?.error) return jsonNoStore({ error: parsed.meta.error }, { status: 400 })
  if (!parsed.names.length) return jsonNoStore({ error: 'No names found in the uploaded file.' }, { status: 400 })

  let records = []
  try {
    records = JSON.parse(formData.get('records') || '[]')
    if (!Array.isArray(records)) throw new Error()
  } catch {
    return jsonNoStore({ error: 'Records must be a JSON array of { studentId, fileName }.' }, { status: 400 })
  }
  if (records.length > 200) return jsonNoStore({ error: 'Cannot process more than 200 records at once.' }, { status: 400 })

  const sessionRow = await ensureAttendanceSession({
    supabase,
    batch,
    date,
    title: session.title,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    source: 'teams_report',
    createdByRole: auth.role,
    createdByName: resolvedName,
  })
  const importPayload = {
    batch,
    attendance_date: date,
    session_id: sessionRow.id,
    source: 'teams_report',
    original_filename: upload.file.name,
    file_hash: upload.fileHash,
    file_size: upload.file.size,
    uploaded_by_role: auth.role,
    uploaded_by_name: resolvedName,
    total_participants: parsed.names.length,
  }
  const duplicateCheck = await createAttendanceImport({ supabase, payload: importPayload })
  if (duplicateCheck.duplicate) {
    await appendActivity({
      eventType: 'attendance_duplicate_report_blocked',
      description: `blocked duplicate attendance report for ${batch} on ${date}`,
      actorName: resolvedName,
      actorRole: auth.role,
      action: 'duplicate_blocked',
      metadata: { batch, date, session_id: sessionRow.id, duplicate_import_id: duplicateCheck.duplicate.id },
      supabase,
    })
    return jsonNoStore({
      error: 'This attendance report was already imported.',
      duplicate: {
        id: duplicateCheck.duplicate.id,
        uploadedAt: duplicateCheck.duplicate.created_at,
        uploadedBy: duplicateCheck.duplicate.uploaded_by_name,
        batch: duplicateCheck.duplicate.batch,
        date: duplicateCheck.duplicate.attendance_date,
      },
    }, { status: 409 })
  }

  const importRow = duplicateCheck.data
  const { error: sessionUpdateError } = await supabase
    .from('attendance_sessions')
    .update({ import_id: importRow.id, updated_at: new Date().toISOString() })
    .eq('id', sessionRow.id)
  if (sessionUpdateError) throw sessionUpdateError

  const studentIds = [...new Set(records.map(record => String(record?.studentId || '').trim()).filter(Boolean))]
  const { data: students, error: verifyError } = studentIds.length
    ? await supabase.from('students').select('id,name,batch').in('id', studentIds).eq('batch', batch).eq('status', 'active')
    : { data: [], error: null }
  if (verifyError) throw verifyError

  const studentsById = new Map((students || []).map(student => [String(student.id), student]))
  const verified = records.filter(record => studentsById.has(String(record?.studentId || '').trim()))
  const now = new Date().toISOString()
  let created = 0
  let skipped = 0
  const errors = []
  const createdNames = []

  for (const record of verified) {
    const studentId = String(record.studentId).trim()
    const student = studentsById.get(studentId)
    const { error: insertError } = await supabase.from('student_attendance').insert({
      student_id: studentId,
      batch,
      attendance_date: date,
      session_id: sessionRow.id,
      import_id: importRow.id,
      source: 'teams_report',
      original_participant_name: String(record.participantName || record.fileName || student.name).trim(),
      status: 'approved',
      marked_at: now,
      reviewed_at: now,
      reviewed_by: resolvedName,
      review_note: `Uploaded from Teams report by ${auth.role}`,
    }).select('id').single()

    if (insertError) {
      if (isUniqueViolation(insertError)) skipped += 1
      else errors.push({ studentId, error: insertError.message })
    } else {
      created += 1
      createdNames.push({ studentId, studentName: student.name, fileName: record.fileName || student.name })
    }
  }

  const unmatched = parseUnmatched(formData.get('unmatched'))
  let savedUnlinked = 0
  for (const item of unmatched.slice(0, 200)) {
    const participantName = String(item.participantName || item.fileName || item.name || '').trim()
    if (!participantName) continue
    const { data: existing, error: existingError } = await supabase
      .from('unlinked_attendance')
      .select('id')
      .eq('participant_name', participantName)
      .eq('batch', batch)
      .eq('attendance_date', date)
      .eq('session_id', sessionRow.id)
      .eq('status', 'waiting')
      .limit(1)
    if (existingError) throw existingError
    if (existing?.length) continue

    const { error: insertError } = await supabase.from('unlinked_attendance').insert({
      participant_name: participantName,
      original_participant_name: participantName,
      normalized_participant_name: stripTeamsSuffix(participantName).toLowerCase().replace(/\s+/g, ' ').trim(),
      batch,
      attendance_date: date,
      uploaded_by_role: auth.role,
      uploaded_by_name: resolvedName,
      status: 'waiting',
      import_id: importRow.id,
      session_id: sessionRow.id,
      suggested_student_id: item.studentId || item.bestMatch?.studentId || null,
      match_score: Number.isFinite(Number(item.similarity)) ? Number(item.similarity) : null,
      match_type: item.type || null,
      match_reason: item.reason || null,
    })
    if (insertError) {
      if (!isUniqueViolation(insertError)) throw insertError
    } else {
      savedUnlinked += 1
      await appendActivity({
        eventType: 'attendance_unmatched_saved',
        description: `saved unmatched participant ${participantName} for ${batch}`,
        actorName: resolvedName,
        actorRole: auth.role,
        action: 'needs_matching',
        metadata: { batch, date, import_id: importRow.id, session_id: sessionRow.id },
        supabase,
      })
    }
  }

  await updateAttendanceImport({
    supabase,
    importId: importRow.id,
    counts: {
      matched_count: verified.length,
      needs_matching_count: savedUnlinked,
      already_marked_count: skipped,
      dismissed_count: 0,
    },
  })

  if (created > 0) {
    await appendActivity({
      eventType: 'attendance_import_created',
      description: `imported ${created} attendance record${created === 1 ? '' : 's'} for ${batch} on ${date}`,
      actorName: resolvedName,
      actorRole: auth.role,
      action: 'import',
      metadata: { batch, date, import_id: importRow.id, session_id: sessionRow.id, created, skipped, needs_matching: savedUnlinked, errors: errors.length },
      supabase,
    })

    await Promise.allSettled(createdNames.map(row => createNotification({
      userType: NOTIFICATION_USER_TYPE.STUDENT,
      userIdentifier: row.studentId,
      notificationType: NOTIFICATION_TYPE.HEALTH_ATTENDANCE_APPROVED,
      title: 'Attendance recorded',
      message: `Your attendance for ${date} has been recorded and approved.`,
      referenceType: 'student_attendance',
      referenceId: row.studentId,
      icon: '✓',
      severity: 'success',
      actionLabel: 'View Health Card',
      actionUrl: '/',
      supabase,
    })))
  }

  return jsonNoStore({
    success: true,
    result: {
      importId: importRow.id,
      sessionId: sessionRow.id,
      created,
      skipped,
      errors: errors.length,
      total: verified.length,
      createdNames,
      savedUnlinked,
      duplicateBlocked: false,
    },
  })
}

async function findExistingSession(supabase, batch, date, session) {
  let query = supabase.from('attendance_sessions').select('*').eq('batch', batch).eq('session_date', date).eq('title', session.title).limit(20)
  query = session.starts_at ? query.eq('starts_at', session.starts_at) : query.is('starts_at', null)
  const { data, error } = await query
  if (error) throw error
  return data?.[0] || null
}

function parseUnmatched(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map(item => typeof item === 'string' ? { participantName: item } : item).filter(Boolean)
  } catch {
    return []
  }
}
