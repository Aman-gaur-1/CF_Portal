import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
import { appendActivity } from '@/lib/activity-log'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import {
  HEALTH_CARD_EPOCH,
  getIndiaDateString,
  isMissingHealthCardSchema,
  isUniqueViolation,
} from '@/lib/student-health-card'
import { parseIsoDate } from '@/lib/health-card-admin'
import { validateSessionScopedAttendance } from '@/lib/attendance-session'

const MAX_QUERY_DAYS_BACK = 14

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

async function requireCurrentStudent(request, supabase) {
  const tokenStudent = getStudentFromRequest(request)
  if (!tokenStudent) return null

  const { data, error } = await supabase
    .from('students')
    .select('id,name,batch,status')
    .eq('id', tokenStudent.id)
    .eq('name', tokenStudent.name)
    .eq('batch', tokenStudent.batch)
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error
  return data || null
}

async function loadEligibleSessions({ supabase, student, date }) {
  const [{ data: sessions, error: sessionError }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase
      .from('attendance_sessions')
      .select('id,batch,session_date,title,starts_at,ends_at,source,created_at')
      .eq('batch', student.batch)
      .eq('session_date', date)
      .neq('source', 'legacy_backfill')
      .order('starts_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('student_batch_memberships')
      .select('starts_on,ends_on')
      .eq('student_id', student.id)
      .eq('batch', student.batch)
      .lte('starts_on', date)
      .order('starts_on', { ascending: false })
      .limit(10),
  ])
  if (sessionError) throw sessionError
  if (membershipError) throw membershipError

  const activeMembership = (memberships || []).find(membership => (
    !membership.ends_on || date < membership.ends_on
  ))
  if (!activeMembership) return []

  const eligibleSessions = sessions || []
  if (!eligibleSessions.length) return []
  const sessionIds = eligibleSessions.map(session => session.id)
  const { data: attendance, error: attendanceError } = await supabase
    .from('student_attendance')
    .select('session_id,status')
    .eq('student_id', student.id)
    .in('session_id', sessionIds)
  if (attendanceError) throw attendanceError

  const attendanceBySession = new Map((attendance || []).map(row => [String(row.session_id), row]))
  return eligibleSessions.map(session => ({
    id: session.id,
    title: session.title || 'Attendance session',
    sessionDate: session.session_date,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    source: session.source,
    alreadyMarked: attendanceBySession.has(String(session.id)),
    status: attendanceBySession.get(String(session.id))?.status || null,
  }))
}

export async function GET(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const student = await requireCurrentStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    const today = getIndiaDateString()
    const sessions = await loadEligibleSessions({ supabase, student, date: today })
    return jsonNoStore({ success: true, today, sessions })
  } catch (error) {
    console.error('[student-attendance] sessions failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Attendance sessions are not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not load eligible attendance sessions.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const student = await requireCurrentStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const queryDate = body?.date ? String(body.date).trim() : null
    const requestedSessionId = body?.sessionId ? String(body.sessionId).trim() : null
    const reason = sanitizeStudentText(body?.reason, 500) || null
    const today = getIndiaDateString()

    let attendanceDate = today
    let session = null
    let reviewNote = null
    let eventType = 'health_attendance_marked'
    let description = ''

    if (queryDate) {
      if (!parseIsoDate(queryDate)) return jsonNoStore({ error: 'Invalid date format.' }, { status: 400 })
      if (queryDate >= today) return jsonNoStore({ error: 'Missing attendance queries are for past dates only.' }, { status: 400 })
      if (queryDate < HEALTH_CARD_EPOCH) return jsonNoStore({ error: `Date must be on or after ${HEALTH_CARD_EPOCH}.` }, { status: 400 })
      const daysDiff = Math.floor((new Date(today) - new Date(queryDate)) / (1000 * 60 * 60 * 24))
      if (daysDiff > MAX_QUERY_DAYS_BACK) return jsonNoStore({ error: `Missing attendance can only be requested for the last ${MAX_QUERY_DAYS_BACK} days.` }, { status: 400 })
      attendanceDate = queryDate
      reviewNote = `Missing attendance request${reason ? `: ${reason}` : ''}`
      eventType = 'health_attendance_query'
      description = `student requested missing attendance for ${queryDate}`
    } else {
      if (today < HEALTH_CARD_EPOCH) return jsonNoStore({ error: 'Health Card attendance has not started yet.' }, { status: 400 })
      if (!requestedSessionId) return jsonNoStore({ error: 'Select an eligible class session before marking attendance.' }, { status: 400 })
      const eligibleSessions = await loadEligibleSessions({ supabase, student, date: today })
      session = eligibleSessions.find(candidate => String(candidate.id) === requestedSessionId)
      const sessionValidation = validateSessionScopedAttendance({
        sessionId: requestedSessionId,
        session,
        batch: student.batch,
        date: today,
      })
      if (!sessionValidation.valid) return jsonNoStore({ error: 'No eligible class session is available for attendance today.' }, { status: 409 })
      if (session.alreadyMarked) return jsonNoStore({ error: `Attendance has already been submitted for ${session.title}.` }, { status: 409 })
      description = `student marked attendance for ${today} · ${session.title}`
    }

    if (queryDate && requestedSessionId) {
      const eligibleSessions = await loadEligibleSessions({ supabase, student, date: attendanceDate })
      session = eligibleSessions.find(candidate => String(candidate.id) === requestedSessionId)
      const sessionValidation = validateSessionScopedAttendance({
        sessionId: requestedSessionId,
        session,
        batch: student.batch,
        date: attendanceDate,
      })
      if (!sessionValidation.valid) return jsonNoStore({ error: 'That attendance session is not eligible for this student and date.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('student_attendance')
      .insert({
        student_id: student.id,
        batch: student.batch,
        attendance_date: attendanceDate,
        session_id: session?.id || null,
        source: queryDate ? 'student_attendance_query' : 'student_self_mark',
        status: 'pending',
        marked_at: new Date().toISOString(),
        review_note: reviewNote,
      })
      .select('id,student_id,batch,attendance_date,status,marked_at,reviewed_at,reviewed_by,review_note')
      .single()

    if (error) {
      if (isUniqueViolation(error)) {
        const msg = queryDate
          ? `Attendance already exists for ${queryDate}.`
          : `Attendance has already been marked for ${session?.title || 'this session'}.`
        return jsonNoStore({ error: msg }, { status: 409 })
      }
      if (isMissingHealthCardSchema(error)) {
        return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      }
      throw error
    }

    await appendActivity({
      eventType,
      description,
      actorName: 'Student Health Card',
      actorRole: 'system',
      action: queryDate ? 'query' : 'mark',
      metadata: { attendance_id: data.id, student_id: data.student_id, batch: data.batch, session_id: session?.id || null },
      supabase,
    })

    return jsonNoStore({ success: true, attendance: data, session, isQuery: Boolean(queryDate) })
  } catch (error) {
    console.error('[student-attendance] create failed', error?.message)
    return jsonNoStore({ error: 'Could not mark attendance.' }, { status: 500 })
  }
}

