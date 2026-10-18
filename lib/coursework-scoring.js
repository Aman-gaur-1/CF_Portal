/**
 * Canonical coursework scoring shared by the student feedback experience and
 * the Health Card-compatible submission facts.
 *
 * Historical submission rows are never rewritten. Legacy type values are
 * normalized at read time and award the current display value once per
 * canonical coursework item (or, for legacy rows without an item id, once per
 * unique type/topic fact).
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

function awardKey(row, type, key) {
  return `${rowStudentId(row)}|${type}|${key}`
}

/**
 * Selects the same canonical completion facts used by the Health Card:
 * linked coursework items win first; unlinked rows use a unique active title
 * when possible, otherwise one row per student/type/topic is retained.
 */
export function selectCanonicalCourseworkSubmissions(submissions = [], courseworkItems = []) {
  const rows = (Array.isArray(submissions) ? submissions : [])
    .map((row, index) => ({ row, index, type: normalizeCourseworkType(row?.submission_type) }))
    .filter(({ row, type }) => type && row?.submitted_at)
    .sort((left, right) => rowSubmittedAt(left.row) - rowSubmittedAt(right.row) || rowId(left.row, left.index).localeCompare(rowId(right.row, right.index)))

  const catalog = (Array.isArray(courseworkItems) ? courseworkItems : [])
    .filter(item => item && item.id)
  const catalogById = new Map(catalog.map(item => [String(item.id), item]))
  const scopedCatalog = catalog.filter(item => item?.batch == null || item.batch === '' || rows.some(({ row }) => catalogMatchesBatch(item, row?.batch)))
  const activeCatalog = scopedCatalog.filter(item => item?.active !== false)

  const activeTitleCounts = new Map()
  for (const item of activeCatalog) {
    const type = catalogItemType(item)
    const title = normalizedText(item?.title)
    if (!type || !title) continue
    const key = `${type}|${title}`
    activeTitleCounts.set(key, (activeTitleCounts.get(key) || 0) + 1)
  }

  const linked = []
  const linkedKeys = new Set()
  for (const entry of rows) {
    const item = catalogById.get(String(entry.row?.coursework_item_id || ''))
    if (!item || !catalogMatchesBatch(item, entry.row?.batch)) continue
    const type = catalogItemType(item)
    if (!type || type !== entry.type) continue
    const key = awardKey(entry.row, type, `item:${item.id}`)
    if (!linkedKeys.has(key)) {
      linkedKeys.add(key)
      linked.push({ ...entry.row, canonical_type: type, canonical_key: key, _index: entry.index })
    }
  }

  const titleCandidates = []
  const titleCandidateIds = new Set()
  for (const entry of rows) {
    if (entry.row?.coursework_item_id) continue
    const title = normalizedText(entry.row?.topic)
    if (!title) continue
    const matchingItems = activeCatalog.filter(item => (
      catalogItemType(item) === entry.type && normalizedText(item?.title) === title
    ))
    if (matchingItems.length !== 1) continue
    const item = matchingItems[0]
    const titleKey = `${entry.type}|${title}`
    if (activeTitleCounts.get(titleKey) !== 1) continue
    const key = awardKey(entry.row, entry.type, `item:${item.id}`)
    if (linkedKeys.has(key)) continue
    titleCandidateIds.add(entry.index)
    titleCandidates.push({ ...entry.row, canonical_type: entry.type, canonical_key: key, _index: entry.index })
  }

  const claimedTopicKeys = new Set(
    [...linked, ...titleCandidates].map(row => awardKey(row, row.canonical_type, `topic:${normalizedText(row.topic)}`)),
  )
  const fallback = []
  const fallbackKeys = new Set()
  for (const entry of rows) {
    if (entry.row?.coursework_item_id || titleCandidateIds.has(entry.index)) continue
    const topic = normalizedText(entry.row?.topic)
    const key = awardKey(entry.row, entry.type, `topic:${topic}`)
    if (fallbackKeys.has(key) || claimedTopicKeys.has(key)) continue
    fallbackKeys.add(key)
    fallback.push({ ...entry.row, canonical_type: entry.type, canonical_key: key, _index: entry.index })
  }

  const allCandidates = [...linked, ...titleCandidates, ...fallback]
  const seen = new Set()
  return allCandidates
    .sort((left, right) => rowSubmittedAt(left) - rowSubmittedAt(right) || String(left.id || left._index).localeCompare(String(right.id || right._index)))
    .filter(row => {
      if (seen.has(row.canonical_key)) return false
      seen.add(row.canonical_key)
      return true
    })
    .map(({ _index, canonical_key, canonical_type, ...row }) => ({
      ...row,
      canonical_type,
      canonical_key,
    }))
}

export function calculateLifetimeCoursework(submissions = [], courseworkItems = []) {
  const canonicalRows = selectCanonicalCourseworkSubmissions(submissions, courseworkItems)
  const assignmentCount = canonicalRows.filter(row => row.canonical_type === 'assignment').length
  const projectCount = canonicalRows.filter(row => row.canonical_type === 'project').length
  const assignmentPoints = assignmentCount * COURSEWORK_POINTS.assignment
  const projectPoints = projectCount * COURSEWORK_POINTS.project

  return {
    assignmentCount,
    projectCount,
    assignmentPoints,
    projectPoints,
    points: assignmentPoints + projectPoints,
    validSubmissionCount: canonicalRows.length,
    canonicalSubmissionIds: canonicalRows.map(row => row.id).filter(id => id != null),
  }
}
