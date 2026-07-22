import {
  BULK_APPROVAL_REASON,
  BULK_APPROVAL_SELECT_COLUMNS,
  buildBulkApprovalPreview,
  createBulkApprovalSummary,
  evaluateBulkAiApprovalEligibility,
  mapPublishSkipReason,
  recordBulkApprovalFailure,
  recordBulkApprovalPublished,
  recordBulkApprovalSkip,
} from '@/lib/ai/approval-eligibility'
import { APPROVAL_METHOD, publishSubmissionFeedback } from '@/lib/submission-publisher'

export async function fetchBulkApprovalCandidates({ supabase, batchNames = null, phase = '', ids = null, limit = 500 } = {}) {
  if (ids && ids.length === 0) return []

  let query = supabase
    .from('submissions')
    .select(BULK_APPROVAL_SELECT_COLUMNS)
    .is('feedback', null)

  if (Array.isArray(batchNames)) query = query.in('batch', batchNames)
  if (String(phase || '').trim()) query = query.eq('phase', String(phase).trim())
  if (Array.isArray(ids)) query = query.in('id', ids)
  if (!ids) query = query.order('submitted_at', { ascending: true }).limit(limit)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

export function previewBulkAiApproval(rows = []) {
  return stripInternalPreviewFields(buildBulkApprovalPreview(rows))
}

export async function executeBulkAiApproval({
  supabase,
  rows = [],
  actorName,
  actorRole,
  batchNames = null,
  phase = '',
  force = false,
  audit = {},
} = {}) {
  const startedAt = Date.now()
  const preview = force ? { eligible: rows.length, eligibleIds: rows.map(row => String(row.id)), reasons: {} } : buildBulkApprovalPreview(rows)
  const eligibleIds = preview.eligibleIds || []
  const summary = createBulkApprovalSummary(rows.length)
  summary.eligible = preview.eligible

  for (const [reason, count] of Object.entries(preview.reasons || {})) {
    summary.reasons[reason] = count
    summary.skipped += Number(count) || 0
  }

  const latestRows = await fetchBulkApprovalCandidates({ supabase, batchNames, phase, ids: eligibleIds })
  const latestById = new Map(latestRows.map(row => [String(row.id), row]))

  for (const submissionId of eligibleIds) {
    const latest = latestById.get(String(submissionId))
    if (!latest) {
      recordBulkApprovalSkip(summary, BULK_APPROVAL_REASON.ALREADY_PROCESSED)
      continue
    }

    const eligibility = force
      ? { eligible: true, feedback: String(latest.ai_feedback || latest.feedback || '').trim() }
      : evaluateBulkAiApprovalEligibility(latest)
    if (!eligibility.eligible) {
      recordBulkApprovalSkip(summary, eligibility.reason)
      continue
    }
    if (!eligibility.feedback) {
      recordBulkApprovalSkip(summary, BULK_APPROVAL_REASON.MISSING_FEEDBACK)
      continue
    }

    try {
      const result = await publishSubmissionFeedback({
        submissionId: latest.id,
        feedback: eligibility.feedback,
        actorName,
        actorRole,
        approvalMethod: force ? APPROVAL_METHOD.FORCE : APPROVAL_METHOD.MANUAL,
        requireAiReady: !force,
        supabase,
      })

      if (result.published) {
        recordBulkApprovalPublished(summary)
      } else {
        recordBulkApprovalSkip(summary, mapPublishSkipReason(result.reason))
      }
    } catch (err) {
      recordBulkApprovalFailure(summary, submissionId, err)
      console.error('[bulk-ai-approval] item failed', {
        submissionId,
        role: actorRole,
        userId: audit.userId || audit.userName || actorName || null,
        error: err?.message,
      })
    }
  }

  summary.duration_ms = Date.now() - startedAt
  console.info('[bulk-ai-approval] completed', {
    userId: audit.userId || audit.userName || actorName || null,
    role: actorRole,
    timestamp: new Date().toISOString(),
    scanned: summary.scanned,
    eligible: summary.eligible,
    approved: summary.approved,
    skipped: summary.skipped,
    failed: summary.failed,
    duration_ms: summary.duration_ms,
    failures: summary.failures,
  })

  return summary
}

function stripInternalPreviewFields(preview) {
  const { eligibleIds, ...safePreview } = preview
  return safePreview
}
