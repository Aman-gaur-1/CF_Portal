import { debugLog } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getScopedTeacherData, getTeacherScope } from '@/lib/teacher-scope'
import { pageRange, paginationMeta, parsePage } from '@/lib/pagination'
import { normalizeSearchText } from '@/lib/submission-search'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'
import { withSignedAssignmentUrl } from '@/lib/assignment-file-access'
import {
  decorateSubmissionReviewState,
  isReviewedSubmission,
  summarizeReviewRows,
} from '@/lib/review-state'

export const dynamic = 'force-dynamic'

const REVIEW_LIST_SELECT = [
  'id',
  'student_id',
  'student_name',
  'batch',
  'topic',
  'submitted_at',
  'submission_type',
  'phase',
  'detected_assignment_language',
  'detected_assignment_phase',
  'detected_assignment_type',
  'final_evaluation_phase',
  'phase_detection_warning',
  'feedback_at',
  'feedback_by',
  'ai_status',
  'ai_error',
  'ai_workflow_state',
  'ai_failure_reason',
  'ai_retry_count',
  'ai_processing_started_at',
  'ai_last_duration_ms',
  'approval_method',
  'approved_by',
  'approved_at',
  'ai_feedback_at',
  'review_active_by',
  'review_active_at',
].join(',')

const REVIEW_DETAIL_SELECT = [
  'id',
  'student_id',
  'student_name',
  'batch',
  'topic',
  'submitted_at',
  'submission_type',
  'phase',
  'detected_assignment_language',
  'detected_assignment_phase',
  'detected_assignment_type',
  'final_evaluation_phase',
  'phase_detection_warning',
  'feedback',
  'feedback_at',
  'feedback_by',
  'ai_feedback',
  'ai_status',
  'ai_error',
  'ai_workflow_state',
  'ai_failure_reason',
  'ai_retry_count',
  'ai_processing_started_at',
  'ai_last_duration_ms',
  'approval_method',
  'approved_by',
  'approved_at',
  'ai_feedback_at',
  'ai_evaluation',
  'comment',
  'file_name',
  'original_file_name',
  'file_url',
  'code_text',
  'review_active_by',
  'review_active_at',
].join(',')

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function confirmedReviewedIds(params) {
  return new Set(
    String(params.get('confirmedReviewedIds') || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => /^\d+$/.test(id))
  )
}

export async function GET(request) {
  try {
    noStore()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const mode = request.nextUrl.searchParams.get('mode') || 'reviews'
    if (mode === 'summary') {
      const data = await getScopedTeacherData(getSupabaseAdmin(), teacher.name, { includeSubmissions: false })
      return jsonNoStoreWithPayloadLog('teacher-data', { success: true, ...data }, { mode, teacherName: teacher.name })
    }
    if (mode === 'detail') {
      return jsonNoStoreWithPayloadLog('teacher-data', { success: true, ...await loadSubmissionDetail(request, teacher.name) }, { mode, teacherName: teacher.name })
    }

    return jsonNoStoreWithPayloadLog('teacher-data', { success: true, ...await loadReviewPage(request, teacher.name) }, { mode, teacherName: teacher.name })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-data] failed', err?.message)
    return jsonNoStore({ error: status === 500 ? 'Could not load teacher data' : err.message }, { status })
  }
}

async function loadSubmissionDetail(request, teacherName) {
  const submissionId = String(request.nextUrl.searchParams.get('submissionId') || '').trim()
  if (!submissionId) {
    const error = new Error('submissionId is required')
    error.status = 400
    throw error
  }

  const supabase = getSupabaseAdmin()
  const scope = await getTeacherScope(supabase, teacherName)
  if (!scope.batchNames.length) {
    const error = new Error('Submission is outside this teacher scope')
    error.status = 403
    throw error
  }

  const { data: row, error } = await supabase
    .from('submissions')
    .select(REVIEW_DETAIL_SELECT)
    .eq('id', submissionId)
    .in('batch', scope.batchNames)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) {
    const notFound = new Error('Submission not found')
    notFound.status = 404
    throw notFound
  }

  return {
    submission: toDetailSubmission(await withSignedAssignmentUrl(row, { supabase })),
  }
}

