import { normalizeHealthCourseworkType } from './health-card-domain.js'

export function normalizeCourseworkMappingText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isActiveCanonicalCoursework(item) {
  return Boolean(
    item?.id
    && item.catalog_status === 'canonical'
    && item.active
    && !item.deactivated_at
    && !item.batch
    && ['assignment', 'project'].includes(normalizeHealthCourseworkType(item.item_type)),
  )
}

export function chooseSafeStudentMapping({ sourceTopic, sourceType, sourcePhase, canonicalItems = [], aliases = [] }) {
  const normalizedType = normalizeHealthCourseworkType(sourceType)
  const normalizedTopic = normalizeCourseworkMappingText(sourceTopic)
  const phase = String(sourcePhase || '').trim()
  if (!normalizedTopic || !normalizedType) return { mode: 'pending_review', reason: 'Missing or legacy coursework type requires review.' }

  const candidates = canonicalItems.filter(item => (
    isActiveCanonicalCoursework(item)
    && normalizeHealthCourseworkType(item.item_type) === normalizedType
    && (!phase || !item.phase || String(item.phase).trim() === phase)
  ))
  const exact = candidates.filter(item => normalizeCourseworkMappingText(item.title) === normalizedTopic)
  if (exact.length === 1) return { mode: 'auto_applied', item: exact[0], reason: 'Exact canonical title and type match.' }

  const aliasMatches = aliases.filter(alias => (
    alias?.mapping_status === 'mapped'
    && ['EXACT', 'HIGH_CONFIDENCE', 'CONFIRMED'].includes(String(alias.confidence || '').toUpperCase())
    && normalizeCourseworkMappingText(alias.normalized_alias || alias.original_alias) === normalizedTopic
    && (!alias.source_item_type || normalizeHealthCourseworkType(alias.source_item_type) === normalizedType)
    && (!phase || !alias.source_phase || String(alias.source_phase).trim() === phase)
  ))
  const aliasItemIds = [...new Set(aliasMatches.map(alias => String(alias.canonical_coursework_item_id || '')))].filter(Boolean)
  const aliasItems = candidates.filter(item => aliasItemIds.includes(String(item.id)))
  if (aliasItems.length === 1) return { mode: 'auto_applied', item: aliasItems[0], reason: 'High-confidence canonical alias match.' }

  return { mode: 'pending_review', reason: exact.length > 1 || aliasItems.length > 1 ? 'Multiple canonical coursework matches require review.' : 'No safe canonical match was found.' }
}

