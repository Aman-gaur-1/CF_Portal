/**
 * Canonical coursework scoring shared by the student feedback experience and
 * the Health Card-compatible submission facts.
 *
 * Historical submission rows are never rewritten. Raw legacy type values are
 * classification artifacts; canonical coursework identity and confirmed
 * reconciliation identity are the only award keys.
 */

import {
  HEALTH_CARD_POINTS,
  healthCardCourseworkPoints,
  normalizeHealthCourseworkType,
} from './health-card-domain.js'

export const COURSEWORK_POINTS = Object.freeze({
  assignment: HEALTH_CARD_POINTS.assignment,
  project: HEALTH_CARD_POINTS.project,
})

export const COURSEWORK_POINT_SCALE = 20

export const BADGE_LEVELS = Object.freeze([
  { threshold: 250, icon: '💎', name: 'Legend', bg: 'linear-gradient(135deg,#db2777,#f97316)', color: '#ffffff' },
  { threshold: 100, icon: '🏆', name: 'Master', bg: 'linear-gradient(135deg,#7c3aed,#38bdf8)', color: '#ffffff' },
  { threshold: 50, icon: '🔥', name: 'Dedicated', bg: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#ffffff' },
  { threshold: 25, icon: '⚡', name: 'Active Learner', bg: 'linear-gradient(135deg,#22c55e,#14b8a6)', color: '#ffffff' },
  { threshold: 5, icon: '🌱', name: 'Beginner', bg: 'linear-gradient(135deg,#818cf8,#a78bfa)', color: '#111827' },
  { threshold: 0, icon: '🆕', name: 'Newcomer', bg: 'linear-gradient(135deg,#38bdf8,#bfdbfe)', color: '#111827' },
])

export const MILESTONES = Object.freeze([5, 25, 50, 100, 250])

export function normalizeCourseworkType(value) {
  return normalizeHealthCourseworkType(value)
}

export function getCourseworkPoints(value) {
  return healthCardCourseworkPoints(value)
}

export function getBadge(points) {
  const numericPoints = Number(points) || 0
  return BADGE_LEVELS.find(badge => numericPoints >= badge.threshold) || BADGE_LEVELS[BADGE_LEVELS.length - 1]
}

export function getNextMilestone(points) {
  const numericPoints = Number(points) || 0
  return MILESTONES.find(milestone => numericPoints < milestone) || null
}

export function formatCourseworkPoints(points) {
  const numericPoints = Number(points) || 0
  return Number.isInteger(numericPoints) ? String(numericPoints) : numericPoints.toFixed(2).replace(/\.00$/, '')
}

function normalizedText(value) {
  return String(value || '').trim().toLowerCase()
}

function rowId(row, index) {
  return String(row?.id || index)
}

function rowStudentId(row) {
  return String(row?.student_id || row?.studentId || '')
}

function rowSubmittedAt(row) {
  const timestamp = Date.parse(row?.submitted_at || '')
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

function sortOldestFirst(left, right) {
  return rowSubmittedAt(left) - rowSubmittedAt(right) || rowId(left, 0).localeCompare(rowId(right, 0))
}

function catalogItemType(item) {
  return normalizeCourseworkType(item?.item_type || item?.itemType)
}

function catalogMatchesBatch(item, batch) {
  return !item?.batch || !batch || String(item.batch) === String(batch)
}

function canonicalCatalogItem(item, catalogById) {
  if (!item?.id) return null
  if (item.catalog_status && item.catalog_status !== 'canonical' && !item.canonical_coursework_item_id) return null
  if (item.canonical_coursework_item_id) {
    const canonical = catalogById.get(String(item.canonical_coursework_item_id))
    return canonical?.id ? canonical : null
  }
  return catalogItemType(item) ? item : null
}

function canonicalItemMatchesBatch(item, batch) {
  return item && (!item.batch || !batch || String(item.batch) === String(batch))
}

function candidateSort(left, right) {
  return (left.sourcePriority - right.sourcePriority)
    || (rowSubmittedAt(left) - rowSubmittedAt(right))
    || String(left.id || left.source_submission_id || '').localeCompare(String(right.id || right.source_submission_id || ''))
}

/**
 * Resolve recognized canonical completion facts. Unresolved legacy rows are
 * deliberately excluded and remain available to history/audit callers.
 */
export function selectCanonicalCourseworkAwards(submissions = [], courseworkItems = [], reconciliations = []) {
  const rows = (Array.isArray(submissions) ? submissions : [])
    .map((row, index) => ({ row, index, type: normalizeCourseworkType(row?.submission_type) }))
    .filter(({ row }) => row)

  const catalog = (Array.isArray(courseworkItems) ? courseworkItems : []).filter(item => item?.id)
  const catalogById = new Map(catalog.map(item => [String(item.id), item]))
  const canonicalItems = catalog
    .map(item => canonicalCatalogItem(item, catalogById))
    .filter(item => item?.id)
  const canonicalById = new Map(canonicalItems.map(item => [String(item.id), item]))
  const candidates = []

  for (const entry of rows) {
    const sourceItem = catalogById.get(String(entry.row?.coursework_item_id || ''))
    const item = canonicalCatalogItem(sourceItem, catalogById)
    if (!item || !canonicalItemMatchesBatch(item, entry.row?.batch)) continue
    candidates.push({
      ...entry.row,
      canonical_type: catalogItemType(item),
      canonical_item_id: item.id,
      canonical_key: `${rowStudentId(entry.row)}|item:${item.id}`,
      source: 'submission',
      sourcePriority: 0,
      _index: entry.index,
    })
  }

  for (const reconciliation of Array.isArray(reconciliations) ? reconciliations : []) {
    if (String(reconciliation?.status || '').toLowerCase() !== 'confirmed') continue
    if (reconciliation?.confidence && !['confirmed', 'high_confidence'].includes(String(reconciliation.confidence).toLowerCase())) continue
    const item = canonicalById.get(String(reconciliation?.coursework_item_id || ''))
    if (!item || !canonicalItemMatchesBatch(item, reconciliation?.batch)) continue
    if (normalizeCourseworkType(reconciliation?.item_type) !== catalogItemType(item)) continue
    candidates.push({
      ...reconciliation,
      id: reconciliation.source_submission_id || null,
      student_id: reconciliation.student_id,
      batch: reconciliation.batch,
      submitted_at: reconciliation.confirmed_at || reconciliation.updated_at || reconciliation.created_at || null,
      topic: reconciliation.source_topic || item.title,
      canonical_type: catalogItemType(item),
      canonical_item_id: item.id,
      canonical_key: `${String(reconciliation.student_id || '')}|item:${item.id}`,
      source: 'reconciliation',
      source_submission_id: reconciliation.source_submission_id || null,
      sourcePriority: 1,
    })
  }

  // A unique exact title match is confident canonical evidence. There is no
  // fallback award for an unresolved numeric/raw legacy type.
  const titleIndex = new Map()
  for (const item of canonicalItems) {
    const type = catalogItemType(item)
    const title = normalizedText(item.title)
    if (!type || !title) continue
    const key = `${type}|${title}`
    const existing = titleIndex.get(key) || []
    existing.push(item)
    titleIndex.set(key, existing)
  }
  for (const entry of rows) {
    if (entry.row?.coursework_item_id) continue
    const type = entry.type
    const title = normalizedText(entry.row?.topic)
    const matchingItems = titleIndex.get(`${type}|${title}`) || []
    if (matchingItems.length !== 1 || !canonicalItemMatchesBatch(matchingItems[0], entry.row?.batch)) continue
    const item = matchingItems[0]
    candidates.push({
      ...entry.row,
      canonical_type: type,
      canonical_item_id: item.id,
      canonical_key: `${rowStudentId(entry.row)}|item:${item.id}`,
      source: 'title_match',
      sourcePriority: 2,
      _index: entry.index,
    })
  }

  const byKey = new Map()
  for (const candidate of candidates.sort(candidateSort)) {
    if (!byKey.has(candidate.canonical_key)) byKey.set(candidate.canonical_key, candidate)
  }
  return [...byKey.values()].map(({ _index, sourcePriority, ...row }) => row)
}

export function selectCanonicalCourseworkSubmissions(submissions = [], courseworkItems = [], reconciliations = []) {
  return selectCanonicalCourseworkAwards(submissions, courseworkItems, reconciliations)
    .filter(row => row.source !== 'reconciliation')
}

export function calculateCourseworkSummary(submissions = [], courseworkItems = [], reconciliations = []) {
  const canonicalRows = selectCanonicalCourseworkAwards(submissions, courseworkItems, reconciliations)
  const assignmentCount = canonicalRows.filter(row => row.canonical_type === 'assignment').length
  const projectCount = canonicalRows.filter(row => row.canonical_type === 'project').length
  const assignmentPoints = assignmentCount * COURSEWORK_POINTS.assignment
  const projectPoints = projectCount * COURSEWORK_POINTS.project
  const awardBySubmissionId = new Map()
  for (const row of canonicalRows) {
    const id = row.source === 'reconciliation' ? row.source_submission_id : row.id
    if (id != null) awardBySubmissionId.set(String(id), getCourseworkPoints(row.canonical_type))
  }

  return {
    assignmentCount,
    projectCount,
    assignmentPoints,
    projectPoints,
    points: assignmentPoints + projectPoints,
    validSubmissionCount: canonicalRows.length,
    canonicalSubmissionIds: canonicalRows.map(row => row.id).filter(id => id != null),
    canonicalCourseworkItemIds: canonicalRows.map(row => row.canonical_item_id).filter(Boolean),
    awards: canonicalRows,
    awardBySubmissionId,
  }
}

// Compatibility export for older callers. The returned value now represents
// the single unified Coursework Points total, not a historical/lifetime tier.
export function calculateLifetimeCoursework(submissions = [], courseworkItems = [], reconciliations = []) {
  return calculateCourseworkSummary(submissions, courseworkItems, reconciliations)
}
