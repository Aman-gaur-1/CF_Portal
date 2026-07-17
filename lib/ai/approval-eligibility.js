import { AI_STATUS } from './constants'
import { isReviewedSubmission } from '@/lib/review-state'

export const BULK_APPROVAL_REASON = {
  AI_FAILED: 'AI evaluation failed',
  PROCESSING: 'Still processing',
  MISSING_FEEDBACK: 'Missing feedback',
  INVALID_AI_OUTPUT: 'Invalid AI output',
  REQUIRES_MANUAL_REVIEW: 'Requires manual review',
  ALREADY_PROCESSED: 'Already processed',
  UNEXPECTED_ERROR: 'Unexpected error',
  OTHER: 'Other',
}

export const BULK_APPROVAL_SELECT_COLUMNS = [
  'id',
  'feedback',
  'feedback_at',
  'reviewed_at',
  'workflow_status',
  'phase',
  'ai_status',
  'ai_feedback',
  'ai_evaluation',
].join(', ')

const MANUAL_REVIEW_FLAGS = new Set([
  'needs_manual_review',
  'unsupported_file',
  'low_confidence',
  'insufficient_evidence',
  'placeholder',
  'copied',
  'possible_placeholder_solution',
])

const FAILURE_TEXT_PATTERN = /\b(?:could not|cannot|can't|unable to|not able to|failed to|failure|error|timed out|timeout|api error|provider error|model error|empty submission|unsupported file|corrupt(?:ed)? file|unreadable|not clearly visible|unclear|no readable|no content|missing response|manual review|needs review|please resubmit|submit again|cannot be evaluated|could not be evaluated|could not be reviewed|cannot be reviewed|not actually evaluated)\b/i

export function createBulkApprovalSummary(scanned = 0) {
  return {
    scanned,
    published: 0,
    approved: 0,
    skipped: 0,
    failed: 0,
    reasons: {
      [BULK_APPROVAL_REASON.AI_FAILED]: 0,
      [BULK_APPROVAL_REASON.PROCESSING]: 0,
      [BULK_APPROVAL_REASON.MISSING_FEEDBACK]: 0,
      [BULK_APPROVAL_REASON.INVALID_AI_OUTPUT]: 0,
      [BULK_APPROVAL_REASON.REQUIRES_MANUAL_REVIEW]: 0,
      [BULK_APPROVAL_REASON.ALREADY_PROCESSED]: 0,
      [BULK_APPROVAL_REASON.UNEXPECTED_ERROR]: 0,
      [BULK_APPROVAL_REASON.OTHER]: 0,
    },
    eligible: 0,
    processed: 0,
    duration_ms: 0,
    failures: [],
  }
}

export function recordBulkApprovalSkip(summary, reason) {
  const key = Object.values(BULK_APPROVAL_REASON).includes(reason)
    ? reason
    : BULK_APPROVAL_REASON.OTHER
  summary.skipped += 1
  summary.reasons[key] = (summary.reasons[key] || 0) + 1
}

export function evaluateBulkAiApprovalEligibility(row) {
  if (!row) return ineligible(BULK_APPROVAL_REASON.OTHER, 'Submission row is missing')
  if (isReviewedSubmission(row)) return ineligible(BULK_APPROVAL_REASON.ALREADY_PROCESSED, 'Submission is already published')

  const workflowStatus = String(row.workflow_status || '').trim().toLowerCase()
  if (['reviewed', 'published', 'completed', 'finalized'].includes(workflowStatus)) {
    return ineligible(BULK_APPROVAL_REASON.ALREADY_PROCESSED, 'Workflow is already complete')
  }

  const status = String(row.ai_status || '').toLowerCase()
  if (status === AI_STATUS.FAILED) return ineligible(BULK_APPROVAL_REASON.AI_FAILED, 'AI status is failed')
  if (status === AI_STATUS.PROCESSING || status === AI_STATUS.PENDING) {
    return ineligible(BULK_APPROVAL_REASON.PROCESSING, 'AI evaluation is not complete')
  }
  if (status !== AI_STATUS.READY) {
    return ineligible(BULK_APPROVAL_REASON.AI_FAILED, 'AI status is not ready')
  }

  const feedback = String(row.ai_feedback || '').trim()
  if (!feedback) return ineligible(BULK_APPROVAL_REASON.MISSING_FEEDBACK, 'AI feedback is empty')
  if (!isUsableFeedbackText(feedback)) {
    return ineligible(BULK_APPROVAL_REASON.INVALID_AI_OUTPUT, 'AI feedback looks like placeholder or error text')
  }

  const evaluation = row.ai_evaluation
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    return ineligible(BULK_APPROVAL_REASON.INVALID_AI_OUTPUT, 'Structured AI evaluation is missing')
  }

  if (!hasValidScoring(evaluation)) {
    return ineligible(BULK_APPROVAL_REASON.INVALID_AI_OUTPUT, 'Structured AI score or rubric is invalid')
  }

  const flags = normalizedFlags(evaluation.flags)
  if (flags.some(flag => MANUAL_REVIEW_FLAGS.has(flag))) {
    return ineligible(BULK_APPROVAL_REASON.REQUIRES_MANUAL_REVIEW, 'AI flags require manual review')
  }

  if (!hasEvaluationEvidence(evaluation)) {
    return ineligible(BULK_APPROVAL_REASON.INVALID_AI_OUTPUT, 'AI evaluation has no evidence')
  }

  if (!hasAcceptableConfidence(evaluation)) {
    return ineligible(BULK_APPROVAL_REASON.REQUIRES_MANUAL_REVIEW, 'AI confidence is too low for bulk approval')
  }

  const diagnosticsResult = validateDiagnostics(evaluation.diagnostics)
  if (!diagnosticsResult.ok) return diagnosticsResult

  return { eligible: true, feedback }
}