async function loadReviewPage(request, teacherName) {
  const supabase = getSupabaseAdmin()
  await recoverStaleAiDrafts(supabase, { context: 'teacher-data', limit: 10 })
  const scope = await getTeacherScope(supabase, teacherName)
  const page = parsePage(request.nextUrl.searchParams.get('page'))
  const { from, to } = pageRange(page)

  if (!scope.batchNames.length) {
    return { ...scope, submissions: [], pagination: paginationMeta(page, 0) }
  }

  const confirmedIds = confirmedReviewedIds(request.nextUrl.searchParams)
  const openQuerySubmissionIds = await loadOpenQuerySubmissionIds(supabase, scope.batchNames, request.nextUrl.searchParams)
  if (openQuerySubmissionIds && !openQuerySubmissionIds.length) {
    return { ...scope, submissions: [], pagination: paginationMeta(page, 0) }
  }
  const filteredQuery = applyReviewQueryFilters(
    supabase
      .from('submissions')
      .select(REVIEW_LIST_SELECT, { count: 'exact' })
      .in('batch', scope.batchNames),
    request.nextUrl.searchParams,
    teacherName,
    openQuerySubmissionIds
  )

  const { data: rows, error, count } = await filteredQuery
    .order('submitted_at', { ascending: false })
    .range(from, to)
  if (error) throw new Error(error.message)

  const { data: summaryRows, error: summaryError } = await supabase
    .from('submissions')
    .select('id,feedback,feedback_at,ai_status')
    .in('batch', scope.batchNames)
  if (summaryError) throw new Error(summaryError.message)

  const decoratedRows = (rows || []).map(row => toListSubmission(row, confirmedIds))
  const filtered = filterReviewRows(decoratedRows, request.nextUrl.searchParams, scope.teacherName, confirmedIds)
  const decoratedSummaryRows = (summaryRows || []).map(row => decorateSubmissionReviewState(row, confirmedIds))
  const staleConfirmed = decoratedRows.filter(row => confirmedIds.has(String(row.id)) && !isReviewedSubmission(row))
  if (staleConfirmed.length) {
    console.warn('[teacher-data] confirmed published rows arrived stale from Supabase', {
      teacherName: scope.teacherName,
      staleIds: staleConfirmed.map(row => row.id).slice(0, 20),
      staleCount: staleConfirmed.length,
    })
  }
  debugLog('[teacher-data] review hydration', {
    teacherName: scope.teacherName,
    page,
    status: request.nextUrl.searchParams.get('status') || 'All',
    aiStatus: request.nextUrl.searchParams.get('aiStatus') || 'All',
    confirmedCount: confirmedIds.size,
    summary: summarizeReviewRows(decoratedSummaryRows, confirmedIds),
    filteredSummary: summarizeReviewRows(filtered, confirmedIds),
    returned: filtered.length,
    payloadKind: 'list',
  })

  return {
    ...scope,
    submissions: filtered,
    pagination: paginationMeta(page, count || 0),
  }
}

async function loadOpenQuerySubmissionIds(supabase, batchNames, params) {
  if ((params.get('status') || 'All') !== 'Open Queries') return null
  const { data: scopedSubmissions, error: submissionError } = await supabase
    .from('submissions')
    .select('id')
    .in('batch', batchNames)
  if (submissionError) throw new Error(submissionError.message)

  const scopedIds = (scopedSubmissions || []).map(row => row.id)
  if (!scopedIds.length) return []

  const { data: openQueries, error: queryError } = await supabase
    .from('assignment_queries')
    .select('submission_id')
    .eq('status', 'open')
    .in('submission_id', scopedIds)
    .limit(1000)
  if (queryError) throw new Error(queryError.message)

  return [...new Set((openQueries || []).map(row => row.submission_id).filter(Boolean))]
}

function applyReviewQueryFilters(query, params, teacherName, openQuerySubmissionIds = null) {
  let next = query
  const status = params.get('status') || 'All'
  const aiStatus = params.get('aiStatus') || 'All'
  const batch = params.get('batch') || 'All Batches'
  const search = normalizeSearchText(params.get('search'))

  if (status === 'Pending Feedback') next = next.is('feedback', null).is('feedback_at', null)
  if (status === 'Feedback Done') next = next.or('feedback.not.is.null,feedback_at.not.is.null')
  if (status === 'Failed AI') next = next.eq('ai_status', 'failed')
  if (status === 'Open Queries' && openQuerySubmissionIds) next = next.in('id', openQuerySubmissionIds)
  if (aiStatus !== 'All') next = next.eq('ai_status', aiStatus)
  if (batch !== 'All Batches') next = next.eq('batch', batch)

  const searchForQuery = applyReviewStatusSearchToQuery(search)
  if (searchForQuery) {
    const terms = searchForQuery
      .split(' ')
      .map(term => term.trim())
      .filter(term => term && !normalizeSearchText(teacherName).includes(term))
    for (const term of terms) {
      const escaped = term.replace(/[%_,]/g, '')
      if (escaped) {
        next = next.or(`student_name.ilike.%${escaped}%,topic.ilike.%${escaped}%,batch.ilike.%${escaped}%,ai_status.ilike.%${escaped}%`)
      }
    }
  }

  return next
}

