import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { appendActivity } from '@/lib/activity-log'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { parseIsoDate } from '@/lib/health-card-admin'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
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

    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return jsonNoStore({ error: 'Invalid attendance status.' }, { status: 400 })
    }
    if (date && !parseIsoDate(date)) return jsonNoStore({ error: 'Invalid attendance date.' }, { status: 400 })

    let query = supabase
      .from('student_attendance')
      .select('id,student_id,batch,attendance_date,status,marked_at,reviewed_at,reviewed_by,review_note')
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

    const rawRows = rows || []
    const allCountRows = countRows || []
    const studentIds = [...new Set(rawRows.map(r => r.student_id).filter(Boolean))]
    const { data: students, error: studentError } = studentIds.length
      ? await supabase.from('students').select('id,name,batch').in('id', studentIds)
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
    const rawIds = Array.isArray(body?.attendanceIds) ? body.attendanceIds : [body?.attendanceId]
    const attendanceIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))]
    const reviewNote = sanitizeStudentText(body?.reviewNote, 1000) || null

    if (!attendanceIds.length || !['approve', 'reject'].includes(action)) {
      return jsonNoStore({ error: 'attendanceId(s) and a valid action are required.' }, { status: 400 })
    }
    if (attendanceIds.length > 50) return jsonNoStore({ error: 'Select no more than 50 attendance records at once.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data: rows, error: loadError } = await supabase
      .from('student_attendance')
      .select('id,student_id,batch,attendance_date,status')
      .in('id', attendanceIds)
    if (loadError) {
      if (isMissingHealthCardSchema(loadError)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      throw loadError
    }

    const pendingRows = (rows || []).filter(r => r.status === 'pending')
    if (!pendingRows.length) return jsonNoStore({ error: 'No pending attendance records to review.' }, { status: 409 })

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
      .select('id,student_id,batch,attendance_date,status,marked_at,reviewed_at,reviewed_by,review_note')

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
