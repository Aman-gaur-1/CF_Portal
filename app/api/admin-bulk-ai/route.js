import { debugLog } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { AI_QUEUE_ITEM_COOLDOWN_MS, AI_STATUS } from '@/lib/ai/constants'
import { evaluateSubmission, getAiEvaluationLoad } from '@/lib/ai/orchestrator'
import { aiRuntimeSnapshot } from '@/lib/ai/runtime-state'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { normalizeName } from '@/lib/teacher-scope'
import { pageRange, paginationMeta, parsePage } from '@/lib/pagination'
import { normalizeSearchText } from '@/lib/submission-search'
import { appendActivity } from '@/lib/activity-log'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'
import { isReviewedSubmission } from '@/lib/review-state'
import { getSetting, setSetting } from '@/lib/system-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

const JOB_RETENTION_MS = 15 * 60 * 1000
const ADMIN_BULK_AI_JOB_SETTING = 'ADMIN_BULK_AI_JOB'
const ADMIN_BULK_AI_LOCK_NAME = 'admin_bulk_ai_job'
const ADMIN_BULK_AI_LOCK_LEASE_SECONDS = 50
const BULK_TICK_BUDGET_MS = 42_000
const BULK_DEFAULT_MAX_ITEMS_PER_TICK = 1
const BULK_MAX_ITEMS_PER_TICK = 3
const BULK_RETRY_LIMIT = 2

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function jsonNoStoreWithPayloadLog(body, meta = {}, init) {
  logPayloadSize('admin-bulk-ai', body, meta)
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

function isQueueRow(row) {
  return row && !isReviewedSubmission(row) && !row.ai_feedback
}

function isEligibleForGeneration(row) {
  return isQueueRow(row) && row.ai_status !== AI_STATUS.PROCESSING
}

function aiQueueStatus(row) {
  if (row.ai_status === AI_STATUS.PROCESSING) return 'Processing'
  if (row.ai_status === AI_STATUS.FAILED) return 'AI Failed'
  return 'No AI'
}

function serializeJob(job) {
  if (!job) {
    return {
      status: 'idle',
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
      currentState: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      currentSubmissionId: null,
      lastProgressAt: null,
      lastFailures: [],
      queue: {
        active: getAiEvaluationLoad().active,
        limit: getAiEvaluationLoad().limit,
      },
      metrics: aiRuntimeSnapshot({ queueDepth: 0 }),
    }
  }

  return {
    id: job.id,
    status: job.status,
    trainerName: job.trainerName,
    phase: job.phase || null,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    remaining: Math.max(job.total - job.completed - job.failed - job.skipped, 0),
    currentSubmissionId: job.currentSubmissionId || null,
    currentState: job.currentState || null,
    lastProgressAt: job.lastProgressAt || null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error || null,
    lastFailures: (job.failures || []).slice(-5),
    queue: {
      active: getAiEvaluationLoad().active,
      limit: getAiEvaluationLoad().limit,
    },
    metrics: aiRuntimeSnapshot({ queueDepth: Math.max(job.total - job.completed - job.failed - job.skipped, 0) }),
  }
}

async function getCurrentJob(supabase = getSupabaseAdmin()) {
  const job = await getSetting(ADMIN_BULK_AI_JOB_SETTING, null, { supabase })
  if (!job || typeof job !== 'object') return null
  if (job.status === 'running') return normalizeJob(job)
  const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : 0
  if (finishedAt && Date.now() - finishedAt > JOB_RETENTION_MS) return null
  return normalizeJob(job)
}

async function saveCurrentJob(job, supabase = getSupabaseAdmin()) {
  await setSetting(ADMIN_BULK_AI_JOB_SETTING, normalizeJob(job), 'Admin bulk AI generation job state.', { supabase })
}

function normalizeJob(job) {
  return {
    ...job,
    submissionIds: Array.isArray(job?.submissionIds) ? job.submissionIds.map(String) : [],
    failures: Array.isArray(job?.failures) ? job.failures : [],
    attemptsBySubmissionId: job?.attemptsBySubmissionId && typeof job.attemptsBySubmissionId === 'object' ? job.attemptsBySubmissionId : {},
    retryAfterBySubmissionId: job?.retryAfterBySubmissionId && typeof job.retryAfterBySubmissionId === 'object' ? job.retryAfterBySubmissionId : {},
  }
}

async function loadQueueData() {
  const supabase = getSupabaseAdmin()
  await recoverStaleAiDrafts(supabase, { context: 'admin-bulk-ai-load' })
  const [
    { data: trainers, error: trainerError },
    { data: batches, error: batchError },
    { data: submissions, error: submissionError },
  ] = await Promise.all([
    supabase.from('trainers').select('name').order('created_at'),
    supabase.from('batches').select('name, created_by').order('created_at'),
    supabase.from('submissions').select('id, student_name, topic, batch, phase, submitted_at, feedback, feedback_at, ai_feedback, ai_status').order('submitted_at', { ascending: false }),
  ])

  if (trainerError) throw trainerError
  if (batchError) throw batchError
  if (submissionError) throw submissionError

  const trainerNames = [...new Set([
    ...(trainers || []).map(trainer => trainer.name),
    ...(batches || []).map(batch => batch.created_by),
  ].filter(Boolean))]
  const trainerByBatch = new Map((batches || []).map(batch => [batch.name, batch.created_by || 'Unassigned']))
  const rows = (submissions || []).map(row => ({
    ...row,
    trainerName: trainerByBatch.get(row.batch) || 'Unassigned',
  }))

  return { trainerNames, rows }
}

async function loadQueuePage(request) {
  const supabase = getSupabaseAdmin()
  await recoverStaleAiDrafts(supabase, { context: 'admin-bulk-ai-page' })
  const { trainerNames, trainerByBatch, phaseNames } = await loadQueueMetadata(supabase)
  const params = request.nextUrl.searchParams
  const page = parsePage(params.get('page'))
  const trainerName = String(params.get('trainer') || '').trim()
  const phaseName = String(params.get('phase') || '').trim()
  let search = normalizeSearchText(params.get('search'))
  let query = supabase
    .from('submissions')
    .select('id, student_name, topic, batch, phase, submitted_at, ai_status, ai_error', { count: 'exact' })
    .is('feedback', null)
    .is('feedback_at', null)
    .is('ai_feedback', null)

  const trainerBatches = batchesForTrainer(trainerByBatch, trainerName)
  if (trainerName) {
    if (!trainerBatches.length) return emptyQueuePage(trainerNames, phaseNames, page, await loadQueueCounts(supabase, { trainerName, phase: phaseName }), await getCurrentJob(supabase))
    query = query.in('batch', trainerBatches)
  }
  if (phaseName) query = query.eq('phase', phaseName)

  ;({ query, search } = applyQueueStatusSearch(query, search))

  for (const term of search.split(' ').filter(Boolean)) {
    const trainerSearchBatches = batchesMatchingTrainer(trainerByBatch, term)
    const pattern = `*${escapePostgrestValue(term)}*`
    const conditions = [`student_name.ilike.${pattern}`, `topic.ilike.${pattern}`, `batch.ilike.${pattern}`, `ai_status.ilike.${pattern}`]
    if (trainerSearchBatches.length) conditions.push(`batch.in.(${trainerSearchBatches.map(escapePostgrestValue).join(',')})`)
    query = query.or(conditions.join(','))
  }

  const { from, to } = pageRange(page)
  const [{ data, count, error }, counts] = await Promise.all([
    query.order('submitted_at', { ascending: false }).range(from, to),
    loadQueueCounts(supabase, { batchNames: trainerBatches, trainerName, phase: phaseName }),
  ])
  if (error) throw error

  return {
    trainers: trainerNames,
    phases: phaseNames,
    counts,
    pagination: paginationMeta(page, count),
    metrics: aiRuntimeSnapshot({ queueDepth: counts.pending || 0 }),
    submissions: (data || []).map(row => ({
      id: row.id,
      studentName: row.student_name || 'Student',
      topic: row.topic || 'Untitled',
      batch: row.batch || 'No batch',
      phase: row.phase || 'Unassigned',
      submittedAt: row.submitted_at || null,
      trainerName: trainerByBatch.get(row.batch) || 'Unassigned',
      status: aiQueueStatus(row),
      failureReason: row.ai_status === AI_STATUS.FAILED ? classifyAiFailure(row.ai_error) : null,
    })),
    job: serializeJob(await getCurrentJob(supabase)),
  }
}

async function loadQueueMetadata(supabase) {
  const [{ data: trainers, error: trainerError }, { data: batches, error: batchError }, phasesResult] = await Promise.all([
    supabase.from('trainers').select('name').order('created_at'),
    supabase.from('batches').select('name, created_by').order('created_at'),
    supabase.from('assignment_phases').select('name').eq('is_active', true).order('display_order'),
  ])
  if (trainerError) throw trainerError
  if (batchError) throw batchError
  return {
    trainerNames: [...new Set([
      ...(trainers || []).map(trainer => trainer.name),
      ...(batches || []).map(batch => batch.created_by),
    ].filter(Boolean))],
    trainerByBatch: new Map((batches || []).map(batch => [batch.name, batch.created_by || 'Unassigned'])),
    phaseNames: (phasesResult.data || []).map(phase => phase.name).filter(Boolean),
  }
}

async function loadQueueCounts(supabase, { batchNames = [], trainerName = '', phase = '' } = {}) {
  const applyFilters = query => {
    if (trainerName && batchNames.length) query = query.in('batch', batchNames)
    if (String(phase || '').trim()) query = query.eq('phase', String(phase).trim())
    return query
  }
  const [pending, processing, failed, ready, alreadyGenerated, recentGenerated] = await Promise.all([
    countRows(applyFilters(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('feedback_at', null).is('ai_feedback', null).or(`ai_status.neq.${AI_STATUS.PROCESSING},ai_status.is.null`))),
    countRows(applyFilters(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('feedback_at', null).is('ai_feedback', null).eq('ai_status', AI_STATUS.PROCESSING))),
    countRows(applyFilters(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('feedback_at', null).is('ai_feedback', null).eq('ai_status', AI_STATUS.FAILED))),
    countRows(applyFilters(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('feedback_at', null).not('ai_feedback', 'is', null))),
    countRows(applyFilters(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('feedback_at', null).not('ai_feedback', 'is', null))),
    loadRecentGeneratedStats(applyFilters(supabase.from('submissions').select('submitted_at, ai_feedback_at, ai_status').not('ai_feedback_at', 'is', null).order('ai_feedback_at', { ascending: false }).limit(200))),
  ])
  const finished = ready + failed
  return {
    pending,
    processing,
    failed,
    ready,
    alreadyGenerated,
    successPercent: finished ? Math.round((ready / finished) * 100) : null,
    averageQueueMs: recentGenerated.averageQueueMs,
    lastGeneratedAt: recentGenerated.lastGeneratedAt,
  }
}

async function countRows(query) {
  const { count, error } = await query
  if (error) throw error
  return count || 0
}

async function loadRecentGeneratedStats(query) {
  const { data, error } = await query
  if (error) throw error
  let totalMs = 0
  let count = 0
  for (const row of data || []) {
    const start = row.submitted_at ? new Date(row.submitted_at).getTime() : 0
    const end = row.ai_feedback_at ? new Date(row.ai_feedback_at).getTime() : 0
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      totalMs += end - start
      count += 1
    }
  }
  return {
    averageQueueMs: count ? Math.round(totalMs / count) : null,
    lastGeneratedAt: data?.[0]?.ai_feedback_at || null,
  }
}

