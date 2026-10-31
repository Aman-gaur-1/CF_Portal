export const COURSEWORK_CATALOG_EPOCH = '2026-10-01'

export function normalizeCatalogTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}
export function normalizeProjectDetectionTitle(value) {
  return normalizeCatalogTitle(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hasProjectLikeTitle(value) {
  return /\bprojects?\b/.test(normalizeProjectDetectionTitle(value))
}

export function normalizeCatalogType(value) {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'assignment' || type === '100') return 'assignment'
  if (type === 'project' || type === '200') return 'project'
  return ''
}

export function getCatalogLocalDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function isCatalogEpochEligible(value, { epoch = COURSEWORK_CATALOG_EPOCH, asOfDate = '' } = {}) {
  const date = getCatalogLocalDate(value)
  return Boolean(date && date >= epoch && (!asOfDate || date <= asOfDate))
}

function compareDate(left, right) {
  return String(left || '').localeCompare(String(right || ''))
}

function candidateKey(batch, type, normalizedTitle) {
  return [batch, type || 'unknown', normalizedTitle || 'untitled']
    .map(value => encodeURIComponent(String(value || '')))
    .join('|')
}

export function parseCourseworkCandidateKey(value) {
  const parts = String(value || '').split('|')
  if (parts.length !== 3) return null
  try {
    const [batch, type, normalizedTitle] = parts.map(part => decodeURIComponent(part))
    if (!batch || !type || !normalizedTitle) return null
    return { batch, type, normalizedTitle }
  } catch {
    return null
  }
}

function catalogMatchesBatch(item, batch) {
  return !item?.batch || String(item.batch) === String(batch)
}

function titleVariantRows(rows) {
  const counts = new Map()
  for (const row of rows) {
    const raw = String(row.topic || '').trim()
    counts.set(raw, (counts.get(raw) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([title, count]) => ({ title, count }))
}

function confidenceForVariants(variants) {
  return variants.length <= 1 ? 'exact' : 'safe'
}

function emptyReason(row) {
  const type = normalizeCatalogType(row.submission_type)
  const title = normalizeCatalogTitle(row.topic)
  if (!type && !title) return 'missing title and unsupported type'
  if (!type) return 'unsupported or missing submission type'
  if (!title) return 'missing title/topic'
  return 'unmatched'
}

function summarizeRows(rows) {
  return rows.reduce((summary, row) => {
    summary.total += 1
    if (row.coursework_item_id) summary.linked += 1
    else summary.unlinked += 1
    return summary
  }, { total: 0, linked: 0, unlinked: 0 })
}

/**
 * Builds a preview from read-only submission/catalog facts. No database writes
 * happen here. The caller must pass current student rows so submissions from a
 * stale/mismatched batch cannot enter the Health Card setup flow. Completion
 * date is intentionally not a scoring eligibility gate.
 */
export function buildCourseworkCatalogPreview({
  submissions = [],
  students = [],
  courseworkItems = [],
  asOfDate = '',
} = {}) {
  const studentBatches = new Map((Array.isArray(students) ? students : [])
    .filter(student => student?.id && student?.batch)
    .map(student => [String(student.id), String(student.batch)]))

  const examinedRows = (Array.isArray(submissions) ? submissions : [])
    .filter(row => {
      const studentBatch = studentBatches.get(String(row?.student_id || ''))
    const submissionDate = getCatalogLocalDate(row?.submitted_at)
      return Boolean(
        studentBatch &&
        row?.batch &&
        String(row.batch) === studentBatch &&
        submissionDate &&
        (!asOfDate || submissionDate <= asOfDate),
      )
    })
    .sort((left, right) => compareDate(getCatalogLocalDate(left.submitted_at), getCatalogLocalDate(right.submitted_at)) || String(left.id).localeCompare(String(right.id)))

  const totals = summarizeRows(examinedRows)
  const groups = new Map()
  const unmatchedReasonCounts = new Map()
  const unmatchedByBatch = new Map()

  for (const row of examinedRows.filter(item => !item.coursework_item_id)) {
    const type = normalizeCatalogType(row.submission_type)
    const normalizedTitle = normalizeCatalogTitle(row.topic)
    if (!type || !normalizedTitle) {
      const reason = emptyReason(row)
      unmatchedReasonCounts.set(reason, (unmatchedReasonCounts.get(reason) || 0) + 1)
      const batch = String(row.batch || '')
      unmatchedByBatch.set(batch, (unmatchedByBatch.get(batch) || 0) + 1)
      continue
    }
    const key = `${row.batch}\u0000${normalizedTitle}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const candidates = [...groups.entries()].map(([groupKey, rows]) => {
    const batch = String(rows[0].batch)
    const normalizedTitle = normalizeCatalogTitle(rows[0].topic)
    const types = [...new Set(rows.map(row => normalizeCatalogType(row.submission_type)).filter(Boolean))]
    const rawVariants = titleVariantRows(rows)
    const type = types.length === 1 ? types[0] : ''
    const relevantCatalog = (Array.isArray(courseworkItems) ? courseworkItems : []).filter(item => (
      catalogMatchesBatch(item, batch) &&
      normalizeCatalogType(item.item_type) === type &&
      normalizeCatalogTitle(item.title) === normalizedTitle
    ))
    const activeCatalog = relevantCatalog.filter(item => item.active !== false)
    const inactiveCatalog = relevantCatalog.filter(item => item.active === false)
    const baseConfidence = types.length === 1 ? confidenceForVariants(rawVariants) : 'ambiguous'
    let confidence = baseConfidence
    let canLink = Boolean(type && normalizedTitle && types.length === 1)
    let catalogStatus = 'new'
    let reason = ''
    let existingCourseworkItemId = null

    if (types.length !== 1) {
      confidence = 'ambiguous'
      canLink = false
      catalogStatus = 'type_conflict'
      reason = 'The same normalized title has multiple coursework types.'
    } else if (activeCatalog.length > 1) {
      confidence = 'ambiguous'
      canLink = false
      catalogStatus = 'competing_active_items'
      reason = 'Multiple active coursework items share this batch/type/title.'
    } else if (activeCatalog.length === 1) {
      catalogStatus = 'existing'
      existingCourseworkItemId = activeCatalog[0].id
      reason = 'One unique active coursework item is available for linking.'
    } else if (inactiveCatalog.length > 0) {
      confidence = 'ambiguous'
      canLink = false
      catalogStatus = 'inactive_conflict'
      reason = 'An inactive coursework item already uses this batch/type/title.'
    } else {
      reason = 'No competing coursework item was found; catalog creation is safe after admin confirmation.'
    }

    return {
      key: candidateKey(batch, type, normalizedTitle),
      batch,
      proposedTitle: rawVariants[0]?.title || rows[0].topic,
      normalizedTitle,
      type: type || null,
      confidence,
      reason,
      catalogStatus,
      existingCourseworkItemId,
      firstSubmissionDate: rows.map(row => getCatalogLocalDate(row.submitted_at)).filter(Boolean).sort()[0] || null,
      distinctStudents: new Set(rows.map(row => String(row.student_id))).size,
      affectedSubmissions: rows.length,
      rawTitleVariants: rawVariants,
      submissionIds: rows.map(row => row.id).filter(Boolean),
      canLink,
    }
  }).sort((left, right) => (
    String(left.batch).localeCompare(String(right.batch)) ||
    String(left.type || '').localeCompare(String(right.type || '')) ||
    String(left.proposedTitle || '').localeCompare(String(right.proposedTitle || ''))
  ))

  const mergeSuggestions = buildCourseworkMergeSuggestions(candidates)
  const mergeSuggestionKeys = new Set(mergeSuggestions.flatMap(suggestion => suggestion.candidates.map(candidate => candidate.key)))
  const projectTextKeys = new Set(candidates
    .filter(candidate => candidate.type === 'assignment' && hasProjectLikeTitle(candidate.proposedTitle))
    .map(candidate => candidate.key))
  const candidatesWithFlags = candidates.map(candidate => ({
    ...candidate,
    suspiciousReasons: [
      ...(mergeSuggestionKeys.has(candidate.key) ? ['possible duplicate or merge candidate'] : []),
      ...(projectTextKeys.has(candidate.key) ? ['title contains “project” but type is assignment'] : []),
    ],
  }))
  const catalogById = new Map((Array.isArray(courseworkItems) ? courseworkItems : []).map(item => [String(item.id), item]))
  const configuredMap = new Map()
  for (const row of examinedRows.filter(item => item.coursework_item_id)) {
    const item = catalogById.get(String(row.coursework_item_id))
    if (!item) continue
    const key = `${item.id}|${row.batch}`
    if (!configuredMap.has(key)) configuredMap.set(key, {
      id: item.id,
      batch: String(row.batch),
      title: item.title,
      type: normalizeCatalogType(item.item_type) || item.item_type,
      dueAt: item.due_at || null,
      active: item.active !== false,
      linkedSubmissions: 0,
    })
    configuredMap.get(key).linkedSubmissions += 1
  }
  const eligibleCandidates = candidatesWithFlags.filter(candidate => candidate.canLink && candidate.confidence !== 'ambiguous')
  const batchMap = new Map()
  for (const row of examinedRows) {
    const batch = String(row.batch)
    if (!batchMap.has(batch)) batchMap.set(batch, {
      batch,
      candidateCount: 0,
      exactCandidates: 0,
      safeCandidates: 0,
      ambiguousCandidates: 0,
      suspiciousCandidates: 0,
      duplicateLookingCandidates: 0,
      oneOffCandidates: 0,
      assignmentsDetected: 0,
      projectsDetected: 0,
      unlinkedSubmissions: 0,
      unmatchedSubmissions: 0,
      mergeSuggestionCount: 0,
    })
    if (!row.coursework_item_id) batchMap.get(batch).unlinkedSubmissions += 1
  }
  for (const [batch, count] of unmatchedByBatch.entries()) {
    if (!batchMap.has(batch)) batchMap.set(batch, {
      batch,
      candidateCount: 0,
      exactCandidates: 0,
      safeCandidates: 0,
      ambiguousCandidates: 0,
      suspiciousCandidates: 0,
      duplicateLookingCandidates: 0,
      oneOffCandidates: 0,
      assignmentsDetected: 0,
      projectsDetected: 0,
      unlinkedSubmissions: 0,
      unmatchedSubmissions: 0,
      mergeSuggestionCount: 0,
    })
    batchMap.get(batch).unmatchedSubmissions = count
  }
  for (const candidate of candidatesWithFlags) {
    if (!batchMap.has(candidate.batch)) batchMap.set(candidate.batch, {
      batch: candidate.batch,
      candidateCount: 0,
      exactCandidates: 0,
      safeCandidates: 0,
      ambiguousCandidates: 0,
      suspiciousCandidates: 0,
      duplicateLookingCandidates: 0,
      oneOffCandidates: 0,
      assignmentsDetected: 0,
      projectsDetected: 0,
      unlinkedSubmissions: 0,
      unmatchedSubmissions: 0,
      mergeSuggestionCount: 0,
    })
    batchMap.get(candidate.batch).candidateCount += 1
    if (candidate.confidence === 'exact') batchMap.get(candidate.batch).exactCandidates += 1
    if (candidate.confidence === 'safe') batchMap.get(candidate.batch).safeCandidates += 1
    if (candidate.confidence === 'ambiguous') batchMap.get(candidate.batch).ambiguousCandidates += 1
    if (candidate.suspiciousReasons?.length) batchMap.get(candidate.batch).suspiciousCandidates += 1
    if (candidate.suspiciousReasons?.some(reason => reason.includes('duplicate'))) batchMap.get(candidate.batch).duplicateLookingCandidates += 1
    if (candidate.affectedSubmissions === 1) batchMap.get(candidate.batch).oneOffCandidates += 1
    if (candidate.type === 'assignment') batchMap.get(candidate.batch).assignmentsDetected += 1
    if (candidate.type === 'project') batchMap.get(candidate.batch).projectsDetected += 1
  }
  for (const suggestion of mergeSuggestions) {
    if (batchMap.has(suggestion.batch)) batchMap.get(suggestion.batch).mergeSuggestionCount += 1
  }

  const potentialLinks = eligibleCandidates.reduce((sum, candidate) => sum + candidate.affectedSubmissions, 0)
  const exactMatches = eligibleCandidates
    .filter(candidate => candidate.confidence === 'exact')
    .reduce((sum, candidate) => sum + candidate.affectedSubmissions, 0)
  const safeMatches = eligibleCandidates
    .filter(candidate => candidate.confidence === 'safe')
    .reduce((sum, candidate) => sum + candidate.affectedSubmissions, 0)
  const ambiguousMatches = candidates
    .filter(candidate => !candidate.canLink || candidate.confidence === 'ambiguous')
    .reduce((sum, candidate) => sum + candidate.affectedSubmissions, 0)

  return {
    scoringModel: 'unified_canonical_coursework',
    asOfDate: asOfDate || null,
    totals: {
      totalSubmissionsExamined: totals.total,
      linkedSubmissions: totals.linked,
      unlinkedSubmissions: totals.unlinked,
      exactMatches,
      safeMatches,
      ambiguousMatches,
      exactCandidates: candidatesWithFlags.filter(candidate => candidate.confidence === 'exact').length,
      safeCandidates: candidatesWithFlags.filter(candidate => candidate.confidence === 'safe').length,
      ambiguousCandidates: candidatesWithFlags.filter(candidate => candidate.confidence === 'ambiguous').length,
      suspiciousCandidates: candidatesWithFlags.filter(candidate => candidate.suspiciousReasons?.length).length,
      duplicateLookingCandidates: candidatesWithFlags.filter(candidate => candidate.suspiciousReasons?.some(reason => reason.includes('duplicate'))).length,
      oneOffCandidates: candidatesWithFlags.filter(candidate => candidate.affectedSubmissions === 1).length,
      unmatchedSubmissions: [...unmatchedReasonCounts.values()].reduce((sum, count) => sum + count, 0),
      courseworkItemsWouldBeCreated: eligibleCandidates.filter(candidate => candidate.catalogStatus === 'new').length,
      submissionsWouldBeLinked: potentialLinks,
    },
    unmatchedReasonCounts: [...unmatchedReasonCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => ({ reason, count })),
    batchSummaries: [...batchMap.values()].sort((left, right) => left.batch.localeCompare(right.batch)),
    configuredItems: [...configuredMap.values()].sort((left, right) => left.batch.localeCompare(right.batch) || String(left.title).localeCompare(String(right.title))),
    mergeSuggestions,
    candidates: candidatesWithFlags,
  }
}

function punctuationNormalizedTitle(value) {
  return normalizeCatalogTitle(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function numberingNormalizedTitle(value) {
  return punctuationNormalizedTitle(value)
    .replace(/^(?:assignment|project)\s*(?:no|number|#)?\s*\d+\b\s*/i, '')
    .replace(/^(?:\d+\s*[-:.)]\s*)+/i, '')
    .replace(/\b(?:assignment|project)\s*(?:no|number|#)?\s*\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(punctuationNormalizedTitle(left).split(' ').filter(Boolean))
  const rightTokens = new Set(punctuationNormalizedTitle(right).split(' ').filter(Boolean))
  if (!leftTokens.size || !rightTokens.size) return 0
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length
  return intersection / new Set([...leftTokens, ...rightTokens]).size
}

function editSimilarity(left, right) {
  const a = punctuationNormalizedTitle(left)
  const b = punctuationNormalizedTitle(right)
  if (a === b) return 1
  if (!a || !b) return 0
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0]
    previous[0] = row
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column]
      const cost = a[row - 1] === b[column - 1] ? 0 : 1
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + cost)
      diagonal = above
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length)
}

export function buildCourseworkMergeSuggestions(candidates = []) {
  const suggestions = []
  const rows = Array.isArray(candidates) ? candidates : []
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex]
      if (!left?.key || !right?.key || left.batch !== right.batch || left.type !== right.type) continue
      const leftPunctuation = punctuationNormalizedTitle(left.proposedTitle)
      const rightPunctuation = punctuationNormalizedTitle(right.proposedTitle)
      if (normalizeCatalogTitle(left.proposedTitle) === normalizeCatalogTitle(right.proposedTitle)) continue
      let reason = ''
      let confidence = 'review'
      if (leftPunctuation === rightPunctuation) reason = 'punctuation or spacing variant'
      else if (numberingNormalizedTitle(left.proposedTitle) && numberingNormalizedTitle(left.proposedTitle) === numberingNormalizedTitle(right.proposedTitle)) reason = 'numbering variant'
      else if (editSimilarity(left.proposedTitle, right.proposedTitle) >= 0.9 && tokenSimilarity(left.proposedTitle, right.proposedTitle) >= 0.6) reason = 'possible spelling variant'
      else if (tokenSimilarity(left.proposedTitle, right.proposedTitle) >= 0.8) reason = 'possible same assignment with title variation'
      if (!reason) continue
      suggestions.push({
        batch: left.batch,
        type: left.type,
        confidence,
        reason,
        candidates: [left, right].map(candidate => ({
          key: candidate.key,
          title: candidate.proposedTitle,
          affectedSubmissions: candidate.affectedSubmissions,
        })),
      })
    }
  }
  return suggestions
}

export function serializeCourseworkCandidate(candidate) {
  if (!candidate) return null
  const { submissionIds, ...safeCandidate } = candidate
  return safeCandidate
}
