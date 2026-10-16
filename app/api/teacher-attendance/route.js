import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { appendActivity } from '@/lib/activity-log'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { parseIsoDate } from '@/lib/health-card-admin'

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

function queryFilters(request, scope) {
  const params = request.nextUrl.searchParams
  const status = String(params.get('status') || 'pending').trim().toLowerCase()
  const batch = String(params.get('batch') || '').trim()
  const date = String(params.get('date') || '').trim()
  const search = String(params.get('search') || '').trim().toLowerCase()
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) return { error: 'Invalid attendance status.' }
  if (date && !parseIsoDate(date)) return { error: 'Invalid attendance date.' }
  if (batch && !scope.batchNames.includes(batch)) return { forbidden: true }
  return { status, batch, date, search }
}

function applyScopeFilters(query, filters, scope) {
  query = query.in('batch', filters.batch ? [filters.batch] : scope.batchNames)
  if (filters.date) query = query.eq('attendance_date', filters.date)
  return query
}

function mapStudentRows(rows, students) {
  const studentById = new Map((students || []).map(student => [String(student.id), student]))
  return (rows || []).map(row => ({
    ...row,
    student: studentById.get(String(row.student_id)) || { id: row.student_id, name: 'Inactive student', batch: null },
  }))
}

export async function GET(request) {
  try {
    noStore()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) return jsonNoStore({ success: true, attendance: [], batches: [], counts: { pending: 0, approved: 0, rejected: 0 } })

    const filters = queryFilters(request, scope)
    if (filters.error) return jsonNoStore({ error: filters.error }, { status: 400 })
    if (filters.forbidden) return jsonNoStore({ error: 'Attendance is outside this teacher scope.' }, { status: 403 })

    let query = supabase
      .from('student_attendance')
      .select('id,student_id,batch,attendance_date,status,marked_at,reviewed_at,reviewed_by,review_note')
      .order('attendance_date', { ascending: false })
      .order('marked_at', { ascending: false })
      .limit(500)
    query = applyScopeFilters(query, filters, scope)
    if (filters.status !== 'all') query = query.eq('status', filters.status)

    let countQuery = supabase.from('student_attendance').select('id,status')
    countQuery = applyScopeFilters(countQuery, filters, scope)
    const [{ data: rows, error }, { data: countRows, error: countError }] = await Promise.all([query, countQuery])
    if (error) {
      if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      throw error
    }
    if (countError) throw countError

    const rawRows = rows || []
    const allCountRows = countRows || []
    const studentIds = [...new Set(rawRows.map(row => row.student_id).filter(Boolean))]
    const { data: students, error: studentError } = studentIds.length
      ? await supabase.from('students').select('id,name,batch').in('id', studentIds)
      : { data: [], error: null }
    if (studentError) throw studentError
    const mapped = mapStudentRows(rawRows, students)
    const filteredRows = filters.search
      ? mapped.filter(row => String(row.student?.name || '').toLowerCase().includes(filters.search))
      : mapped

    return jsonNoStore({
      success: true,
      batches: scope.batchNames,
      filters: { status: filters.status, batch: filters.batch, date: filters.date, search: filters.search },
      counts: {
        pending: allCountRows.filter(row => row.status === 'pending').length,
        approved: allCountRows.filter(row => row.status === 'approved').length,
        rejected: allCountRows.filter(row => row.status === 'rejected').length,
      },
      attendance: filteredRows,
    })
  } catch (error) {
    console.error('[teacher-attendance] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load attendance.' }, { status: 500 })
  }
}

async function reviewRows({ supabase, scope, teacher, rows, action, reviewNote }) {
  const reviewedAt = new Date().toISOString()
  const ids = rows.map(row => row.id)
  const { data: updated, error: updateError } = await supabase
    .from('student_attendance')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewed_at: reviewedAt,
      reviewed_by: scope.teacherName || teacher.name,
      review_note: reviewNote,
      updated_at: reviewedAt,
    })
    .in('id', ids)
    .in('batch', scope.batchNames)
    .eq('status', 'pending')
    .select('id,student_id,batch,attendance_date,status,marked_at,reviewed_at,reviewed_by,review_note')

  if (updateError) throw updateError
  if (!updated?.length) return []

  await Promise.all(updated.flatMap(row => [
    appendActivity({
      eventType: action === 'approve' ? 'attendance_approved' : 'attendance_rejected',
      description: `${action === 'approve' ? 'approved' : 'rejected'} attendance for ${row.attendance_date}`,
      actorName: scope.teacherName || teacher.name,
      actorRole: 'teacher',
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
  return updated
}

export async function PATCH(request) {
  try {
    noStore()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').trim().toLowerCase()
    const rawIds = Array.isArray(body?.attendanceIds) ? body.attendanceIds : [body?.attendanceId]
    const attendanceIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))]
    const reviewNote = sanitizeStudentText(body?.reviewNote, 1000) || null
    if (!attendanceIds.length || !['approve', 'reject'].includes(action)) {
      return jsonNoStore({ error: 'attendanceId(s) and a valid action are required.' }, { status: 400 })
    }
    if (attendanceIds.length > 50) return jsonNoStore({ error: 'Select no more than 50 attendance records at once.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    const { data: rows, error: loadError } = await supabase
      .from('student_attendance')
      .select('id,student_id,batch,attendance_date,status')
      .in('id', attendanceIds)
    if (loadError) {
      if (isMissingHealthCardSchema(loadError)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      throw loadError
    }
    if ((rows || []).length !== attendanceIds.length || (rows || []).some(row => !scope.batchNames.includes(row.batch))) {
      return jsonNoStore({ error: 'Attendance is outside this teacher scope.' }, { status: 403 })
    }
    const pendingRows = (rows || []).filter(row => row.status === 'pending')
    if (!pendingRows.length) return jsonNoStore({ error: 'Attendance has already been reviewed.' }, { status: 409 })
    const updated = await reviewRows({ supabase, scope, teacher, rows: pendingRows, action, reviewNote })
    if (updated.length !== pendingRows.length && attendanceIds.length === 1) {
      return jsonNoStore({ error: 'Attendance was reviewed by another request.' }, { status: 409 })
    }
    return jsonNoStore({
      success: true,
      attendance: updated[0] || null,
      updated,
      skipped: attendanceIds.length - updated.length,
    })
  } catch (error) {
    console.error('[teacher-attendance] review failed', error?.message)
    return jsonNoStore({ error: 'Could not review attendance.' }, { status: 500 })
  }
}
