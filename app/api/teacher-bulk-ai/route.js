import { NextResponse } from 'next/server'
import { AI_QUEUE_ITEM_COOLDOWN_MS, AI_STATUS } from '@/lib/ai/constants'
import { evaluateSubmission, getAiEvaluationLoad } from '@/lib/ai/orchestrator'
import { aiRuntimeSnapshot } from '@/lib/ai/runtime-state'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope, normalizeName } from '@/lib/teacher-scope'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

const JOB_RETENTION_MS = 15 * 60 * 1000
const BULK_TICK_BUDGET_MS = 42_000
const BULK_DEFAULT_MAX_ITEMS_PER_TICK = 1
const BULK_MAX_ITEMS_PER_TICK = 3
const BULK_DEFAULT_RETRY_LIMIT = 2
const BULK_MAX_RETRY_LIMIT = 4
const BULK_RETRY_BASE_MS = 1_500
const activeSubmissionIds = globalThis.__cfBulkAiActiveSubmissionIds || new Set()
const bulkJobs = globalThis.__cfTeacherBulkAiJobs || new Map()

globalThis.__cfBulkAiActiveSubmissionIds = activeSubmissionIds
globalThis.__cfTeacherBulkAiJobs = bulkJobs

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function getTeacherJobKey(name) {
  return normalizeName(name) || 'unknown-teacher'
}

