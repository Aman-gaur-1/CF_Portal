import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getScopedTeacherData, getTeacherScope } from '@/lib/teacher-scope'
import { pageRange, paginationMeta, parsePage } from '@/lib/pagination'
import { normalizeSearchText } from '@/lib/submission-search'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'

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

export async function GET(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const mode = request.nextUrl.searchParams.get('mode') || 'reviews'
    if (mode === 'summary') {
      const data = await getScopedTeacherData(getSupabaseAdmin(), teacher.name, { includeSubmissions: false })
      return jsonNoStore({ success: true, ...data })
    }

    return jsonNoStore({ success: true, ...await loadReviewPage(request, teacher.name) })
  } catch (err) {
    console.error('[teacher-data] failed', err?.message)
    return jsonNoStore({ error: 'Could not load teacher data' }, { status: 500 })
  }
}

async function loadReviewPage(request, teacherName) {
  const supabase = getSupabaseAdmin()
  await recoverStaleAiDrafts(supabase, { context: 'teacher-data' })
  const scope = await getTeacherScope(supabase, teacherName)
  const page = parsePage(request.nextUrl.searchParams.get('page'))
  const { from, to } = pageRange(page)

  if (!scope.batchNames.length) {
    return { ...scope, submissions: [], pagination: paginationMeta(page, 0) }
  }

  let query = supabase
    .from('submissions')
    .select('*', { count: 'exact' })
    .in('batch', scope.batchNames)

  query = applyReviewFilters(query, request.nextUrl.searchParams, scope.teacherName)
  const { data, count, error } = await query.order('submitted_at', { ascending: false }).range(from, to)
  if (error) throw new Error(error.message)

  return {
    ...scope,
    submissions: data || [],
    pagination: paginationMeta(page, count),
  }
}

function applyReviewFilters(query, params, teacherName) {
  const status = params.get('status') || 'All'
  const aiStatus = params.get('aiStatus') || 'All'
  const batch = params.get('batch') || 'All Batches'
  let search = normalizeSearchText(params.get('search'))

  if (status === 'Pending Feedback') query = query.is('feedback', null).is('feedback_at', null)
  if (status === 'Feedback Done') query = query.or('feedback.not.is.null,feedback_at.not.is.null')
  if (status === 'Failed AI') query = query.eq('ai_status', 'failed')
  if (aiStatus !== 'All') query = query.eq('ai_status', aiStatus)
  if (batch !== 'All Batches') query = query.eq('batch', batch)

  ;({ query, search } = applyReviewStatusSearch(query, search))

  for (const term of search.split(' ').filter(Boolean)) {
    if (normalizeSearchText(teacherName).includes(term)) continue
    const pattern = `*${escapePostgrestValue(term)}*`
    query = query.or(`student_name.ilike.${pattern},topic.ilike.${pattern},batch.ilike.${pattern},ai_status.ilike.${pattern}`)
  }

  return query
}

function applyReviewStatusSearch(query, search) {
  if (search.includes('ai failed')) {
    query = query.eq('ai_status', 'failed')
    search = search.replace('ai failed', '')
  }
  if (search.includes('ai ready')) {
    query = query.eq('ai_status', 'ready')
    search = search.replace('ai ready', '')
  }
  if (search.includes('reviewed')) {
    query = query.or('feedback.not.is.null,feedback_at.not.is.null')
    search = search.replace('reviewed', '')
  }
  if (search.includes('needs review')) {
    query = query.is('feedback', null).is('feedback_at', null)
    search = search.replace('needs review', '')
  }
  return { query, search }
}

function escapePostgrestValue(value) {
  return String(value || '').replace(/[,%()]/g, '')
}
