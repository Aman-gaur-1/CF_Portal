import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import {
  isValidQueryId,
  isStudentQueryEnabled,
  normalizeQueryStatus,
  QUERY_STATUS,
  sanitizeQueryResponse,
  serializeAssignmentQuery,
  serializeAssignmentQueries,
} from '@/lib/assignment-queries'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope, getTeacherScope } from '@/lib/teacher-scope'

export const dynamic = 'force-dynamic'
const QUERY_BATCH_SIZE = 150
const QUERY_LIST_LIMIT = 500
const QUERY_SELECT = `
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
`

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export async function GET(request) {
  try {
    noStore()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const enabled = await isStudentQueryEnabled({ supabase })
    if (!enabled) return jsonNoStore({ enabled: false, queries: [], counts: { open: 0, resolved: 0 } })

    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) return jsonNoStore({ enabled, queries: [], counts: { open: 0, resolved: 0 } })

    const { data: submissions, error: submissionError } = await supabase
      .from('submissions')
      .select('id')
      .in('batch', scope.batchNames)
    if (submissionError) throw new Error(submissionError.message)

    const submissionIds = (submissions || []).map(row => row.id)
    if (!submissionIds.length) return jsonNoStore({ enabled, queries: [], counts: { open: 0, resolved: 0 } })

    const status = normalizeQueryStatus(request.nextUrl.searchParams.get('status'))
    const hasStatusFilter = Boolean(request.nextUrl.searchParams.get('status'))
    const results = []
    for (const ids of chunk(submissionIds, QUERY_BATCH_SIZE)) {
      let query = supabase
        .from('assignment_queries')
        .select(QUERY_SELECT)
        .in('submission_id', ids)
        .order('created_at', { ascending: false })
        .limit(QUERY_LIST_LIMIT)

      if (hasStatusFilter) query = query.eq('status', status)

      const { data, error } = await query
      if (error) throw new Error(error.message)
      results.push(...(data || []))
    }

    const queries = serializeAssignmentQueries(results)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, QUERY_LIST_LIMIT)
    const counts = {
      open: queries.filter(item => item.status === QUERY_STATUS.OPEN).length,
      resolved: queries.filter(item => item.status === QUERY_STATUS.RESOLVED).length,
    }
    return jsonNoStore({ enabled, queries, counts, teacherName: scope.teacherName })
  } catch (err) {
    console.error('[teacher-queries] list failed', err?.message)
    return jsonNoStore({ error: 'Could not load queries' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    noStore()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const enabled = await isStudentQueryEnabled({ supabase })
    if (!enabled) return jsonNoStore({ enabled: false, error: 'Student queries are disabled' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const queryId = String(body?.queryId || '').trim()
    const response = sanitizeQueryResponse(body?.trainerResponse)
    if (!queryId || !isValidQueryId(queryId) || !response) {
      return jsonNoStore({ enabled, error: 'queryId and trainerResponse are required' }, { status: 400 })
    }

    const { data: existing, error: loadError } = await supabase
      .from('assignment_queries')
      .select('id, submission_id')
      .eq('id', queryId)
      .maybeSingle()
    if (loadError) throw new Error(loadError.message)
    if (!existing) return jsonNoStore({ enabled, error: 'Query not found' }, { status: 404 })

    const { scoped } = await assertSubmissionInTeacherScope(supabase, teacher.name, existing.submission_id)
    const trainerName = scoped.teacherName || teacher.name
    const resolvedAt = new Date().toISOString()

    const { data, error } = await supabase
      .from('assignment_queries')
      .update({
        trainer_response: response,
        status: QUERY_STATUS.RESOLVED,
        updated_at: resolvedAt,
        updated_by: trainerName,
        resolved_at: resolvedAt,
        resolved_by: trainerName,
      })
      .eq('id', queryId)
      .select(QUERY_SELECT)
      .single()

    if (error) throw new Error(error.message)
    await createResolvedQueryNotifications({ supabase, query: data })
    return jsonNoStore({ enabled, success: true, query: serializeAssignmentQuery(data) })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-queries] resolve failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not resolve query' }, { status })
  }
}

async function createResolvedQueryNotifications({ supabase, query }) {
  if (!query?.student_id) return
  const topic = query.submissions?.topic || 'your assignment'
  await createNotification({
    userType: NOTIFICATION_USER_TYPE.STUDENT,
    userIdentifier: query.student_id,
    notificationType: NOTIFICATION_TYPE.TRAINER_RESPONDED_TO_QUERY,
    title: 'Trainer responded',
    message: `Your trainer responded to your query about ${topic}.`,
    referenceType: 'query',
    referenceId: query.id,
    icon: 'R',
    severity: 'success',
    actionLabel: 'View Response',
    actionUrl: '/?tab=feedback',
    supabase,
  })
  await createNotification({
    userType: NOTIFICATION_USER_TYPE.STUDENT,
    userIdentifier: query.student_id,
    notificationType: NOTIFICATION_TYPE.QUERY_RESOLVED,
    title: 'Query resolved',
    message: `Your query about ${topic} has been resolved.`,
    referenceType: 'query',
    referenceId: query.id,
    icon: 'OK',
    severity: 'success',
    actionLabel: 'View Query',
    actionUrl: '/?tab=feedback',
    supabase,
  })
}