function isJobActive(job) {
  return job && job.status === 'running'
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
      currentSubmissionId: null,
      currentState: null,
      lastProgressAt: null,
      startedAt: null,
      finishedAt: null,
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
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    remaining: Math.max(job.total - job.completed - job.failed - job.skipped, 0),
    currentSubmissionId: job.currentSubmissionId,
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

function isMissingAiFeedback(row) {
  return (
    row &&
    !row.feedback &&
    !row.ai_feedback &&
    row.ai_status !== AI_STATUS.PROCESSING
  )
}

function cleanupOldJobs() {
  const now = Date.now()
  for (const [key, job] of bulkJobs.entries()) {
    if (job.status === 'running') continue
    const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : 0
    if (finishedAt && now - finishedAt > JOB_RETENTION_MS) {
      bulkJobs.delete(key)
    }
  }
}

async function runBulkJob(job) {
  if (!job || job.status !== 'running') return
  if (job.processingTick) {
    console.info('[teacher-bulk-ai] queue tick skipped: already running', {
      jobId: job.id,
      remaining: job.submissionIds?.length || 0,
      completed: job.completed,
      failed: job.failed,
      skipped: job.skipped,
    })
    return
  }

  job.processingTick = true
  job.lastProgressAt = new Date().toISOString()

  const tickStartedAt = Date.now()
  let processedThisTick = 0
  const maxItems = bulkItemsPerTick()

  try {
    while (job.submissionIds.length && processedThisTick < maxItems && Date.now() - tickStartedAt < BULK_TICK_BUDGET_MS) {
      const nextIndex = nextReadySubmissionIndex(job)
      if (nextIndex === -1) {
        job.currentState = 'Waiting before retry'
        console.info('[teacher-bulk-ai] queue waiting for retry cooldown', {
          jobId: job.id,
          remaining: job.submissionIds.length,
          nextRetryAt: nextRetryAt(job),
        })
        break
      }

      const [submissionId] = job.submissionIds.splice(nextIndex, 1)
      if (activeSubmissionIds.has(submissionId)) {
        const retry = incrementAttempt(job, submissionId)
        if (retry <= bulkRetryLimit()) {
          requeueSubmission(job, submissionId, retryBackoffMs(retry))
          job.currentState = 'Queued behind active generation'
          logQueueProgress(job, 'duplicate-active-requeued', { submissionId, retry })
        } else {
          job.skipped += 1
          recordFailure(job, submissionId, 'Already being generated elsewhere', retry)
          logQueueProgress(job, 'duplicate-active-skipped', { submissionId, retry })
        }
        continue
      }

      activeSubmissionIds.add(submissionId)
      job.currentSubmissionId = submissionId
      job.currentState = 'Generating'
      const attempt = currentAttempt(job, submissionId) + 1
      setAttempt(job, submissionId, attempt)
      const itemStartedAt = Date.now()
      logQueueProgress(job, 'item-start', { submissionId, attempt })

      try {
        const result = await evaluateSubmission(submissionId, { allowRegenerate: false })
        const durationMs = Date.now() - itemStartedAt
        const provider = result?.evaluation?.diagnostics?.ai_provider?.final_provider_used ||
          result?.evaluation?.diagnostics?.ai_provider?.provider ||
          null

        if (result.status === AI_STATUS.READY) {
          job.completed += 1
          clearAttempt(job, submissionId)
          console.info('[teacher-bulk-ai] item complete', {
            jobId: job.id,
            submissionId,
            provider,
            attempt,
            durationMs,
            completed: job.completed,
            total: job.total,
            remaining: job.submissionIds.length,
          })
        } else if (result.status === AI_STATUS.PROCESSING) {
          if (attempt <= bulkRetryLimit()) {
            requeueSubmission(job, submissionId, retryBackoffMs(attempt, 2))
            job.currentState = 'Delayed provider response'
            console.warn('[teacher-bulk-ai] item deferred', {
              jobId: job.id,
              submissionId,
              attempt,
              durationMs,
              message: result.message || null,
              retryAt: job.retryAfterBySubmissionId[submissionId],
            })
          } else {
            job.skipped += 1
            recordFailure(job, submissionId, result.message || 'Evaluation still processing after retries', attempt)
            console.warn('[teacher-bulk-ai] item skipped after processing retries', {
              jobId: job.id,
              submissionId,
              attempt,
              durationMs,
            })
          }
        } else {
          const message = result.error || 'AI generation failed'
          if (shouldRetryFailedResult(message) && attempt <= bulkRetryLimit()) {
            requeueSubmission(job, submissionId, retryBackoffMs(attempt))
            job.currentState = 'Retrying failed item'
            console.warn('[teacher-bulk-ai] item failed and requeued', {
              jobId: job.id,
              submissionId,
              provider,
              attempt,
              durationMs,
              error: message,
              retryAt: job.retryAfterBySubmissionId[submissionId],
            })
          } else if (shouldSkipFailedResult(message)) {
            job.skipped += 1
            recordFailure(job, submissionId, message, attempt)
            console.warn('[teacher-bulk-ai] item skipped', {
              jobId: job.id,
              submissionId,
              provider,
              attempt,
              durationMs,
              error: message,
            })
          } else {
            job.failed += 1
            recordFailure(job, submissionId, message, attempt)
            console.error('[teacher-bulk-ai] item failed permanently', {
              jobId: job.id,
              submissionId,
              provider,
              attempt,
              durationMs,
              error: message,
            })
          }
        }
      } catch (err) {
        const durationMs = Date.now() - itemStartedAt
        const message = err?.message || 'AI generation failed'
        if (shouldRetryFailedResult(message) && attempt <= bulkRetryLimit()) {
          requeueSubmission(job, submissionId, retryBackoffMs(attempt))
          job.currentState = 'Retrying failed item'
          console.warn('[teacher-bulk-ai] item error requeued', {
            jobId: job.id,
            submissionId,
            attempt,
            durationMs,
            error: message,
            retryAt: job.retryAfterBySubmissionId[submissionId],
          })
        } else {
          job.failed += 1
          recordFailure(job, submissionId, message, attempt)
          console.error('[teacher-bulk-ai] item error failed permanently', {
            jobId: job.id,
            submissionId,
            attempt,
            durationMs,
            error: message,
          })
        }
      } finally {
        activeSubmissionIds.delete(submissionId)
        job.currentSubmissionId = null
      }

      processedThisTick += 1
      job.lastProgressAt = new Date().toISOString()
      logQueueProgress(job, 'tick-item-finished', { submissionId, processedThisTick })
      if (job.submissionIds.length && processedThisTick < maxItems) {
        await sleep(queueItemCooldownMs())
      }
    }

    if (!job.submissionIds.length) {
      job.status = 'complete'
      job.currentState = null
      job.finishedAt = new Date().toISOString()
      console.info('[teacher-bulk-ai] job complete', {
        jobId: job.id,
        total: job.total,
        completed: job.completed,
        failed: job.failed,
        skipped: job.skipped,
        durationMs: new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime(),
      })
    }
  } finally {
    job.processingTick = false
  }
}

export async function GET(request) {
  try {
    cleanupOldJobs()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const job = bulkJobs.get(getTeacherJobKey(teacher.name))
    if (isJobActive(job)) {
      await runBulkJob(job)
    }
    return jsonNoStore({ success: true, job: serializeJob(job) })
  } catch (err) {
    console.error('[teacher-bulk-ai] status failed', err?.message)
    return jsonNoStore({ error: 'Could not load bulk AI status' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    cleanupOldJobs()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const jobKey = getTeacherJobKey(teacher.name)
    const existingJob = bulkJobs.get(jobKey)
    if (isJobActive(existingJob)) {
      return jsonNoStore({ success: true, job: serializeJob(existingJob) }, { status: 202 })
    }

    const supabase = getSupabaseAdmin()
    await recoverStaleAiDrafts(supabase, { context: 'teacher-bulk-ai-start' })
    const scope = await getTeacherScope(supabase, teacher.name)
    const { data: submissions, error: submissionError } = scope.batchNames.length
      ? await supabase
        .from('submissions')
        .select('id, feedback, ai_feedback, ai_status')
        .in('batch', scope.batchNames)
      : { data: [], error: null }
    if (submissionError) throw new Error(submissionError.message)

    const submissionIds = (submissions || [])
      .filter(isMissingAiFeedback)
      .map(row => String(row.id))

    if (!submissionIds.length) {
      const emptyJob = {
        id: `${jobKey}-${Date.now()}`,
        status: 'complete',
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        submissionIds: [],
        currentSubmissionId: null,
        currentState: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }
      bulkJobs.set(jobKey, emptyJob)
      return jsonNoStore({ success: true, job: serializeJob(emptyJob) })
    }

    const job = {
      id: `${jobKey}-${Date.now()}`,
      status: 'running',
      total: submissionIds.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      submissionIds,
      attemptsBySubmissionId: {},
      retryAfterBySubmissionId: {},
      failures: [],
      currentSubmissionId: null,
      currentState: 'Queued',
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
      finishedAt: null,
    }

    bulkJobs.set(jobKey, job)
    console.info('[teacher-bulk-ai] job queued', {
      jobId: job.id,
      teacher: jobKey,
      total: job.total,
      queueConcurrencyLimit: getAiEvaluationLoad().limit,
      itemsPerTick: bulkItemsPerTick(),
      retryLimit: bulkRetryLimit(),
    })
    return jsonNoStore({ success: true, job: serializeJob(job) }, { status: 202 })
  } catch (err) {
    console.error('[teacher-bulk-ai] start failed', err?.message)
    return jsonNoStore({ error: 'Could not start bulk AI generation' }, { status: 500 })
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

function bulkItemsPerTick() {
  const configured = Number.parseInt(process.env.AI_BULK_ITEMS_PER_TICK || '', 10)
  if (Number.isFinite(configured) && configured >= 1) return Math.min(configured, BULK_MAX_ITEMS_PER_TICK)
  return BULK_DEFAULT_MAX_ITEMS_PER_TICK
}

function bulkRetryLimit() {
  const configured = Number.parseInt(process.env.AI_BULK_RETRY_LIMIT || '', 10)
  if (Number.isFinite(configured) && configured >= 0) return Math.min(configured, BULK_MAX_RETRY_LIMIT)
  return BULK_DEFAULT_RETRY_LIMIT
}

function currentAttempt(job, submissionId) {
  return Number(job.attemptsBySubmissionId?.[submissionId] || 0)
}

function setAttempt(job, submissionId, attempt) {
  job.attemptsBySubmissionId ||= {}
  job.attemptsBySubmissionId[submissionId] = attempt
}

function incrementAttempt(job, submissionId) {
  const attempt = currentAttempt(job, submissionId) + 1
  setAttempt(job, submissionId, attempt)
  return attempt
}

function clearAttempt(job, submissionId) {
  if (job.attemptsBySubmissionId) delete job.attemptsBySubmissionId[submissionId]
  if (job.retryAfterBySubmissionId) delete job.retryAfterBySubmissionId[submissionId]
}

function requeueSubmission(job, submissionId, delayMs) {
  job.retryAfterBySubmissionId ||= {}
  job.retryAfterBySubmissionId[submissionId] = new Date(Date.now() + delayMs).toISOString()
  if (!job.submissionIds.includes(submissionId)) {
    job.submissionIds.push(submissionId)
  }
}

function nextReadySubmissionIndex(job) {
  const now = Date.now()
  for (let index = 0; index < job.submissionIds.length; index += 1) {
    const submissionId = job.submissionIds[index]
    const retryAt = job.retryAfterBySubmissionId?.[submissionId]
    if (!retryAt || new Date(retryAt).getTime() <= now) return index
  }
  return -1
}

function nextRetryAt(job) {
  const times = job.submissionIds
    .map(id => job.retryAfterBySubmissionId?.[id])
    .filter(Boolean)
    .sort()
  return times[0] || null
}

function retryBackoffMs(attempt, multiplier = 1) {
  const base = queueItemCooldownMs() + BULK_RETRY_BASE_MS
  const jitter = Math.floor(Math.random() * 400)
  return Math.min(Math.round(base * multiplier * Math.pow(2, Math.max(attempt - 1, 0))) + jitter, 20_000)
}

function shouldRetryFailedResult(message) {
  return /temporarily|try again|busy|quota|rate limit|timeout|timed out|fetch failed|network|503|504|429|provider|service/i.test(String(message || ''))
}

function shouldSkipFailedResult(message) {
  return /not found|not eligible|already reviewed/i.test(String(message || ''))
}

function recordFailure(job, submissionId, error, attempt) {
  job.failures ||= []
  job.failures.push({
    submissionId,
    error: String(error || 'AI generation failed').slice(0, 280),
    attempt,
    at: new Date().toISOString(),
  })
  if (job.failures.length > 20) job.failures = job.failures.slice(-20)
}

function logQueueProgress(job, event, details = {}) {
  console.info('[teacher-bulk-ai] queue progress', {
    event,
    jobId: job.id,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    remaining: job.submissionIds.length,
    activeEvaluations: getAiEvaluationLoad().active,
    concurrencyLimit: getAiEvaluationLoad().limit,
    ...details,
  })
}