export function buildBulkApprovalPreview(rows = []) {
  const summary = createBulkApprovalSummary(rows.length)
  const eligibleIds = []

  for (const row of rows) {
    const eligibility = evaluateBulkAiApprovalEligibility(row)
    if (eligibility.eligible) {
      summary.eligible += 1
      eligibleIds.push(String(row.id))
    } else {
      recordBulkApprovalSkip(summary, eligibility.reason)
    }
  }

  return { ...summary, eligibleIds }
}

export function recordBulkApprovalFailure(summary, submissionId, err) {
  summary.failed += 1
  recordBulkApprovalSkip(summary, BULK_APPROVAL_REASON.UNEXPECTED_ERROR)
  summary.failures.push({
    submissionId,
    message: String(err?.message || err || 'Unexpected error').slice(0, 300),
    at: new Date().toISOString(),
  })
}

export function recordBulkApprovalPublished(summary) {
  summary.published += 1
  summary.approved += 1
  summary.processed += 1
}

export function mapPublishSkipReason(reason) {
  const text = String(reason || '').toLowerCase()
  if (/already|published|reviewed/.test(text)) return BULK_APPROVAL_REASON.ALREADY_PROCESSED
  if (/ai_failed|failed/.test(text)) return BULK_APPROVAL_REASON.AI_FAILED
  if (/ai_not_ready|processing|pending|not_ready/.test(text)) return BULK_APPROVAL_REASON.PROCESSING
  if (/empty|missing|required/.test(text)) return BULK_APPROVAL_REASON.MISSING_FEEDBACK
  return BULK_APPROVAL_REASON.OTHER
}

function ineligible(reason, detail) {
  return { eligible: false, reason, detail }
}

function hasValidScoring(evaluation) {
  const score = Number(evaluation.score)
  const maxScore = Number(evaluation.max_score || 10)
  const rubric = evaluation.rubric && typeof evaluation.rubric === 'object' ? evaluation.rubric : null
  if (!Number.isFinite(score) || score < 0) return false
  if (!Number.isFinite(maxScore) || maxScore <= 0) return false
  if (!rubric) return false
  return ['correctness', 'style', 'concepts'].every(key => Number.isFinite(Number(rubric[key])))
}

function hasAcceptableConfidence(evaluation) {
  const confidence = Number(evaluation.confidence)
  return Number.isFinite(confidence) && confidence >= 0.45
}

function hasEvaluationEvidence(evaluation) {
  const evidence = Array.isArray(evaluation.evidence)
    ? evaluation.evidence.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const strengths = Array.isArray(evaluation.strengths)
    ? evaluation.strengths.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const improvements = Array.isArray(evaluation.improvements)
    ? evaluation.improvements.map(item => String(item || '').trim()).filter(Boolean)
    : []

  return evidence.length > 0 && (strengths.length > 0 || improvements.length > 0)
}

function validateDiagnostics(diagnostics = {}) {
  const parser = diagnostics?.parser || {}
  if (parser.supported === false) {
    return ineligible(BULK_APPROVAL_REASON.REQUIRES_MANUAL_REVIEW, 'Parser marked the submission unsupported')
  }
  if (parser.low_quality === true) {
    return ineligible(BULK_APPROVAL_REASON.REQUIRES_MANUAL_REVIEW, 'Parser marked extraction as low quality')
  }
  if (parser.fallback_reason && !hasReadableExtraction(parser)) {
    return ineligible(BULK_APPROVAL_REASON.REQUIRES_MANUAL_REVIEW, 'Parser used fallback extraction without strong readable output')
  }

  const provider = diagnostics?.ai_provider || {}
  if (provider.failure_reason || provider.final_failure_reason || provider.final_provider_attempted) {
    return ineligible(BULK_APPROVAL_REASON.AI_FAILED, 'Provider diagnostics contain a failure')
  }
  if (!provider.final_provider_used && !provider.provider) {
    return ineligible(BULK_APPROVAL_REASON.INVALID_AI_OUTPUT, 'Provider success diagnostics are missing')
  }

  return { ok: true }
}

function hasReadableExtraction(parser = {}) {
  const quality = String(parser.extraction_quality || '').toLowerCase()
  if (quality === 'usable' || quality === 'strong') return true
  if (Number(parser.extracted_code_characters || 0) >= 24) return true
  if (Number(parser.assignment_answer_characters || 0) >= 80) return true
  return Number(parser.characters || parser.extracted_characters || 0) >= 80
}

function normalizedFlags(flags) {
  return Array.isArray(flags)
    ? flags.map(flag => String(flag || '').trim().toLowerCase()).filter(Boolean)
    : []
}

function isUsableFeedbackText(feedback) {
  const text = String(feedback || '').trim()
  if (text.length < 40) return false
  if (FAILURE_TEXT_PATTERN.test(text)) return false

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 8) return false

  return true
}
