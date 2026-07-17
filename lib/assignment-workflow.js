export const ASSIGNMENT_WORKFLOW_STATUS = {
  SUBMITTED: 'submitted',
  PROCESSING: 'processing',
  AI_GENERATED: 'ai_generated',
  WAITING_AUTO_APPROVAL: 'waiting_auto_approval',
  TRAINER_EDITING: 'trainer_editing',
  PUBLISHED: 'published',
  FAILED: 'failed',
}

export const DEFAULT_WORKFLOW_STATUS = ASSIGNMENT_WORKFLOW_STATUS.SUBMITTED

export const ASSIGNMENT_WORKFLOW_STATUSES = Object.values(ASSIGNMENT_WORKFLOW_STATUS)

export function isValidWorkflowStatus(status) {
  return ASSIGNMENT_WORKFLOW_STATUSES.includes(String(status || '').trim())
}

export function normalizeWorkflowStatus(status, fallback = DEFAULT_WORKFLOW_STATUS) {
  const value = String(status || '').trim()
  return isValidWorkflowStatus(value) ? value : fallback
}
