import crypto from 'crypto'
import { isUniqueViolation } from '@/lib/student-health-card'
import { matchParticipantName, normalizeParticipantName } from '@/lib/attendance-matching'
import { DEFAULT_SESSION_TITLE, normalizeSessionTitle, parseSessionInput } from '@/lib/attendance-session'

export { DEFAULT_SESSION_TITLE, normalizeSessionTitle, parseSessionInput } from '@/lib/attendance-session'

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export async function findAttendanceSession({ supabase, batch, date, title, startsAt = null }) {
  let query = supabase
    .from('attendance_sessions')
    .select('*')
    .eq('batch', batch)
    .eq('session_date', date)
    .eq('title', title)
    .limit(20)
  query = startsAt ? query.eq('starts_at', startsAt) : query.is('starts_at', null)
  const { data, error } = await query
  if (error) throw error
  return data?.[0] || null
}

export async function ensureAttendanceSession({
  supabase,
  batch,
  date,
  title,
  startsAt = null,
  endsAt = null,
  source = 'teams_report',
  createdByRole = 'system',
  createdByName = 'attendance system',
}) {
  const normalizedTitle = normalizeSessionTitle(title)
  const existing = await findAttendanceSession({ supabase, batch, date, title: normalizedTitle, startsAt })
  if (existing) return existing

  const payload = {
    batch,
    session_date: date,
    title: normalizedTitle,
    starts_at: startsAt,
    ends_at: endsAt,
    source,
    created_by_role: createdByRole,
    created_by_name: createdByName,
  }
  const { data, error } = await supabase.from('attendance_sessions').insert(payload).select('*').single()
  if (!error) return data
  if (!isUniqueViolation(error)) throw error
  return findAttendanceSession({ supabase, batch, date, title: normalizedTitle, startsAt })
}

export async function loadBatchStudents(supabase, batch) {
  const { data, error } = await supabase
    .from('students')
    .select('id,name,batch,status')
    .eq('batch', batch)
    .eq('status', 'active')
    .order('name')
  if (error) throw error
  return data || []
}

