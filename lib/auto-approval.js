import { AI_STATUS } from '@/lib/ai/constants'
import { getBoolean, getNumber, setSetting } from '@/lib/system-settings'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { APPROVAL_METHOD, publishSubmissionFeedback } from '@/lib/submission-publisher'

export const AUTO_APPROVAL_SETTINGS = {
  ENABLED: 'AUTO_APPROVAL_ENABLED',
  DELAY: 'AUTO_APPROVAL_DELAY',
}

export const AUTO_APPROVAL_LIMITS = {
  MIN_DELAY_MINUTES: 5,
  MAX_DELAY_MINUTES: 10080,
  DEFAULT_DELAY_MINUTES: 30,
  DEFAULT_BATCH_SIZE: 100,
  MAX_BATCH_SIZE: 500,
}

const AUTO_APPROVAL_LOCK_NAME = 'auto_approval_cron'
const AUTO_APPROVAL_LOCK_LEASE_SECONDS = 240

export function normalizeDelayMinutes(value, fallback = AUTO_APPROVAL_LIMITS.DEFAULT_DELAY_MINUTES) {
  const minutes = Number.parseInt(value, 10)
  if (!Number.isFinite(minutes)) return fallback
  return minutes
}

export function validateDelayMinutes(value) {
  const minutes = normalizeDelayMinutes(value)
  if (
    minutes < AUTO_APPROVAL_LIMITS.MIN_DELAY_MINUTES ||
    minutes > AUTO_APPROVAL_LIMITS.MAX_DELAY_MINUTES
  ) {
    throw new Error(`Auto approval delay must be between ${AUTO_APPROVAL_LIMITS.MIN_DELAY_MINUTES} and ${AUTO_APPROVAL_LIMITS.MAX_DELAY_MINUTES} minutes.`)
  }
  return minutes
}

function readDelayMinutes(value) {
  const minutes = normalizeDelayMinutes(value)
  if (
    minutes < AUTO_APPROVAL_LIMITS.MIN_DELAY_MINUTES ||
    minutes > AUTO_APPROVAL_LIMITS.MAX_DELAY_MINUTES
  ) {
    return AUTO_APPROVAL_LIMITS.DEFAULT_DELAY_MINUTES
  }
  return minutes
}

export function normalizeBatchSize(value) {
  const size = Number.parseInt(value, 10)
  if (!Number.isFinite(size) || size <= 0) return AUTO_APPROVAL_LIMITS.DEFAULT_BATCH_SIZE
  return Math.min(size, AUTO_APPROVAL_LIMITS.MAX_BATCH_SIZE)
}

export async function getAutoApprovalConfig({ supabase = getSupabaseAdmin() } = {}) {
  const enabled = await getBoolean(AUTO_APPROVAL_SETTINGS.ENABLED, false, { supabase })
  const configuredDelay = await getNumber(AUTO_APPROVAL_SETTINGS.DELAY, AUTO_APPROVAL_LIMITS.DEFAULT_DELAY_MINUTES, { supabase })
  const delayMinutes = readDelayMinutes(configuredDelay)
  return { enabled, delayMinutes }
}

export async function setAutoApprovalConfig({ enabled, delayMinutes, supabase = getSupabaseAdmin() } = {}) {
  const safeDelay = validateDelayMinutes(delayMinutes)
  await Promise.all([
    setSetting(AUTO_APPROVAL_SETTINGS.ENABLED, Boolean(enabled), 'Auto approval toggle for AI feedback.', { supabase }),
    setSetting(AUTO_APPROVAL_SETTINGS.DELAY, safeDelay, 'Auto approval delay in minutes.', { supabase }),
  ])
  if (!enabled) {
    const { error } = await supabase
      .from('submissions')
      .update({ auto_approval_due_at: null })
      .is('feedback', null)
    if (error) throw new Error(error.message)
  }
  return { enabled: Boolean(enabled), delayMinutes: safeDelay }
}

