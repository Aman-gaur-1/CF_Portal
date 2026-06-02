export function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function matchesSubmissionSearch(submission, query) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true

  const haystack = normalizeSearchText([
    submission?.student_name,
    submission?.studentName,
    submission?.topic,
    submission?.batch,
    submission?.trainer_name,
    submission?.trainerName,
    submission?.status,
    submission?.status_label,
    submission?.review_status,
    submission?.ai_status,
  ].filter(Boolean).join(' '))

  return normalizedQuery.split(' ').every(term => haystack.includes(term))
}
