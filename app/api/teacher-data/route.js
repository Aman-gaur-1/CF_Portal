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

  const { data: rows, error } = await supabase
    .from('submissions')
    .select('*')
    .in('batch', scope.batchNames)
    .order('submitted_at', { ascending: false })
  if (error) throw new Error(error.message)

  const filtered = filterReviewRows(rows || [], request.nextUrl.searchParams, scope.teacherName)

  return {
    ...scope,
    submissions: filtered.slice(from, to + 1),
    pagination: paginationMeta(page, filtered.length),
  }
}

function isReviewedSubmission(row) {
  return Boolean(String(row?.feedback || '').trim() || row?.feedback_at)
}

function filterReviewRows(rows, params, teacherName) {
  const status = params.get('status') || 'All'
  const aiStatus = params.get('aiStatus') || 'All'
  const batch = params.get('batch') || 'All Batches'
  let search = normalizeSearchText(params.get('search'))

  return rows.filter(row => {
    if (status === 'Pending Feedback' && isReviewedSubmission(row)) return false
    if (status === 'Feedback Done' && !isReviewedSubmission(row)) return false
    if (status === 'Failed AI' && row.ai_status !== 'failed') return false
    if (aiStatus !== 'All' && row.ai_status !== aiStatus) return false
    if (batch !== 'All Batches' && row.batch !== batch) return false

    const rowSearch = applyReviewStatusSearchToRow(row, search)
    if (rowSearch === null) return false

    const haystack = normalizeSearchText([
      row.student_name,
      row.topic,
      row.batch,
      row.ai_status,
    ].filter(Boolean).join(' '))

    for (const term of rowSearch.split(' ').filter(Boolean)) {
      if (normalizeSearchText(teacherName).includes(term)) continue
      if (!haystack.includes(term)) return false
    }

    return true
  })
}

function applyReviewStatusSearchToRow(row, search) {
  if (search.includes('ai failed')) {
    if (row.ai_status !== 'failed') return null
    search = search.replace('ai failed', '')
  }
  if (search.includes('ai ready')) {
    if (row.ai_status !== 'ready') return null
    search = search.replace('ai ready', '')
  }
  if (search.includes('reviewed')) {
    if (!isReviewedSubmission(row)) return null
    search = search.replace('reviewed', '')
  }
  if (search.includes('needs review')) {
    if (isReviewedSubmission(row)) return null
    search = search.replace('needs review', '')
  }
  return search
}