export async function loadBatchAliases(supabase, batch) {
  const { data, error } = await supabase
    .from('student_identity_aliases')
    .select('id,student_id,batch,alias,normalized_alias,source,active,created_by_role,created_by_name,created_at')
    .eq('batch', batch)
    .eq('active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createAttendanceImport({ supabase, payload }) {
  const duplicate = await findDuplicateImport({ supabase, payload })
  if (duplicate) return { duplicate, data: null }

  const { data, error } = await supabase.from('attendance_imports').insert(payload).select('*').single()
  if (!error) return { duplicate: null, data }
  if (isUniqueViolation(error)) {
    const retry = await findDuplicateImport({ supabase, payload })
    return { duplicate: retry, data: null }
  }
  throw error
}

export async function findDuplicateImport({ supabase, payload }) {
  let duplicateQuery = supabase
    .from('attendance_imports')
    .select('*')
    .eq('file_hash', payload.file_hash)
    .eq('batch', payload.batch)
    .eq('attendance_date', payload.attendance_date)
    .limit(1)
  duplicateQuery = payload.session_id ? duplicateQuery.eq('session_id', payload.session_id) : duplicateQuery.is('session_id', null)
  const { data: existing, error: duplicateError } = await duplicateQuery
  if (duplicateError) throw duplicateError
  return existing?.[0] || null
}

export async function updateAttendanceImport({ supabase, importId, counts }) {
  const { data, error } = await supabase
    .from('attendance_imports')
    .update(counts)
    .eq('id', importId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export function buildMatchFields(match) {
  return {
    suggested_student_id: match?.student?.id || null,
    match_score: match?.score || null,
    match_type: match?.type || null,
    match_reason: match?.reason || null,
  }
}

export async function saveAlias({ supabase, student, alias, actor }) {
  const normalizedAlias = normalizeParticipantName(alias)
  if (!normalizedAlias) return { created: false, alias: null }
  const { data: existing, error: lookupError } = await supabase
    .from('student_identity_aliases')
    .select('id,student_id,batch,alias,normalized_alias,active')
    .eq('batch', student.batch)
    .eq('normalized_alias', normalizedAlias)
    .limit(2)
  if (lookupError) throw lookupError
  const conflicting = (existing || []).find(row => String(row.student_id) !== String(student.id))
  if (conflicting) {
    const error = new Error('This alias is already assigned to another student in the batch.')
    error.code = 'ALIAS_CONFLICT'
    throw error
  }
  if (existing?.[0]) {
    if (!existing[0].active) {
      const { error } = await supabase.from('student_identity_aliases').update({ active: true, updated_at: new Date().toISOString() }).eq('id', existing[0].id)
      if (error) throw error
    }
    return { created: false, alias: existing[0] }
  }
  const { data, error } = await supabase.from('student_identity_aliases').insert({
    student_id: student.id,
    batch: student.batch,
    alias: String(alias).trim().slice(0, 240),
    normalized_alias: normalizedAlias,
    source: 'manual_resolution',
    created_by_role: actor.role,
    created_by_name: actor.name,
  }).select('*').single()
  if (error) throw error
  return { created: true, alias: data }
}

export async function linkUnlinkedAttendance({
  supabase,
  row,
  student,
  actor,
  correctedDisplayName = null,
  rememberAlias = false,
  source = 'resolved_unmatched',
}) {
  if (!row || !student || String(row.batch) !== String(student.batch)) {
    const error = new Error('The selected student is not in this attendance batch.')
    error.status = 400
    throw error
  }

  if (!row.session_id) throw new Error('A valid class session is required before linking attendance.')
  const { data: session, error: sessionError } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('id', row.session_id)
    .maybeSingle()
  if (sessionError) throw sessionError
  if (!session || session.source === 'legacy_backfill') {
    throw new Error('A valid authoritative class session is required before linking attendance.')
  }
  if (String(session.batch) !== String(row.batch) || String(session.session_date) !== String(row.attendance_date)) {
    throw new Error('The class session does not match this attendance record.')
  }

  if (rememberAlias) await saveAlias({ supabase, student, alias: row.original_participant_name || row.participant_name, actor })

  const { data: existing, error: existingError } = await supabase
    .from('student_attendance')
    .select('id,status')
    .eq('student_id', student.id)
    .eq('session_id', session.id)
    .limit(1)
  if (existingError) throw existingError

  const now = new Date().toISOString()
  let created = false
  if (!existing?.[0]) {
    const { error: insertError } = await supabase.from('student_attendance').insert({
      student_id: student.id,
      batch: student.batch,
      attendance_date: row.attendance_date,
      session_id: session.id,
      import_id: row.import_id || session.import_id || null,
      source,
      original_participant_name: row.original_participant_name || row.participant_name,
      status: 'approved',
      marked_at: now,
      reviewed_at: now,
      reviewed_by: actor.name,
      review_note: `Resolved imported participant ${row.original_participant_name || row.participant_name}`,
      resolved_by_role: actor.role,
      resolved_by_name: actor.name,
      resolved_at: now,
    })
    if (insertError && !isUniqueViolation(insertError)) throw insertError
    created = !insertError
  }

  const match = matchParticipantName({ participantName: row.original_participant_name || row.participant_name, students: [student] })
  const { error: updateError } = await supabase.from('unlinked_attendance').update({
    status: 'linked',
    linked_student_id: student.id,
    linked_at: now,
    corrected_display_name: correctedDisplayName || student.name,
    ...buildMatchFields(match),
    resolved_by_role: actor.role,
    resolved_by_name: actor.name,
    resolved_at: now,
  }).eq('id', row.id).eq('status', 'waiting')
  if (updateError) throw updateError

  return { created, duplicate: !created, session, aliasRemembered: Boolean(rememberAlias) }
}
