import { isSupportedHealthCardPhase } from '@/lib/health-card-admin'
import { normalizeHealthCourseworkType } from '@/lib/health-card-domain'
import { courseworkIdentity } from '@/lib/coursework-identity'

export function normalizeActivationItems(items) {
  return [...new Set((Array.isArray(items) ? items : [items])
    .map(value => String(value || '').trim())
    .filter(Boolean))]
}

export function validateActivationPayload(body = {}) {
  const batch = String(body.batch || '').trim()
  const courseworkItemIds = normalizeActivationItems(body.courseworkItemIds || body.coursework_item_ids)
  if (!batch) return { error: 'Batch is required.' }
  if (!courseworkItemIds.length) return { error: 'Select at least one coursework item.' }
  if (courseworkItemIds.length > 200) return { error: 'Activate no more than 200 coursework items at once.' }
  const dueAt = body.dueAt || body.due_at || null
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) return { error: 'Due date is invalid.' }
  return { value: { batch, courseworkItemIds, dueAt: dueAt ? new Date(dueAt).toISOString() : null } }
}

export function itemIsCompatibleWithBatch(item, batch) {
  return item && item.active !== false && normalizeHealthCourseworkType(item.item_type) && isSupportedHealthCardPhase(item.phase) && (!item.batch || String(item.batch) === String(batch))
}

export function isGlobalCatalogItem(item) {
  return Boolean(item && item.batch == null && item.active !== false && courseworkIdentity(item))
}

export function isValidCatalogItem(item) {
  return Boolean(item && normalizeHealthCourseworkType(item.item_type) && isSupportedHealthCardPhase(item.phase) && courseworkIdentity(item))
}

export function findEquivalentActiveCatalogItems(items = [], activeItems = []) {
  const activeKeys = new Set(activeItems.map(courseworkIdentity).filter(Boolean))
  return items.filter(item => activeKeys.has(courseworkIdentity(item)))
}
