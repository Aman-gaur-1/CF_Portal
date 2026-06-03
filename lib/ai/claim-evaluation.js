import { AI_STATUS } from './constants'

/** Reclaim jobs stuck in processing (e.g. serverless timeout). */
export const STALE_PROCESSING_MS = 5 * 60 * 1000

/** Pending with no worker — allow re-trigger after this window. */
export const STALE_PENDING_MS = 3 * 60 * 1000

export const STALE_RECOVERY_LIMIT = 100

function processingAnchor(submission) {
  return submission.ai_feedback_at || submission.submitted_at || null
}

export function isStalePending(submission) {
  if (submission.ai_status !== AI_STATUS.PENDING) return false
  if (!submission.submitted_at) return true
  return Date.now() - new Date(submission.submitted_at).getTime() > STALE_PENDING_MS
}

export function isStaleProcessing(submission) {
  if (submission.ai_status !== AI_STATUS.PROCESSING) return false

  const anchor = processingAnchor(submission)

  if (!anchor) return true

  const elapsed = Date.now() - new Date(anchor).getTime()
  return elapsed > STALE_PROCESSING_MS
}

function staleProcessingReason(submission) {
  if (!processingAnchor(submission)) return 'missing_processing_timestamp'
  return 'processing_timeout'
}

export function processingDurationMs(submission) {
  const anchor = processingAnchor(submission)
  if (!anchor) return null
  const elapsed = Date.now() - new Date(anchor).getTime()
  return Number.isFinite(elapsed) ? elapsed : null
}

export async function recoverStaleAiDrafts(supabase, { limit = STALE_RECOVERY_LIMIT, context = 'ai-recovery' } = {}) {
  const { data: rows, error } = await supabase
    .from('submissions')
    .select('id, ai_status, ai_feedback_at, submitted_at, feedback, ai_feedback')
    .is('feedback', null)
    .is('ai_feedback', null)
    .in('ai_status', [AI_STATUS.PROCESSING, AI_STATUS.PENDING])
    .limit(limit)

  if (error) {
    console.warn('[AI] stale draft recovery scan failed', { context, error: error.message })
    return { recovered: 0, error: error.message }
  }

  const staleRows = (rows || []).filter(row => isStaleProcessing(row) || isStalePending(row))
  let recovered = 0

  for (const row of staleRows) {
    const reason = row.ai_status === AI_STATUS.PROCESSING
      ? staleProcessingReason(row)
      : 'pending_timeout'
    const elapsedMs = row.ai_status === AI_STATUS.PROCESSING ? processingDurationMs(row) : null

    const { data: updatedRows, error: updateError } = await supabase
      .from('submissions')
      .update({
        ai_status: AI_STATUS.FAILED,
        ai_error: reason === 'pending_timeout'
          ? 'AI draft did not start in time. You can generate again.'
          : 'AI draft timed out. You can retry generation.',
      })
      .eq('id', row.id)
      .eq('ai_status', row.ai_status)
      .is('feedback', null)
      .is('ai_feedback', null)
      .select('id')

    if (updateError) {
      console.warn('[AI] stale draft recovery update failed', {
        context,
        submissionId: row.id,
        reason,
        error: updateError.message,
      })
      continue
    }

    if (updatedRows?.length) {
      recovered += 1
      console.warn('[AI] stale draft recovered', {
        context,
        submissionId: row.id,
        previousStatus: row.ai_status,
        reason,
        elapsedMs,
        timeoutMs: row.ai_status === AI_STATUS.PROCESSING ? STALE_PROCESSING_MS : STALE_PENDING_MS,
      })
    }
  }

  return { recovered }
}

/**
 * Atomically claim a submission for evaluation (prevents duplicate concurrent jobs).
 * @returns {{ claimed: boolean, submission?: object, stale?: boolean }}
 */
export async function claimSubmissionForEvaluation(supabase, submissionId, { allowRegenerate = true } = {}) {
  const { data: current, error: loadError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single()

  if (loadError || !current) {
    return { claimed: false, notFound: true }
  }

  if (current.ai_status === AI_STATUS.PROCESSING) {
    if (isStaleProcessing(current)) {
      console.info('[AI] reclaiming stale processing submission', {
        submissionId,
        reason: staleProcessingReason(current),
        elapsedMs: processingDurationMs(current),
        timeoutMs: STALE_PROCESSING_MS,
      })
      await supabase
        .from('submissions')
        .update({ ai_status: AI_STATUS.FAILED, ai_error: 'Previous evaluation timed out. Retrying.' })
        .eq('id', submissionId)
        .eq('ai_status', AI_STATUS.PROCESSING)
    } else {
      console.info('[AI] claim skipped: evaluation already processing', { submissionId })
      return { claimed: false, submission: current, inProgress: true }
    }
  }

  if (current.ai_status === AI_STATUS.PENDING && isStalePending(current)) {
    console.info('[AI] marking stale pending submission failed', { submissionId })
    await supabase
      .from('submissions')
      .update({
        ai_status: AI_STATUS.FAILED,
        ai_error: 'AI draft did not start in time. You can generate again.',
      })
      .eq('id', submissionId)
      .eq('ai_status', AI_STATUS.PENDING)
  }

  const allowedStatuses = [AI_STATUS.PENDING, AI_STATUS.FAILED]
  if (allowRegenerate) {
    allowedStatuses.push(AI_STATUS.READY)
  }

  const processingStartedAt = new Date().toISOString()
  const { data: claimedRows, error: claimError } = await supabase
    .from('submissions')
    .update({
      ai_status: AI_STATUS.PROCESSING,
      ai_error: null,
      ai_feedback_at: processingStartedAt,
    })
    .eq('id', submissionId)
    .in('ai_status', allowedStatuses)
    .select('*')

  if (claimError) {
    throw new Error(claimError.message)
  }

  if (claimedRows?.length) {
    console.info('[AI] claim accepted: ai_status -> processing', {
      submissionId,
      previousStatus: current.ai_status,
      processingStartedAt,
    })
    return { claimed: true, submission: claimedRows[0] }
  }

  const { data: retryRow } = await supabase.from('submissions').select('*').eq('id', submissionId).single()
  console.info('[AI] claim skipped: submission not eligible', {
    submissionId,
    currentStatus: retryRow?.ai_status,
  })
  return { claimed: false, submission: retryRow, inProgress: retryRow?.ai_status === AI_STATUS.PROCESSING }
}