function classifyAiFailure(message) {
  const text = String(message || '').toLowerCase()
  if (/extract|ocr|parse|read|unreadable/.test(text)) return 'Extraction Failed'
  if (/timeout|timed out/.test(text)) return 'Timeout'
  if (/provider|api|rate|quota|503|504|429/.test(text)) return 'Provider Error'
  if (/manual review|needs review/.test(text)) return 'Needs Manual Review'
  if (/pdf/.test(text)) return 'Missing PDF'
  if (/unsupported/.test(text)) return 'Unsupported File'
  return message ? 'AI Failed' : 'No failure reason stored'
}

function batchesForTrainer(trainerByBatch, trainerName) {
  const trainerKey = normalizeName(trainerName)
  if (!trainerKey) return []
  return [...trainerByBatch.entries()]
    .filter(([, owner]) => normalizeName(owner) === trainerKey)
    .map(([batch]) => batch)
}

function batchesMatchingTrainer(trainerByBatch, term) {
  const key = normalizeName(term)
  return [...trainerByBatch.entries()]
    .filter(([, owner]) => normalizeName(owner).includes(key))
    .map(([batch]) => batch)
}

function emptyQueuePage(trainers, phases, page, counts, job = null) {
  return { trainers, phases, counts, pagination: paginationMeta(page, 0), submissions: [], job: serializeJob(job) }
}