export async function scheduleAutoApprovalIfEligible(submissionId, { supabase = getSupabaseAdmin(), now = new Date() } = {}) {
  const id = String(submissionId || '').trim()
  if (!id) return { scheduled: false, reason: 'missing_submission_id' }

  const config = await getAutoApprovalConfig({ supabase })
  if (!config.enabled) {
    await clearAutoApprovalSchedule(id, { supabase }).catch(() => {})
    return { scheduled: false, reason: 'disabled' }
  }

  const { data: submission, error } = await supabase
    .from('submissions')
    .select('id, feedback, feedback_at, ai_status, ai_feedback, ai_evaluation')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!submission) return { scheduled: false, reason: 'not_found' }
  if (submission.feedback_at || String(submission.feedback || '').trim()) return { scheduled: false, reason: 'already_published' }
  if (submission.ai_status !== AI_STATUS.READY) return { scheduled: false, reason: 'ai_not_ready' }
  if (!String(submission.ai_feedback || '').trim()) return { scheduled: false, reason: 'empty_ai_feedback' }
  const score = Number(submission.ai_evaluation?.score)
  if (!Number.isFinite(score)) {
    await blockAutoApproval(id, 'missing_ai_score', { supabase })
    return { scheduled: false, reason: 'missing_ai_score' }
  }
  if (score < 5) {
    await blockAutoApproval(id, 'score_below_5_manual_review_required', { supabase })
    return { scheduled: false, reason: 'score_below_5_manual_review_required' }
  }

  const dueAt = new Date(now.getTime() + config.delayMinutes * 60 * 1000).toISOString()
  const { error: updateError } = await supabase
    .from('submissions')
    .update({ auto_approval_due_at: dueAt, ai_auto_approval_blocked_reason: null })
    .eq('id', id)
    .is('feedback', null)
    .eq('ai_status', AI_STATUS.READY)
  if (updateError) throw new Error(updateError.message)

  return { scheduled: true, dueAt, delayMinutes: config.delayMinutes }
}

async function blockAutoApproval(submissionId, reason, { supabase }) {
  const { error } = await supabase
    .from('submissions')
    .update({ auto_approval_due_at: null, ai_auto_approval_blocked_reason: reason })
    .eq('id', submissionId)
  if (error) throw new Error(error.message)
}

export async function clearAutoApprovalSchedule(submissionId, { supabase = getSupabaseAdmin() } = {}) {
  const id = String(submissionId || '').trim()
  if (!id) return
  const { error } = await supabase
    .from('submissions')
    .update({ auto_approval_due_at: null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function tryAcquireAutoApprovalLock({ owner, supabase = getSupabaseAdmin() } = {}) {
  const lockOwner = String(owner || '').trim()
  if (!lockOwner) throw new Error('Lock owner is required')
  const { data, error } = await supabase.rpc('cf_acquire_cron_lock', {
    p_lock_name: AUTO_APPROVAL_LOCK_NAME,
    p_lock_owner: lockOwner,
    p_lease_seconds: AUTO_APPROVAL_LOCK_LEASE_SECONDS,
  })
  if (error) throw new Error(error.message)
  return data === true
}

export async function releaseAutoApprovalLock({ owner, supabase = getSupabaseAdmin() } = {}) {
  const lockOwner = String(owner || '').trim()
  if (!lockOwner) return
  const { error } = await supabase.rpc('cf_release_cron_lock', {
    p_lock_name: AUTO_APPROVAL_LOCK_NAME,
    p_lock_owner: lockOwner,
  })
  if (error) throw new Error(error.message)
}

export async function publishDueAutoApprovals({ limit, supabase = getSupabaseAdmin() } = {}) {
  const config = await getAutoApprovalConfig({ supabase })
  const batchSize = normalizeBatchSize(limit || process.env.AUTO_APPROVAL_CRON_BATCH_SIZE)
  const result = { scanned: 0, published: 0, skipped: 0, failed: 0 }

  if (!config.enabled) return result

  const { data: rows, error } = await supabase
    .from('submissions')
    .select('id, ai_feedback, ai_evaluation')
    .lte('auto_approval_due_at', new Date().toISOString())
    .eq('ai_status', AI_STATUS.READY)
    .is('feedback', null)
    .not('ai_feedback', 'is', null)
    .order('auto_approval_due_at', { ascending: true })
    .limit(batchSize)
  if (error) throw new Error(error.message)

  result.scanned = rows?.length || 0
  for (const row of rows || []) {
    const feedback = String(row.ai_feedback || '').trim()
    if (!feedback) {
      result.skipped += 1
      await blockAutoApproval(row.id, 'empty_ai_feedback', { supabase }).catch(() => {})
      continue
    }
    const score = Number(row.ai_evaluation?.score)
    if (!Number.isFinite(score) || score < 5) {
      result.skipped += 1
      await blockAutoApproval(row.id, Number.isFinite(score) ? 'score_below_5_manual_review_required' : 'missing_ai_score', { supabase }).catch(() => {})
      continue
    }

    try {
      const published = await publishSubmissionFeedback({
        submissionId: row.id,
        feedback,
        actorName: 'Auto Approval',
        actorRole: 'system',
        approvalMethod: APPROVAL_METHOD.AI,
        requireAiReady: true,
        requireDue: true,
        supabase,
      })
      if (published.published) result.published += 1
      else result.skipped += 1
    } catch (err) {
      result.failed += 1
      console.error('[auto-approval] publish failed', { submissionId: row.id, error: err?.message })
    }
  }

  return result
}
