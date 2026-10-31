import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { appendActivity } from '@/lib/activity-log'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { isMissingHealthCardSchema, isUniqueViolation } from '@/lib/student-health-card'
import { parseIsoDate } from '@/lib/health-card-admin'
import { getAttendanceApprovalConflict } from '@/lib/attendance-session'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

async function loadAvailableSessions(supabase, rows, { batch, date } = {}) {
  if (!rows.length) return rows
  let query = supabase
    .from('attendance_sessions')
    .select('id,batch,session_date,title,starts_at,ends_at,source')
    .neq('source', 'legacy_backfill')
    .order('session_date', { ascending: false })
    .order('starts_at', { ascending: false })
    .limit(500)
  if (batch) query = query.eq('batch', batch)
  if (date) query = query.eq('session_date', date)
  const { data: sessions, error } = await query
  if (error) throw error
  const sessionsByKey = new Map()
  for (const session of sessions || []) {
    const key = `${session.batch}|${session.session_date}`
    const list = sessionsByKey.get(key) || []
    list.push(session)
    sessionsByKey.set(key, list)
  }
  return rows.map(row => ({
    ...row,
    available_sessions: sessionsByKey.get(`${row.batch}|${row.attendance_date}`) || [],
  }))
}

export async function GET(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const params = request.nextUrl.searchParams
    const status = String(params.get('status') || 'pending').trim().toLowerCase()
    const batch = String(params.get('batch') || '').trim()
    const date = String(params.get('date') || '').trim()
    const search = String(params.get('search') || '').trim().toLowerCase()

    if (params.get('overview') === '1') {
      if (!batch || !date) return jsonNoStore({ success: true, sessions: [], roster: [], requests: [], unlinked: [], counts: { present: 0, pendingRequests: 0, needsAttention: 0, notRecorded: 0, registered: 0, recorded: 0 } })
      if (!parseIsoDate(date)) return jsonNoStore({ error: 'Invalid attendance date.' }, { status: 400 })
      return loadAttendanceOverview({ supabase, batch, date, requestedSessionId: String(params.get('session') || '').trim() })
    }

    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return jsonNoStore({ error: 'Invalid attendance status.' }, { status: 400 })
    }
    if (date && !parseIsoDate(date)) return jsonNoStore({ error: 'Invalid attendance date.' }, { status: 400 })

    let query = supabase
      .from('student_attendance')
      .select('id,student_id,batch,attendance_date,session_id,source,original_participant_name,status,marked_at,reviewed_at,reviewed_by,review_note')
      .order('attendance_date', { ascending: false })
      .order('marked_at', { ascending: false })
      .limit(500)

    if (batch) query = query.eq('batch', batch)
    if (date) query = query.eq('attendance_date', date)
    if (status !== 'all') query = query.eq('status', status)

    let countQuery = supabase.from('student_attendance').select('id,status')
    if (batch) countQuery = countQuery.eq('batch', batch)
    if (date) countQuery = countQuery.eq('attendance_date', date)

    const [{ data: rows, error }, { data: countRows, error: countError }] = await Promise.all([query, countQuery])
    if (error) {
      if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      throw error
    }
    if (countError) throw countError

    const rawRows = await loadAvailableSessions(supabase, rows || [], { batch, date })
    const allCountRows = countRows || []
    const studentIds = [...new Set(rawRows.map(r => r.student_id).filter(Boolean))]
    const { data: students, error: studentError } = studentIds.length
      ? await supabase.from('students').select('id,name,batch').in('id', studentIds).eq('status', 'active')
      : { data: [], error: null }
    if (studentError) throw studentError

    const studentById = new Map((students || []).map(s => [String(s.id), s]))
    const mapped = rawRows.map(row => ({
      ...row,
      student: studentById.get(String(row.student_id)) || { id: row.student_id, name: 'Inactive student', batch: null },
    }))
    const filtered = search
      ? mapped.filter(row => String(row.student?.name || '').toLowerCase().includes(search))
      : mapped

    return jsonNoStore({
      success: true,
      counts: {
        pending: allCountRows.filter(r => r.status === 'pending').length,
        approved: allCountRows.filter(r => r.status === 'approved').length,
        rejected: allCountRows.filter(r => r.status === 'rejected').length,
      },
      attendance: filtered,
    })
  } catch (error) {
    console.error('[admin-attendance] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load attendance.' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').trim().toLowerCase()

    if (action === 'mark_present') return await handleMarkPresent({ body, admin })

    const sessionId = String(body?.sessionId || '').trim()
    const rawIds = Array.isArray(body?.attendanceIds) ? body.attendanceIds : [body?.attendanceId]
    const attendanceIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))]
    const reviewNote = sanitizeStudentText(body?.reviewNote, 1000) || null

    if (!attendanceIds.length || !['approve', 'reject', 'resolve_session'].includes(action)) {
      return jsonNoStore({ error: 'attendanceId(s) and a valid action are required.' }, { status: 400 })
    }
    if (action === 'resolve_session' && (attendanceIds.length !== 1 || !sessionId)) {
      return jsonNoStore({ error: 'One attendance record and an authoritative session are required.' }, { status: 400 })
    }
    if (attendanceIds.length > 50) return jsonNoStore({ error: 'Select no more than 50 attendance records at once.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data: rows, error: loadError } = await supabase
      .from('student_attendance')
      .select('id,student_id,batch,attendance_date,session_id,status')
      .in('id', attendanceIds)
    if (loadError) {
      if (isMissingHealthCardSchema(loadError)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      throw loadError
    }

    const pendingRows = (rows || []).filter(r => r.status === 'pending')
    if (!pendingRows.length) return jsonNoStore({ error: 'No pending attendance records to review.' }, { status: 409 })

    if (action === 'resolve_session') {
      const row = pendingRows[0]
      if (row.session_id) return jsonNoStore({ error: 'Attendance already has a class session.' }, { status: 409 })
      const { data: session, error: sessionError } = await supabase
        .from('attendance_sessions')
        .select('id,batch,session_date,source')
        .eq('id', sessionId)
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!session || session.source === 'legacy_backfill' || String(session.batch) !== String(row.batch) || String(session.session_date) !== String(row.attendance_date)) {
        return jsonNoStore({ error: 'Choose an authoritative session matching this attendance batch and date.' }, { status: 409 })
      }
      const { data: linked, error: linkError } = await supabase
        .from('student_attendance')
        .update({ session_id: session.id, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'pending')
        .is('session_id', null)
        .select('id,student_id,batch,attendance_date,session_id,source,status,marked_at,reviewed_at,reviewed_by,review_note')
      if (linkError) throw linkError
      if (!linked?.length) return jsonNoStore({ error: 'Attendance was already resolved.' }, { status: 409 })
      await appendActivity({
        eventType: 'attendance_session_linked',
        description: `linked attendance to an authoritative class session for ${row.attendance_date}`,
        actorName: admin.name,
        actorRole: 'admin',
        action: 'resolve_session',
        metadata: { attendance_id: row.id, student_id: row.student_id, batch: row.batch, session_id: session.id },
        supabase,
      })
      return jsonNoStore({ success: true, attendance: linked[0], updated: linked, skipped: 0 })
    }

    const approvalConflict = getAttendanceApprovalConflict(pendingRows, action)
    if (approvalConflict) return jsonNoStore({ error: approvalConflict }, { status: 409 })

    const reviewedAt = new Date().toISOString()
    const ids = pendingRows.map(r => r.id)
    const { data: updated, error: updateError } = await supabase
      .from('student_attendance')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewed_at: reviewedAt,
        reviewed_by: admin.name,
        review_note: reviewNote,
        updated_at: reviewedAt,
      })
      .in('id', ids)
      .eq('status', 'pending')
      .select('id,student_id,batch,attendance_date,session_id,source,status,marked_at,reviewed_at,reviewed_by,review_note')

    if (updateError) throw updateError
    if (!updated?.length) return jsonNoStore({ error: 'Attendance was already reviewed.' }, { status: 409 })

    await Promise.all(updated.flatMap(row => [
      appendActivity({
        eventType: action === 'approve' ? 'attendance_approved' : 'attendance_rejected',
        description: `${action === 'approve' ? 'approved' : 'rejected'} attendance for ${row.attendance_date}`,
        actorName: admin.name,
        actorRole: 'admin',
        action,
        reason: reviewNote,
        metadata: { attendance_id: row.id, student_id: row.student_id, batch: row.batch },
        supabase,
      }),
      createNotification({
        userType: NOTIFICATION_USER_TYPE.STUDENT,
        userIdentifier: row.student_id,
        notificationType: action === 'approve' ? NOTIFICATION_TYPE.HEALTH_ATTENDANCE_APPROVED : NOTIFICATION_TYPE.HEALTH_ATTENDANCE_REJECTED,
        title: action === 'approve' ? 'Attendance approved' : 'Attendance rejected',
        message: action === 'approve'
          ? `Your attendance for ${row.attendance_date} was approved.`
          : `Your attendance for ${row.attendance_date} was rejected${reviewNote ? `: ${reviewNote}` : '.'}`,
        referenceType: 'student_attendance',
        referenceId: row.id,
        icon: action === 'approve' ? '✓' : '!',
        severity: action === 'approve' ? 'success' : 'warning',
        actionLabel: 'View Health Card',
        actionUrl: '/',
        supabase,
      }),
    ]))

    return jsonNoStore({
      success: true,
      attendance: updated[0] || null,
      updated,
      skipped: attendanceIds.length - updated.length,
    })
  } catch (error) {
    console.error('[admin-attendance] review failed', error?.message)
    return jsonNoStore({ error: 'Could not review attendance.' }, { status: 500 })
  }
}

