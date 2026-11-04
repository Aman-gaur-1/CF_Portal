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
  NOTIFICATION_USER_TYPE,
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
    .select('id,name,batch,status')
    .eq('id', identity.id)
    .eq('name', identity.name)
    .eq('batch', identity.batch)
    .eq('status', 'active')
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

export async function GET(request) {
  try {
    noStore()
    const recipient = await resolveRecipient(request)
    if (recipient.error) return jsonNoStore({ error: recipient.error }, { status: recipient.status })

    const limit = request.nextUrl.searchParams.get('limit')
    const before = request.nextUrl.searchParams.get('before')
    const analyticsRequested = request.nextUrl.searchParams.get('analytics') === '1'
    const [result, preferences, analytics] = await Promise.all([
      listNotifications({ ...recipient, limit, before }),
      getNotificationPreferences(recipient),
      recipient.userType === NOTIFICATION_USER_TYPE.ADMIN && analyticsRequested ? loadNotificationAnalytics(recipient) : Promise.resolve(null),
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
