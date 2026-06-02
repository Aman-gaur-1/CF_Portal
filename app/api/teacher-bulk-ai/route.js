import { NextResponse } from 'next/server'
import { AI_STATUS } from '@/lib/ai/constants'
import { evaluateSubmission } from '@/lib/ai/orchestrator'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope, normalizeName } from '@/lib/teacher-scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_RETENTION_MS = 15 * 60 * 1000
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
      startedAt: null,
      finishedAt: null,
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
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error || null,
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
  for (const submissionId of job.submissionIds) {
    if (activeSubmissionIds.has(submissionId)) {
      job.skipped += 1
      continue
    }

    activeSubmissionIds.add(submissionId)
    job.currentSubmissionId = submissionId

    try {
      const result = await evaluateSubmission(submissionId, { allowRegenerate: false })
      if (result.status === AI_STATUS.READY) {
        job.completed += 1
      } else if (result.status === AI_STATUS.PROCESSING) {
        job.skipped += 1
      } else {
        job.failed += 1
      }
    } catch (err) {
      job.failed += 1
      console.error('[teacher-bulk-ai] item failed', { submissionId, error: err?.message })
    } finally {
      activeSubmissionIds.delete(submissionId)
      job.currentSubmissionId = null
    }
  }

  job.status = 'complete'
  job.finishedAt = new Date().toISOString()
}

export async function GET(request) {
  try {
    cleanupOldJobs()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const job = bulkJobs.get(getTeacherJobKey(teacher.name))
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
      currentSubmissionId: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }

    bulkJobs.set(jobKey, job)
    runBulkJob(job).catch(err => {
      console.error('[teacher-bulk-ai] job failed', err?.message)
      job.status = 'failed'
      job.error = 'Bulk AI generation stopped unexpectedly'
      job.finishedAt = new Date().toISOString()
    })

    return jsonNoStore({ success: true, job: serializeJob(job) }, { status: 202 })
  } catch (err) {
    console.error('[teacher-bulk-ai] start failed', err?.message)
    return jsonNoStore({ error: 'Could not start bulk AI generation' }, { status: 500 })
  }
}
