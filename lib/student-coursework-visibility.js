import { HEALTH_CARD_PHASES, isSupportedHealthCardPhase } from './health-card-admin.js'

export function selectVisibleStudentCoursework({ assignments = [], items = [], batch, getState } = {}) {
  const itemById = new Map(items.map(item => [String(item.id), item]))
  const canonicalById = new Map(items.filter(item => item.catalog_status === 'canonical').map(item => [String(item.id), item]))
  return assignments
    .filter(assignment => assignment.active !== false && String(assignment.batch || '') === String(batch || ''))
    .map(assignment => {
      const item = itemById.get(String(assignment.coursework_item_id))
      if (!item || item.active !== true) return null
      const displayItem = item.catalog_status == null || item.catalog_status === 'canonical'
        ? item
        : item.canonical_coursework_item_id
          ? canonicalById.get(String(item.canonical_coursework_item_id))
          : null
      if (!displayItem || displayItem.active !== true || !isSupportedHealthCardPhase(displayItem.phase)) return null
      if (item.batch !== null && item.batch !== undefined && String(item.batch) !== String(batch || '')) return null
      const state = typeof getState === 'function' ? getState(item, assignment, displayItem) || {} : {}
      return {
        ...displayItem,
        sourceCourseworkItemId: item.id === displayItem.id ? null : item.id,
        activationId: assignment.id,
        activatedAt: assignment.activated_at,
        dueAt: assignment.due_at || item.due_at || null,
        ...state,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (
      HEALTH_CARD_PHASES.indexOf(left.phase) - HEALTH_CARD_PHASES.indexOf(right.phase)
      || (Number(left.sort_order) || Number.MAX_SAFE_INTEGER) - (Number(right.sort_order) || Number.MAX_SAFE_INTEGER)
      || String(left.title || '').localeCompare(String(right.title || ''))
    ))
}

export function countStudentCourseworkPhases(coursework = []) {
  return coursework.reduce((counts, item) => {
    if (item.phase) counts[item.phase] = (counts[item.phase] || 0) + 1
    return counts
  }, {})
}