function applyReviewStatusSearchToQuery(search) {
  let next = search
  next = next.replace('ai failed', '')
  next = next.replace('ai ready', '')
  next = next.replace('reviewed', '')
  next = next.replace('needs review', '')
  return next.trim()
}

function toListSubmission(row, confirmedIds) {
  return trimSubmissionForList(decorateSubmissionReviewState(row, confirmedIds))
}

function toDetailSubmission(row) {
  const decorated = decorateSubmissionReviewState(row)
  return {
    ...decorated,
    detailsLoaded: true,
    ai_score: normalizeAiScore(row.ai_evaluation?.score),
    ai_provider_diagnostics: row.ai_evaluation?.diagnostics?.ai_provider || null,
    ai_assignment_diagnostics: row.ai_evaluation?.diagnostics?.assignment_phase || {
      selected_phase: row.phase || null,
      detected_language: row.detected_assignment_language || null,
      detected_phase: row.detected_assignment_phase || null,
      detected_assignment_type: row.detected_assignment_type || null,
      final_evaluation_phase: row.final_evaluation_phase || null,
      mismatch: Boolean(row.phase_detection_warning),
    },
    ai_evaluation: undefined,
  }
}

function normalizeAiScore(score) {
  const value = Number(score)
  return Number.isFinite(value) ? value : null
}

function trimSubmissionForList(row) {
  return {
    id: row.id,
    student_id: row.student_id,
    student_name: row.student_name,
    batch: row.batch,
    topic: row.topic,
    submitted_at: row.submitted_at,
    submission_type: row.submission_type,
    phase: row.phase,
    detected_assignment_language: row.detected_assignment_language,
    detected_assignment_phase: row.detected_assignment_phase,
    detected_assignment_type: row.detected_assignment_type,
    final_evaluation_phase: row.final_evaluation_phase,
    phase_detection_warning: row.phase_detection_warning,
    feedback_at: row.feedback_at,
    feedback_by: row.feedback_by,
    ai_status: row.ai_status,
    ai_error: row.ai_error,
    ai_workflow_state: row.ai_workflow_state,
    ai_failure_reason: row.ai_failure_reason,
    ai_retry_count: row.ai_retry_count,
    ai_processing_started_at: row.ai_processing_started_at,
    ai_last_duration_ms: row.ai_last_duration_ms,
    approval_method: row.approval_method,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    ai_feedback_at: row.ai_feedback_at,
    review_active_by: row.review_active_by,
    review_active_at: row.review_active_at,
    reviewed: row.reviewed,
    reviewed_at: row.reviewed_at,
    review_status: row.review_status,
    durable_status: row.durable_status,
    detailsLoaded: false,
  }
}

function jsonNoStoreWithPayloadLog(context, body, meta = {}, init) {
  logPayloadSize(context, body, meta)
  return jsonNoStore(body, init)
}

function logPayloadSize(context, body, meta = {}) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
    debugLog(`[${context}] payload`, {
      ...meta,
      bytes,
      kb: Math.round(bytes / 1024),
      overTarget: bytes > 200 * 1024,
      submissions: Array.isArray(body?.submissions) ? body.submissions.length : undefined,
    })
  } catch (err) {
    console.warn(`[${context}] payload measurement failed`, { error: err?.message })
  }
}

function filterReviewRows(rows, params, teacherName, confirmedIds = new Set()) {
  const status = params.get('status') || 'All'
  const aiStatus = params.get('aiStatus') || 'All'
  const batch = params.get('batch') || 'All Batches'
  let search = normalizeSearchText(params.get('search'))

  return rows.filter(row => {
    if (status === 'Pending Feedback' && isReviewedSubmission(row, confirmedIds)) return false
    if (status === 'Feedback Done' && !isReviewedSubmission(row, confirmedIds)) return false
    if (status === 'Failed AI' && row.ai_status !== 'failed') return false
    if (aiStatus !== 'All' && row.ai_status !== aiStatus) return false
    if (batch !== 'All Batches' && row.batch !== batch) return false

    const rowSearch = applyReviewStatusSearchToRow(row, search, confirmedIds)
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

function applyReviewStatusSearchToRow(row, search, confirmedIds = new Set()) {
  if (search.includes('ai failed')) {
    if (row.ai_status !== 'failed') return null
    search = search.replace('ai failed', '')
  }
  if (search.includes('ai ready')) {
    if (row.ai_status !== 'ready') return null
    search = search.replace('ai ready', '')
  }
  if (search.includes('reviewed')) {
    if (!isReviewedSubmission(row, confirmedIds)) return null
    search = search.replace('reviewed', '')
  }
  if (search.includes('needs review')) {
    if (isReviewedSubmission(row, confirmedIds)) return null
    search = search.replace('needs review', '')
  }
  return search
}
