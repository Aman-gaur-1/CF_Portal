import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import {
  isPublishedSubmission,
  isStudentQueryEnabled,
  normalizeStudentIdentity,
  sanitizeQueryText,
  serializeAssignmentQuery,
  serializeAssignmentQueries,
} from '@/lib/assignment-queries'
import { createNotification, getAdminNotificationRecipients, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'

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

function normalizeId(value) {
  return String(value || '').trim()
}

async function validateStudentIdentity(supabase, identity) {
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

export async function GET(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const enabled = await isStudentQueryEnabled({ supabase })
    if (!enabled) return jsonNoStore({ enabled: false, queries: [] })

    const identity = normalizeStudentIdentity(getStudentFromRequest(request) || {})
    const student = await validateStudentIdentity(supabase, identity)
    if (!student) return jsonNoStore({ enabled, error: 'Student verification failed' }, { status: 401 })

    const { data, error } = await supabase
      .from('assignment_queries')
      .select(`
        *,
        submissions:submission_id (
          id,
          student_name,
          batch,
          topic,
          submitted_at,
          feedback_at,
          feedback_by
        )
      `)
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw new Error(error.message)
    return jsonNoStore({ enabled, queries: serializeAssignmentQueries(data || []) })
  } catch (err) {
    console.error('[student-queries] list failed', err?.message)
    return jsonNoStore({ error: 'Could not load queries' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const enabled = await isStudentQueryEnabled({ supabase })
    if (!enabled) return jsonNoStore({ enabled: false, error: 'Student queries are disabled' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const identity = normalizeStudentIdentity(getStudentFromRequest(request) || {})
    const studentId = normalizeId(identity.id)
    const submissionId = normalizeId(body?.submissionId)
    const queryText = sanitizeQueryText(body?.queryText)

    if (!studentId || !identity.name || !identity.batch || !submissionId || !queryText) {
      return jsonNoStore({ enabled, error: 'student identity, submissionId, and queryText are required' }, { status: 400 })
    }
    const student = await validateStudentIdentity(supabase, identity)
    if (!student) return jsonNoStore({ enabled, error: 'Student verification failed' }, { status: 401 })

    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('id, student_id, student_name, batch, topic, submitted_at, feedback, feedback_at, feedback_by')
      .eq('id', submissionId)
      .eq('student_id', student.id)
      .maybeSingle()

    if (submissionError) throw new Error(submissionError.message)
    if (!submission) return jsonNoStore({ enabled, error: 'Submission not found' }, { status: 404 })
    if (!isPublishedSubmission(submission)) {
      return jsonNoStore({ enabled, error: 'Queries can be raised only after feedback is published' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('assignment_queries')
      .insert({
        submission_id: submission.id,
        student_id: student.id,
        query_text: queryText,
        status: 'open',
        created_by: student.name || submission.student_name || 'student',
        updated_by: student.name || submission.student_name || 'student',
      })
      .select(`
        *,
        submissions:submission_id (
          id,
          student_name,
          batch,
          topic,
          submitted_at,
          feedback_at,
          feedback_by
        )
      `)
      .single()

    if (error) throw new Error(error.message)
    await createQueryNotifications({ supabase, query: data, submission, student })
    return jsonNoStore({ enabled, success: true, query: serializeAssignmentQuery(data) })
  } catch (err) {
    console.error('[student-queries] create failed', err?.message)
    return jsonNoStore({ error: 'Could not create query' }, { status: 500 })
  }
}

async function createQueryNotifications({ supabase, query, submission, student }) {
  const { data: batch } = await supabase
    .from('batches')
    .select('created_by')
    .eq('name', submission.batch)
    .maybeSingle()
  const trainerName = batch?.created_by || ''

  if (trainerName) {
    await createNotification({
      userType: NOTIFICATION_USER_TYPE.TEACHER,
      userIdentifier: trainerName,
      notificationType: NOTIFICATION_TYPE.NEW_STUDENT_QUERY,
      title: 'New student query',
      message: `${student.name || submission.student_name || 'A student'} asked about ${submission.topic || 'an assignment'}.`,
      referenceType: 'query',
      referenceId: query.id,
      icon: '?',
      severity: 'info',
      actionLabel: 'Open Query',
      actionUrl: '/teacher?tab=reviews',
      supabase,
    })
  }

  const admins = await getAdminNotificationRecipients(supabase)
  for (const adminName of admins) {
    await createNotification({
      userType: NOTIFICATION_USER_TYPE.ADMIN,
      userIdentifier: adminName,
      notificationType: NOTIFICATION_TYPE.NEW_STUDENT_QUERY,
      title: 'New student query',
      message: `${student.name || submission.student_name || 'A student'} raised a query for ${submission.topic || 'an assignment'}.`,
      referenceType: 'query',
      referenceId: query.id,
      icon: '?',
      severity: 'info',
      actionLabel: 'View Queries',
      actionUrl: '/admin?tab=queries',
      supabase,
    })
  }
}
