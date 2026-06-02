export const REVIEW_ACTIVITY_TTL_MS = 5 * 60 * 1000

export function isReviewActivityFresh(submission, now = Date.now()) {
  if (!submission?.review_active_by || !submission?.review_active_at) return false
  const updatedAt = new Date(submission.review_active_at).getTime()
  return Number.isFinite(updatedAt) && now - updatedAt < REVIEW_ACTIVITY_TTL_MS
}

export function serializeReviewActivity(submission, currentTeacherName) {
  if (!isReviewActivityFresh(submission)) return null
  return {
    submissionId: submission.id,
    trainerName: submission.review_active_by,
    openedAt: submission.review_active_at,
    isCurrentTeacher: normalizeName(submission.review_active_by) === normalizeName(currentTeacherName),
  }
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase()
}
