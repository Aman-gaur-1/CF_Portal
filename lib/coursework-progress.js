import { HEALTH_CARD_PHASES, normalizeHealthCardPhase, normalizeHealthCourseworkType } from './health-card-admin.js'
import { courseworkIdentity } from './coursework-identity.js'

export const CUMULATIVE_PHASES = Object.freeze(['Python', 'Data Analytics', 'SQL'])

export function normalizeProgressPayload(body = {}) {
  const batch = String(body.batch || '').trim()
  const phase = normalizeHealthCardPhase(body.phase)
  const itemType = normalizeHealthCourseworkType(body.itemType || body.item_type)
  const coveredThroughCourseworkItemId = String(body.coveredThroughCourseworkItemId || body.covered_through_coursework_item_id || '').trim()
  if (!batch || batch.length > 160) return { error: 'A valid batch is required.' }
  if (!phase || !CUMULATIVE_PHASES.includes(phase)) return { error: 'A valid cumulative phase is required.' }
  if (!itemType) return { error: 'Type must be assignment or project.' }
  if (!coveredThroughCourseworkItemId) return { error: 'Select the item covered through.' }
  return {
    value: {
      batch,
      phase,
      itemType,
      coveredThroughCourseworkItemId,
      confirmBackward: body.confirmBackward === true,
    },
  }
}

export function sortProgressItems(items = []) {
  return [...items].sort((left, right) => (
    (Number(left.sort_order) || 0) - (Number(right.sort_order) || 0)
    || String(left.title || '').localeCompare(String(right.title || ''))
    || String(left.id || '').localeCompare(String(right.id || ''))
  ))
}

export function buildProgressPreview({ globalItems = [], activations = [], currentProgress = null, phase = '', itemType = '', targetItemId = '', activeStudentCount = 0 } = {}) {
  const target = globalItems.find(item => String(item.id) === String(targetItemId)) || null
  const selectedPhase = phase || currentProgress?.phase || target?.phase || ''
  const selectedType = itemType || currentProgress?.item_type || target?.item_type || ''
  const eligible = sortProgressItems(globalItems.filter(item => (
    item?.batch == null
    && item?.active !== false
    && item.phase === selectedPhase
    && item.item_type === selectedType
    && Number.isInteger(Number(item.sort_order))
    && target
    && Number(item.sort_order) <= Number(target.sort_order)
  )))
  const activeIds = new Set((activations || []).filter(row => row.active).map(row => String(row.coursework_item_id)))
  const activeKeys = new Set((activations || []).filter(row => row.active).map(row => courseworkIdentity(row.item)).filter(Boolean))
  const newItems = eligible.filter(item => !activeIds.has(String(item.id)) && !activeKeys.has(courseworkIdentity(item)))
  const backward = Boolean(
    currentProgress
    && target
    && Number(currentProgress.covered_through_sort_order) > Number(target.sort_order)
  )
  return {
    target,
    eligibleItems: eligible,
    newItems,
    newItemCount: newItems.length,
    activeStudentCount: Number(activeStudentCount) || 0,
    backward,
    existingActivationsRetained: true,
    previewText: backward
      ? `This moves backward. Existing activated work will be retained; ${newItems.length} earlier item(s) would be newly covered.`
      : `This will make ${newItems.length} new item(s) available to ${Number(activeStudentCount) || 0} active student(s). Earlier covered work remains active.`,
  }
}

export function progressPhaseOrder(phase) {
  return CUMULATIVE_PHASES.indexOf(String(phase || ''))
}

export function isCumulativePhase(phase) {
  return HEALTH_CARD_PHASES.includes(String(phase || '')) && progressPhaseOrder(phase) >= 0
}
