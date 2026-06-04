import { NextResponse } from 'next/server'
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

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const JOB_RETENTION_MS = 15 * 60 * 1000
const activeSubmissionIds = globalThis.__cfBulkAiActiveSubmissionIds || new Set()
const adminJobs = globalThis.__cfAdminBulkAiJobs || new Map()

globalThis.__cfBulkAiActiveSubmissionIds = activeSubmissionIds
globalThis.__cfAdminBulkAiJobs = adminJobs

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function isQueueRow(row) {
  return row && !row.feedback && !row.ai_feedback
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
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    remaining: Math.max(job.total - job.completed - job.failed - job.skipped, 0),
    currentState: job.currentState || null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error || null,
    queue: {
      active: getAiEvaluationLoad().active,
      limit: getAiEvaluationLoad().limit,
    },
    metrics: aiRuntimeSnapshot({ queueDepth: Math.max(job.total - job.completed - job.failed - job.skipped, 0) }),
  }
}

function cleanupOldJobs() {
  const now = Date.now()
  for (const [key, job] of adminJobs.entries()) {
    if (job.status === 'running') continue
    const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : 0
    if (finishedAt && now - finishedAt > JOB_RETENTION_MS) adminJobs.delete(key)
  }
}

function getCurrentJob() {
  cleanupOldJobs()
  return [...adminJobs.values()].find(job => job.status === 'running') || [...adminJobs.values()].at(-1) || null
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
    supabase.from('submissions').select('id, student_name, topic, batch, submitted_at, feedback, ai_feedback, ai_status').order('submitted_at', { ascending: false }),
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
  const { trainerNames, trainerByBatch } = await loadQueueMetadata(supabase)
  const params = request.nextUrl.searchParams
  const page = parsePage(params.get('page'))
  const trainerName = String(params.get('trainer') || '').trim()
  let search = normalizeSearchText(params.get('search'))
  let query = supabase
    .from('submissions')
    .select('id, student_name, topic, batch, ai_status', { count: 'exact' })
    .is('feedback', null)
    .is('ai_feedback', null)

  const trainerBatches = batchesForTrainer(trainerByBatch, trainerName)
  if (trainerName) {
    if (!trainerBatches.length) return emptyQueuePage(trainerNames, page, await loadQueueCounts(supabase))
    query = query.in('batch', trainerBatches)
  }

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
    loadQueueCounts(supabase),
  ])
  if (error) throw error

  return {
    trainers: trainerNames,
    counts,
    pagination: paginationMeta(page, count),
    metrics: aiRuntimeSnapshot({ queueDepth: counts.pending || 0 }),
    submissions: (data || []).map(row => ({
      id: row.id,
      studentName: row.student_name || 'Student',
      topic: row.topic || 'Untitled',
      batch: row.batch || 'No batch',
      trainerName: trainerByBatch.get(row.batch) || 'Unassigned',
      status: aiQueueStatus(row),
    })),
    job: serializeJob(getCurrentJob()),
  }
}

async function loadQueueMetadata(supabase) {
  const [{ data: trainers, error: trainerError }, { data: batches, error: batchError }] = await Promise.all([
    supabase.from('trainers').select('name').order('created_at'),
    supabase.from('batches').select('name, created_by').order('created_at'),
  ])
  if (trainerError) throw trainerError
  if (batchError) throw batchError
  return {
    trainerNames: [...new Set([
      ...(trainers || []).map(trainer => trainer.name),
      ...(batches || []).map(batch => batch.created_by),
    ].filter(Boolean))],
    trainerByBatch: new Map((batches || []).map(batch => [batch.name, batch.created_by || 'Unassigned'])),
  }
}

async function loadQueueCounts(supabase) {
  const [pending, processing, failed, ready] = await Promise.all([
    countRows(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('ai_feedback', null).or(`ai_status.neq.${AI_STATUS.PROCESSING},ai_status.is.null`)),
    countRows(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('ai_feedback', null).eq('ai_status', AI_STATUS.PROCESSING)),
    countRows(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).is('ai_feedback', null).eq('ai_status', AI_STATUS.FAILED)),
    countRows(supabase.from('submissions').select('id', { count: 'exact', head: true }).is('feedback', null).not('ai_feedback', 'is', null)),
  ])
  return { pending, processing, failed, ready }
}