async function loadAttendanceOverview({ supabase, batch, date, requestedSessionId }) {
  const [{ data: sessions, error: sessionError }, { data: students, error: studentError }] = await Promise.all([
    supabase
      .from('attendance_sessions')
      .select('id,batch,session_date,title,starts_at,ends_at,source,created_at')
      .eq('batch', batch)
      .eq('session_date', date)
      .neq('source', 'legacy_backfill')
      .order('starts_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('students')
      .select('id,name,batch,status')
      .eq('batch', batch)
      .eq('status', 'active')
      .order('name', { ascending: true }),
  ])
  if (sessionError) throw sessionError
  if (studentError) throw studentError

  const availableSessions = sessions || []
  const requested = availableSessions.find(session => String(session.id) === requestedSessionId)
  const selectedSession = requested || (availableSessions.length === 1 ? availableSessions[0] : null)
  const selectedSessionId = selectedSession?.id || ''

  let attendanceQuery = supabase
    .from('student_attendance')
    .select('id,student_id,batch,attendance_date,session_id,source,original_participant_name,status,marked_at,reviewed_at,reviewed_by,review_note')
    .eq('batch', batch)
    .eq('attendance_date', date)
    .order('marked_at', { ascending: false })
    .limit(1000)
  if (selectedSessionId) attendanceQuery = attendanceQuery.or(`session_id.eq.${selectedSessionId},session_id.is.null`)

  const { data: attendanceRows, error: attendanceError } = await attendanceQuery
  if (attendanceError) {
    if (isMissingHealthCardSchema(attendanceError)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
    throw attendanceError
  }

  const { data: unlinked, error: unlinkedError } = await supabase
    .from('unlinked_attendance')
    .select('id,participant_name,original_participant_name,corrected_display_name,batch,attendance_date,uploaded_by_role,uploaded_by_name,status,linked_student_id,created_at,import_id,session_id,suggested_student_id,match_score,match_type,match_reason')
    .eq('batch', batch)
    .eq('attendance_date', date)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(500)
  if (unlinkedError) throw unlinkedError

  const studentById = new Map((students || []).map(student => [String(student.id), student]))
  const mappedAttendance = (attendanceRows || []).map(row => ({
    ...row,
    student: studentById.get(String(row.student_id)) || { id: row.student_id, name: 'Inactive student', batch },
    available_sessions: availableSessions,
  }))

  const priority = row => {
    const sessionRank = selectedSessionId && String(row.session_id) === String(selectedSessionId) ? 0 : 1
    const statusRank = row.status === 'approved' ? 0 : row.status === 'pending' ? 1 : 2
    return sessionRank * 10 + statusRank
  }
  const selectedByStudent = new Map()
  for (const row of mappedAttendance) {
    if (!row.student_id) continue
    if (selectedSessionId && !row.session_id && row.status !== 'pending') continue
    const current = selectedByStudent.get(String(row.student_id))
    if (!current || priority(row) < priority(current)) selectedByStudent.set(String(row.student_id), row)
  }

  const roster = (students || []).map(student => {
    const attendance = selectedSessionId ? selectedByStudent.get(String(student.id)) || null : null
    return {
      student,
      attendance,
      status: attendance?.status === 'approved' ? 'present' : attendance?.status === 'pending' ? 'pending' : attendance?.status === 'rejected' ? 'rejected' : 'not_recorded',
    }
  })
  const requests = mappedAttendance.filter(row => row.status === 'pending')
  const present = roster.filter(row => row.status === 'present').length
  const counts = {
    present,
    pendingRequests: requests.length,
    needsAttention: (unlinked || []).length,
    notRecorded: roster.filter(row => row.status !== 'present').length,
    registered: roster.length,
    recorded: present,
  }

  return jsonNoStore({
    success: true,
    batch,
    date,
    sessions: availableSessions,
    selectedSessionId,
    selectedSession,
    roster,
    requests,
    unlinked: unlinked || [],
    counts,
  })
}

async function handleMarkPresent({ body, admin }) {
  const batch = String(body?.batch || '').trim()
  const date = String(body?.date || '').trim()
  const studentId = String(body?.studentId || '').trim()
  const sessionId = String(body?.sessionId || '').trim()
  if (!batch || !date || !studentId || !sessionId || !parseIsoDate(date)) {
    return jsonNoStore({ error: 'Choose a class session before marking attendance.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const [{ data: session, error: sessionError }, { data: student, error: studentError }] = await Promise.all([
    supabase.from('attendance_sessions').select('id,batch,session_date,source').eq('id', sessionId).maybeSingle(),
    supabase.from('students').select('id,name,batch,status').eq('id', studentId).eq('batch', batch).eq('status', 'active').maybeSingle(),
  ])
  if (sessionError) throw sessionError
  if (studentError) throw studentError
  if (!session || session.source === 'legacy_backfill' || String(session.batch) !== batch || String(session.session_date) !== date || !student) {
    return jsonNoStore({ error: 'Choose a valid class session for this batch and date.' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase.from('student_attendance').insert({
    student_id: student.id,
    batch,
    attendance_date: date,
    session_id: session.id,
    source: 'admin',
    original_participant_name: student.name,
    status: 'approved',
    marked_at: now,
    reviewed_at: now,
    reviewed_by: admin.name,
    review_note: 'Marked present by Admin.',
  }).select('id,student_id,batch,attendance_date,session_id,source,status,marked_at,reviewed_at,reviewed_by,review_note').single()

  if (error) {
    if (isUniqueViolation(error)) return jsonNoStore({ error: 'Attendance is already recorded for this student and class.' }, { status: 409 })
    throw error
  }

  await appendActivity({
    eventType: 'attendance_marked_present',
    description: `marked attendance present for ${student.name} on ${date}`,
    actorName: admin.name,
    actorRole: 'admin',
    action: 'mark_present',
    metadata: { attendance_id: data.id, student_id: student.id, batch, date, session_id: session.id },
    supabase,
  })

  return jsonNoStore({ success: true, attendance: data }, { status: 201 })
}
