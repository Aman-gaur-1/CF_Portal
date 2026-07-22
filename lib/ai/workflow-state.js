import { AI_STATUS } from './constants'
import { isReviewedSubmission } from '@/lib/review-state'

export const AI_WORKFLOW_STATE = {
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  DRAFT_READY: 'draft_ready',
  FAILED: 'failed',
  APPROVED: 'approved',
  PUBLISHED: 'published',
}

export const AI_FAILURE_REASON = {
  PROVIDER_TIMEOUT: 'Provider Timeout',
  RATE_LIMIT: 'Rate Limit',
  MODEL_ERROR: 'Model Error',
  EXTRACTION_FAILED: 'Extraction Failed',
  UNSUPPORTED_FILE: 'Unsupported File',
  PROMPT_ERROR: 'Prompt Error',
  VALIDATION_FAILED: 'Validation Failed',
  PARSER_ERROR: 'Parser Error',
  QUEUE_TIMEOUT: 'Queue Timeout',
  UNKNOWN: 'Unknown',
}

export function deriveAiWorkflowState(row = {}) {
  if (isReviewedSubmission(row)) return AI_WORKFLOW_STATE.PUBLISHED
  if (row.approval_at || row.approved_at) return AI_WORKFLOW_STATE.APPROVED
  if (row.ai_feedback || row.ai_status === AI_STATUS.READY) return AI_WORKFLOW_STATE.DRAFT_READY
  if (row.ai_status === AI_STATUS.PROCESSING) return AI_WORKFLOW_STATE.PROCESSING
  if (row.ai_status === AI_STATUS.FAILED) return AI_WORKFLOW_STATE.FAILED
  if (row.ai_status === AI_STATUS.PENDING && row.ai_feedback_at) return AI_WORKFLOW_STATE.QUEUED
  return AI_WORKFLOW_STATE.PENDING
}

export function classifyAiFailureReason(message, diagnostics = {}) {
  const text = String(message || '').toLowerCase()
  const provider = diagnostics?.ai_provider || diagnostics || {}
  const failure = String(provider.failure_reason || provider.final_failure_reason || '').toLowerCase()
  const combined = `${text} ${failure}`

  if (/unsupported/.test(combined)) return AI_FAILURE_REASON.UNSUPPORTED_FILE
  if (/parser|json|parse/.test(combined)) return AI_FAILURE_REASON.PARSER_ERROR
  if (/extract|ocr|read|download/.test(combined)) return AI_FAILURE_REASON.EXTRACTION_FAILED
  if (/validation|schema|invalid ai output|score|rubric/.test(combined)) return AI_FAILURE_REASON.VALIDATION_FAILED
  if (/prompt/.test(combined)) return AI_FAILURE_REASON.PROMPT_ERROR
  if (/rate limit|quota|429|resourceexhausted/.test(combined)) return AI_FAILURE_REASON.RATE_LIMIT
  if (/timeout|timed out|504|processing duration/.test(combined)) return AI_FAILURE_REASON.PROVIDER_TIMEOUT
  if (/model|provider|api|503|service/.test(combined)) return AI_FAILURE_REASON.MODEL_ERROR
  if (/queue|stuck|did not start/.test(combined)) return AI_FAILURE_REASON.QUEUE_TIMEOUT
  return AI_FAILURE_REASON.UNKNOWN
}

export function approvalMethodLabel(method) {
  const normalized = String(method || '').toLowerCase()
  if (normalized === 'auto' || normalized === 'ai') return 'AI'
  if (normalized === 'force') return 'Force'
  return 'Manual'
}