function applyQueueStatusSearch(query, search) {
  if (search.includes('ai failed')) {
    query = query.eq('ai_status', AI_STATUS.FAILED)
    search = search.replace('ai failed', '')
  }
  if (search.includes('processing')) {
    query = query.eq('ai_status', AI_STATUS.PROCESSING)
    search = search.replace('processing', '')
  }
  if (search.includes('no ai')) {
    query = query.or(`ai_status.is.null,ai_status.eq.${AI_STATUS.PENDING}`)
    search = search.replace('no ai', '')
  }
  return { query, search }
}

function escapePostgrestValue(value) {
  return String(value || '').replace(/[,%()]/g, '')
}

async function processBulkJobTick(job, { supabase = getSupabaseAdmin() } = {}) {
  if (!job || job.status !== 'running') return job
  const owner = `${process.pid || 'server'}-${Date.now()}`
  const acquired = await tryAcquireBulkLock({ owner, supabase })
  if (!acquired) return job

  const startedAt = Date.now()
  let processed = 0
  const maxItems = bulkMaxItemsPerTick()

  try {
    while (job.submissionIds.length && processed < maxItems && Date.now() - startedAt < BULK_TICK_BUDGET_MS) {
      const submissionId = job.submissionIds.shift()
      const retryAfter = Number(job.retryAfterBySubmissionId?.[submissionId] || 0)
      if (retryAfter && retryAfter > Date.now()) {
        job.submissionIds.push(submissionId)
        job.currentState = 'Waiting for retry window'
        break
      }

    job.currentSubmissionId = submissionId
    job.currentState = 'Generating'
    job.lastProgressAt = new Date().toISOString()
    try {
      const result = await evaluateSubmission(submissionId, { allowRegenerate: false })
      if (result.status === AI_STATUS.READY) job.completed += 1
      else if (result.status === AI_STATUS.PROCESSING) {
        const attempt = Number(job.attemptsBySubmissionId?.[submissionId] || 0)
        if (attempt < BULK_RETRY_LIMIT) {
          job.attemptsBySubmissionId[submissionId] = attempt + 1
          job.retryAfterBySubmissionId[submissionId] = Date.now() + queueItemCooldownMs() * 2
          job.currentState = 'Delayed provider response'
          job.submissionIds.push(submissionId)
        } else {
          job.skipped += 1
        }
      }
      else job.failed += 1
    } catch (err) {
      job.failed += 1
      job.failures ||= []
      job.failures.push({
        submissionId,
        error: String(err?.message || 'AI generation failed').slice(0, 280),
        at: new Date().toISOString(),
      })
      if (job.failures.length > 20) job.failures = job.failures.slice(-20)
      console.error('[admin-bulk-ai] item failed', { submissionId, error: err?.message })
    } finally {
      job.currentSubmissionId = null
      job.lastProgressAt = new Date().toISOString()
    }
      processed += 1
    }

    if (!job.submissionIds.length) {
      job.status = 'complete'
      job.currentState = null
      job.finishedAt = new Date().toISOString()
    }
    await saveCurrentJob(job, supabase)
    return job
  } finally {
    await releaseBulkLock({ owner, supabase }).catch(err => {
      console.warn('[admin-bulk-ai] lock release failed', err?.message)
    })
  }
}

