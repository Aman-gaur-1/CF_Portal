export const REVIEW_STATUS = {
  PENDING: 'pending',
  AI_GENERATING: 'ai_generating',
  AI_READY: 'ai_ready',
  REVIEWED: 'reviewed',
  PUBLISHED: 'published',
  FAILED: 'failed',
}

export function normalizeConfirmedIds(confirmedIds) {
  if (confirmedIds instanceof Set) return confirmedIds

  if (confirmedIds instanceof Map) {
    return new Set(Array.from(confirmedIds.keys()).map(id => String(id)))
  }

  if (Array.isArray(confirmedIds)) {
    return new Set(confirmedIds.map(id => String(id)))
  }

  if (confirmedIds && typeof confirmedIds === 'object') {
    const objectIds = [
      ...Object.keys(confirmedIds),
      ...Object.values(confirmedIds).filter(value => typeof value === 'string' || typeof value === 'number'),
    ]
    return new Set(objectIds.map(id => String(id)))
  }

  return new Set()
}

export function describeConfirmedIds(confirmedIds) {
  const safeConfirmedIds = normalizeConfirmedIds(confirmedIds)
  return {
    type: typeof confirmedIds,
    constructorName: confirmedIds?.constructor?.name || null,
    isArray: Array.isArray(confirmedIds),
    isSet: confirmedIds instanceof Set,
    isMap: confirmedIds instanceof Map,
    normalizedSize: safeConfirmedIds.size,
  }
}

export function isReviewedSubmission(row, confirmedIds = new Set()) {
  if (!row) return false
  const safeConfirmedIds = normalizeConfirmedIds(confirmedIds)
  const id = row.id == null ? '' : String(row.id)
  if (safeConfirmedIds.has(id)) return true
  if (String(row.feedback || '').trim()) return true
  if (row.feedback_at || row.reviewed_at) return true

  const status = String(row.status || row.review_status || '').toLowerCase()
  return ['reviewed', 'published', 'finalized', 'completed'].includes(status)
}

export function deriveReviewStatus(row, confirmedIds = new Set()) {
  const safeConfirmedIds = normalizeConfirmedIds(confirmedIds)
  if (isReviewedSubmission(row, safeConfirmedIds)) return REVIEW_STATUS.PUBLISHED

  const workflowState = String(row?.ai_workflow_state || '').toLowerCase()
  if (workflowState === 'published' || workflowState === 'approved') return REVIEW_STATUS.PUBLISHED
  if (workflowState === 'draft_ready') return REVIEW_STATUS.AI_READY
  if (workflowState === 'processing' || workflowState === 'queued') return REVIEW_STATUS.AI_GENERATING
  if (workflowState === 'failed') return REVIEW_STATUS.FAILED

  const aiStatus = String(row?.ai_status || '').toLowerCase()
  if (row?.ai_feedback || aiStatus === 'ready' || aiStatus === 'completed') return REVIEW_STATUS.AI_READY
  if (aiStatus === 'processing' || aiStatus === 'pending') return REVIEW_STATUS.AI_GENERATING
  if (aiStatus === 'failed') return REVIEW_STATUS.FAILED
  return REVIEW_STATUS.PENDING
}

export function decorateSubmissionReviewState(row, confirmedIds = new Set()) {
  if (!row) return row

  const safeConfirmedIds = normalizeConfirmedIds(confirmedIds)
  const reviewed = isReviewedSubmission(row, safeConfirmedIds)
  const reviewStatus = deriveReviewStatus(row, safeConfirmedIds)
  return {
    ...row,
    reviewed,
    reviewed_at: row.reviewed_at || row.feedback_at || null,
    review_status: reviewStatus,
    durable_status: reviewStatus,
  }
}

export function summarizeReviewRows(rows, confirmedIds = new Set()) {
  const safeConfirmedIds = normalizeConfirmedIds(confirmedIds)
  const summary = {
    total: rows.length,
    pending: 0,
    raw_pending: 0,
    ai_generating: 0,
    ai_ready: 0,
    reviewed: 0,
    published: 0,
    failed: 0,
  }

  for (const row of rows) {
    const status = deriveReviewStatus(row, safeConfirmedIds)
    if (status !== REVIEW_STATUS.PENDING) {
      summary[status] = (summary[status] || 0) + 1
    }
    if (isReviewedSubmission(row, safeConfirmedIds)) {
      summary.reviewed += 1
    } else {
      summary.pending += 1
      if (status === REVIEW_STATUS.PENDING) summary.raw_pending += 1
    }
  }

  return summary
}
