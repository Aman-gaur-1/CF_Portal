import { appendActivity } from '@/lib/activity-log'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { decorateSubmissionReviewState } from '@/lib/review-state'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const APPROVAL_METHOD = {
  MANUAL: 'manual',
  AUTO: 'auto',
}

export function normalizeApprovalMethod(value) {
  const method = String(value || '').trim().toLowerCase()
  return Object.values(APPROVAL_METHOD).includes(method) ? method : APPROVAL_METHOD.MANUAL
}

export async function publishSubmissionFeedback({
  submissionId,
  feedback,
  actorName,
  actorRole = 'teacher',
  approvalMethod = APPROVAL_METHOD.MANUAL,
  submissionType = null,
  phase = null,
  requireAiReady = false,
  requireDue = false,
  allowUpdatePublished = false,
  appendActivityLog = true,
  supabase = getSupabaseAdmin(),
} = {}) {
  const id = String(submissionId || '').trim()
  const text = String(feedback || '').trim()
  const publisher = String(actorName || '').trim() || (approvalMethod === APPROVAL_METHOD.AUTO ? 'Auto Approval' : 'System')
  const method = normalizeApprovalMethod(approvalMethod)

  if (!id || !text) {
    return { published: false, skipped: true, reason: 'missing_required_fields', submission: null }
  }

  const numericId = Number(id)
  if (!Number.isSafeInteger(numericId)) {
    return { published: false, skipped: true, reason: 'invalid_submission_id', submission: null }
  }

  const publishedAt = new Date().toISOString()
  const { data, error } = await supabase.rpc('cf_publish_submission_feedback', {
    p_submission_id: numericId,
    p_feedback: text,
    p_feedback_by: publisher,
    p_approval_method: method,
    p_feedback_at: publishedAt,
    p_submission_type: submissionType ? String(submissionType) : null,
    p_phase: phase ? String(phase) : null,
    p_require_ai_ready: Boolean(requireAiReady),
    p_require_due: Boolean(requireDue),
    p_allow_update_published: Boolean(allowUpdatePublished),
  })

  if (error) throw new Error(error.message)

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    const current = await loadSubmissionSnapshot(supabase, id)
    return {
      published: false,
      skipped: true,
      reason: skipReason(current, { requireAiReady, requireDue }),
      submission: current ? decorateSubmissionReviewState(current) : null,
    }
  }

  if (appendActivityLog) {
    await appendPublishActivity({ supabase, submission: row, actorName: publisher, actorRole, method })
  }
  await createFeedbackPublishedNotification({ supabase, submission: row })

  return {
    published: true,
    skipped: false,
    reason: null,
    submission: decorateSubmissionReviewState(row),
  }
}

async function createFeedbackPublishedNotification({ supabase, submission }) {
  if (!submission?.student_id) return
  await createNotification({
    userType: NOTIFICATION_USER_TYPE.STUDENT,
    userIdentifier: submission.student_id,
    notificationType: NOTIFICATION_TYPE.FEEDBACK_PUBLISHED,
    title: 'Feedback published',
    message: `Feedback is available for ${submission.topic || 'your assignment'}.`,
    referenceType: 'submission',
    referenceId: submission.id,
    icon: 'F',
    severity: 'success',
    actionLabel: 'View Feedback',
    actionUrl: '/?tab=feedback',
    supabase,
  })
}

async function loadSubmissionSnapshot(supabase, id) {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

function skipReason(row, { requireAiReady, requireDue }) {
  if (!row) return 'not_found'
  if (row.feedback_at || String(row.feedback || '').trim()) return 'already_published'
  if (row.ai_status === 'failed') return 'ai_failed'
  if (requireAiReady && row.ai_status !== 'ready') return 'ai_not_ready'
  if (requireAiReady && !String(row.ai_feedback || '').trim()) return 'empty_ai_feedback'
  if (requireDue && !row.auto_approval_due_at) return 'not_scheduled'
  if (requireDue && new Date(row.auto_approval_due_at).getTime() > Date.now()) return 'not_due'
  return 'not_eligible'
}

async function appendPublishActivity({ supabase, submission, actorName, actorRole, method }) {
  const topic = submission.topic || 'assignment'
  const approvedAiDraft = Boolean(submission.ai_feedback)
  const eventType = method === APPROVAL_METHOD.AUTO
    ? 'review_auto_approved'
    : approvedAiDraft ? 'review_approved' : 'manual_feedback_submitted'
  const description = method === APPROVAL_METHOD.AUTO
    ? `auto approved ${topic}`
    : approvedAiDraft ? `approved ${topic}` : `submitted manual feedback for ${topic}`

  try {
    await appendActivity({
      eventType,
      description,
      actorName,
      actorRole,
      supabase,
    })
  } catch (err) {
    console.warn('[submission-publisher] activity log append failed', {
      submissionId: submission.id,
      method,
      error: err?.message,
    })
  }
}