async function countRows(query) {
  const { count, error } = await query
  if (error) throw error
  return count || 0
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

function emptyQueuePage(trainers, page, counts) {
  return { trainers, counts, pagination: paginationMeta(page, 0), submissions: [], job: serializeJob(getCurrentJob()) }
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

async function runBulkJob(job) {
  const attempts = new Map()

  while (job.submissionIds.length) {
    const submissionId = job.submissionIds.shift()
    if (activeSubmissionIds.has(submissionId)) {
      const attempt = attempts.get(submissionId) || 0
      if (attempt < 2) {
        attempts.set(submissionId, attempt + 1)
        job.currentState = 'Queued'
        job.submissionIds.push(submissionId)
        await sleep(queueItemCooldownMs())
      } else {
        job.skipped += 1
      }
      continue
    }

    activeSubmissionIds.add(submissionId)
    job.currentState = 'Generating'
    try {
      const result = await evaluateSubmission(submissionId, { allowRegenerate: false })
      if (result.status === AI_STATUS.READY) job.completed += 1
      else if (result.status === AI_STATUS.PROCESSING) {
        const attempt = attempts.get(submissionId) || 0
        if (attempt < 2) {
          attempts.set(submissionId, attempt + 1)
          job.currentState = 'Delayed provider response'
          job.submissionIds.push(submissionId)
          await sleep(queueItemCooldownMs() * 2)
        } else {
          job.skipped += 1
        }
      }
      else job.failed += 1
    } catch (err) {
      job.failed += 1
      console.error('[admin-bulk-ai] item failed', { submissionId, error: err?.message })
    } finally {
      activeSubmissionIds.delete(submissionId)
    }
    await sleep(queueItemCooldownMs())
  }

  job.status = 'complete'
  job.currentState = null
  job.finishedAt = new Date().toISOString()
}

export async function GET(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    return jsonNoStore({ success: true, ...await loadQueuePage(request) })
  } catch (err) {
    console.error('[admin-bulk-ai] load failed', err?.message)
    return jsonNoStore({ error: 'Could not load AI generation queue' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const activeJob = getCurrentJob()
    if (activeJob?.status === 'running') {
      return jsonNoStore({ success: true, queued: 0, job: serializeJob(activeJob) }, { status: 202 })
    }

    const body = await request.json().catch(() => ({}))
    const trainerName = String(body?.trainerName || '').trim()
    const trainerKey = normalizeName(trainerName)
    const { rows } = await loadQueueData()
    const submissionIds = rows
      .filter(row => !trainerKey || normalizeName(row.trainerName) === trainerKey)
      .filter(isEligibleForGeneration)
      .map(row => String(row.id))

    const job = {
      id: `admin-${Date.now()}`,
      status: submissionIds.length ? 'running' : 'complete',
      trainerName: trainerName || null,
      total: submissionIds.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      submissionIds,
      currentState: submissionIds.length ? 'Queued' : null,
      startedAt: new Date().toISOString(),
      finishedAt: submissionIds.length ? null : new Date().toISOString(),
    }

    adminJobs.set(job.id, job)
    if (submissionIds.length) {
      await appendActivity({
        eventType: 'admin_bulk_ai_generation_queued',
        description: `queued ${submissionIds.length} AI drafts`,
        actorName: admin.name,
        actorRole: 'admin',
      })
      runBulkJob(job).catch(err => {
        console.error('[admin-bulk-ai] job failed', err?.message)
        job.status = 'failed'
        job.error = 'Bulk AI generation stopped unexpectedly'
        job.finishedAt = new Date().toISOString()
      })
    }

    return jsonNoStore({ success: true, queued: submissionIds.length, job: serializeJob(job) }, { status: submissionIds.length ? 202 : 200 })
  } catch (err) {
    console.error('[admin-bulk-ai] start failed', err?.message)
    return jsonNoStore({ error: 'Could not queue AI draft generation' }, { status: 500 })
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function queueItemCooldownMs() {
  const configured = Number.parseInt(process.env.AI_QUEUE_ITEM_COOLDOWN_MS || '', 10)
  if (Number.isFinite(configured) && configured >= 0) return Math.min(configured, 5_000)
  return AI_QUEUE_ITEM_COOLDOWN_MS
}