export async function GET(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    await recoverStaleAiDrafts(supabase, { context: 'admin-bulk-ai-load' })
    const currentJob = await getCurrentJob(supabase)
    if (currentJob?.status === 'running') await processBulkJobTick(currentJob, { supabase })
    const body = { success: true, ...await loadQueuePage(request) }
    return jsonNoStoreWithPayloadLog(body, {
      mode: 'queue-page',
      page: body.pagination?.page,
      total: body.pagination?.total,
    })
  } catch (err) {
    console.error('[admin-bulk-ai] load failed', err?.message)
    return jsonNoStore({ error: 'Could not load AI generation queue' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const activeJob = await getCurrentJob(supabase)
    if (activeJob?.status === 'running') {
      await processBulkJobTick(activeJob, { supabase })
      return jsonNoStore({ success: true, queued: 0, job: serializeJob(activeJob) }, { status: 202 })
    }

    const body = await request.json().catch(() => ({}))
    const trainerName = String(body?.trainerName || '').trim()
    const phaseName = String(body?.phase || '').trim()
    const submissionId = String(body?.submissionId || '').trim()
    const trainerKey = normalizeName(trainerName)
    const { rows } = await loadQueueData()
    const submissionIds = rows
      .filter(row => !submissionId || String(row.id) === submissionId)
      .filter(row => !trainerKey || normalizeName(row.trainerName) === trainerKey)
      .filter(row => !phaseName || row.phase === phaseName)
      .filter(isEligibleForGeneration)
      .map(row => String(row.id))

    const job = {
      id: `admin-${Date.now()}`,
      status: submissionIds.length ? 'running' : 'complete',
      trainerName: trainerName || null,
      phase: phaseName || null,
      total: submissionIds.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      submissionIds,
      failures: [],
      attemptsBySubmissionId: {},
      retryAfterBySubmissionId: {},
      currentSubmissionId: null,
      currentState: submissionIds.length ? 'Queued' : null,
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
      finishedAt: submissionIds.length ? null : new Date().toISOString(),
    }

    await saveCurrentJob(job, supabase)
    if (submissionIds.length) {
      await appendActivity({
        eventType: 'admin_bulk_ai_generation_queued',
        description: `queued ${submissionIds.length} AI drafts`,
        actorName: admin.name,
        actorRole: 'admin',
      })
      await processBulkJobTick(job, { supabase })
    }

    return jsonNoStoreWithPayloadLog(
      { success: true, queued: submissionIds.length, job: serializeJob(job) },
      { mode: 'queue-start', queued: submissionIds.length },
      { status: submissionIds.length ? 202 : 200 }
    )
  } catch (err) {
    console.error('[admin-bulk-ai] start failed', err?.message)
    return jsonNoStore({ error: 'Could not queue AI draft generation' }, { status: 500 })
  }
}

function queueItemCooldownMs() {
  const configured = Number.parseInt(process.env.AI_QUEUE_ITEM_COOLDOWN_MS || '', 10)
  if (Number.isFinite(configured) && configured >= 0) return Math.min(configured, 5_000)
  return AI_QUEUE_ITEM_COOLDOWN_MS
}

function bulkMaxItemsPerTick() {
  const configured = Number.parseInt(process.env.ADMIN_BULK_AI_MAX_ITEMS_PER_TICK || '', 10)
  if (Number.isFinite(configured) && configured > 0) return Math.min(configured, BULK_MAX_ITEMS_PER_TICK)
  return BULK_DEFAULT_MAX_ITEMS_PER_TICK
}

async function tryAcquireBulkLock({ owner, supabase }) {
  const { data, error } = await supabase.rpc('cf_acquire_cron_lock', {
    p_lock_name: ADMIN_BULK_AI_LOCK_NAME,
    p_lock_owner: owner,
    p_lease_seconds: ADMIN_BULK_AI_LOCK_LEASE_SECONDS,
  })
  if (error) throw new Error(error.message)
  return data === true
}

async function releaseBulkLock({ owner, supabase }) {
  const { error } = await supabase.rpc('cf_release_cron_lock', {
    p_lock_name: ADMIN_BULK_AI_LOCK_NAME,
    p_lock_owner: owner,
  })
  if (error) throw new Error(error.message)
}
