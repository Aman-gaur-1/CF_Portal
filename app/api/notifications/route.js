import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getStudentFromRequest } from '@/lib/student-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  listNotifications,
  markNotificationRead,
  markReferenceNotificationsRead,
  getNotificationPreferences,
  setNotificationPreferences,
  loadNotificationAnalytics,
  NOTIFICATION_TYPE,
  NOTIFICATION_USER_TYPE,
  createNotification,
  getAdminNotificationRecipients,
} from '@/lib/notifications'

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

function normalizeStudentIdentity(value = {}) {
  return {
    id: String(value.studentId || value.id || '').trim(),
    name: String(value.studentName || value.name || '').trim(),
    batch: String(value.studentBatch || value.batch || '').trim(),
  }
}

async function validateStudent(supabase, identity) {
  if (!identity.id || !identity.name || !identity.batch) return null
  const { data, error } = await supabase
    .from('students')
    .select('id,name,batch')
    .eq('id', identity.id)
    .eq('name', identity.name)
    .eq('batch', identity.batch)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

async function resolveRecipient(request, body = null) {
  const supabase = getSupabaseAdmin()
  const params = request.nextUrl?.searchParams
  const userType = String(body?.userType || params?.get('userType') || '').trim().toLowerCase()

  if (userType === NOTIFICATION_USER_TYPE.STUDENT) {
    const identity = normalizeStudentIdentity(getStudentFromRequest(request) || {})
    const student = await validateStudent(supabase, identity)
    if (!student) return { error: 'Student verification failed', status: 401 }
    return { supabase, userType, userIdentifier: student.id }
  }

  if (userType === NOTIFICATION_USER_TYPE.TEACHER) {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return { error: 'Unauthorized', status: 401 }
    return { supabase, userType, userIdentifier: teacher.name }
  }

  if (userType === NOTIFICATION_USER_TYPE.ADMIN) {
    const admin = getAdminFromRequest(request)
    if (!admin) return { error: 'Unauthorized', status: 401 }
    return { supabase, userType, userIdentifier: admin.name }
  }

  return { error: 'Invalid userType', status: 400 }
}

async function ensureOperationalNotifications({ supabase, userType, userIdentifier }) {
  if (userType !== NOTIFICATION_USER_TYPE.TEACHER && userType !== NOTIFICATION_USER_TYPE.ADMIN) return

  const cutoff24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const cutoff48 = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  let query = supabase
    .from('assignment_queries')
    .select(`
      id,
      created_at,
      submissions:submission_id (
        id,
        student_name,
        batch,
        topic
      )
    `)
    .eq('status', 'open')
    .lte('created_at', cutoff24)
    .limit(100)

  if (userType === NOTIFICATION_USER_TYPE.TEACHER) {
    const { data: batches, error: batchError } = await supabase.from('batches').select('name').eq('created_by', userIdentifier)
    if (batchError) throw new Error(batchError.message)
    const batchNames = (batches || []).map(batch => batch.name).filter(Boolean)
    if (!batchNames.length) return
    const { data: submissions, error: submissionError } = await supabase.from('submissions').select('id').in('batch', batchNames)
    if (submissionError) throw new Error(submissionError.message)
    const ids = (submissions || []).map(row => row.id)
    if (!ids.length) return
    query = query.in('submission_id', ids)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  for (const row of data || []) {
    const submission = row.submissions || {}
    if (userType === NOTIFICATION_USER_TYPE.TEACHER) {
      await createNotification({
        userType,
        userIdentifier,
        notificationType: NOTIFICATION_TYPE.HIGH_PRIORITY_QUERY,
        title: 'High priority query',
        message: `${submission.student_name || 'A student'} has a query pending for more than 24 hours.`,
        referenceType: 'query',
        referenceId: row.id,
        icon: '!',
        severity: 'warning',
        actionLabel: 'Review Query',
        actionUrl: '/teacher?tab=reviews&filter=open-queries',
        pinned: true,
        supabase,
      })
    } else {
      const recipients = await getAdminNotificationRecipients(supabase)
      const olderThan48 = row.created_at <= cutoff48
      for (const adminName of recipients) {
        await createNotification({
          userType: NOTIFICATION_USER_TYPE.ADMIN,
          userIdentifier: adminName,
          notificationType: olderThan48 ? NOTIFICATION_TYPE.QUERIES_PENDING_48H : NOTIFICATION_TYPE.QUERIES_PENDING_24H,
          title: olderThan48 ? 'Query pending over 48h' : 'Query pending over 24h',
          message: `${submission.student_name || 'A student'} has an unresolved query for ${submission.topic || 'an assignment'}.`,
          referenceType: 'query',
          referenceId: row.id,
          icon: '!',
          severity: olderThan48 ? 'error' : 'warning',
          actionLabel: 'View Queries',
          actionUrl: '/admin?tab=queries',
          pinned: true,
          supabase,
        })
      }
    }
  }
}

export async function GET(request) {
  try {
    noStore()
    const recipient = await resolveRecipient(request)
    if (recipient.error) return jsonNoStore({ error: recipient.error }, { status: recipient.status })

    await ensureOperationalNotifications(recipient)
    const limit = request.nextUrl.searchParams.get('limit')
    const before = request.nextUrl.searchParams.get('before')
    const [result, preferences, analytics] = await Promise.all([
      listNotifications({ ...recipient, limit, before }),
      getNotificationPreferences(recipient),
      recipient.userType === NOTIFICATION_USER_TYPE.ADMIN ? loadNotificationAnalytics(recipient) : Promise.resolve(null),
    ])
    return jsonNoStore({ success: true, ...result, preferences, analytics })
  } catch (err) {
    console.error('[notifications] list failed', err?.message)
    return jsonNoStore({ error: 'Could not load notifications' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    noStore()
    const body = await request.json().catch(() => ({}))
    const recipient = await resolveRecipient(request, body)
    if (recipient.error) return jsonNoStore({ error: recipient.error }, { status: recipient.status })

    if (body?.action === 'update_preferences') {
      const preferences = await setNotificationPreferences({ ...recipient, preferences: body?.preferences || {} })
      return jsonNoStore({ success: true, preferences })
    }

    if (body?.action === 'mark_reference_read') {
      const updated = await markReferenceNotificationsRead({
        ...recipient,
        referenceType: body?.referenceType,
        referenceIds: body?.referenceIds,
      })
      return jsonNoStore({ success: true, updated })
    }

    const updated = await markNotificationRead({
      ...recipient,
      notificationId: body?.notificationId,
      all: body?.action === 'mark_all_read',
    })
    return jsonNoStore({ success: true, updated })
  } catch (err) {
    console.error('[notifications] mark read failed', err?.message)
    return jsonNoStore({ error: 'Could not update notifications' }, { status: 500 })
  }
}
