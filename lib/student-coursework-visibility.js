import { HEALTH_CARD_PHASES, isSupportedHealthCardPhase } from './health-card-admin.js'

export function selectVisibleStudentCoursework({ assignments = [], items = [], batch, getState } = {}) {
  const itemById = new Map(items.map(item => [String(item.id), item]))
  return assignments
    .filter(assignment => assignment.active !== false && String(assignment.batch || '') === String(batch || ''))
    .map(assignment => {
      const item = itemById.get(String(assignment.coursework_item_id))
      if (!item || item.active !== true || !isSupportedHealthCardPhase(item.phase)) return null
      if (item.batch !== null && item.batch !== undefined && String(item.batch) !== String(batch || '')) return null
      const state = typeof getState === 'function' ? getState(item, assignment) || {} : {}
      return {
        ...item,
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
