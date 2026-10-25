const HEALTH_CARD_PHASES = ['Python', 'Data Analytics', 'SQL']

function normalizeHealthCardPhase(value) {
  const text = String(value || '').trim().toLowerCase()
  return HEALTH_CARD_PHASES.find(phase => phase.toLowerCase() === text) || ''
}

function normalizeHealthCourseworkType(value) {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'assignment' || text === '100') return 'assignment'
  if (text === 'project' || text === '200') return 'project'
  return ''
}

export function normalizeCatalogPhase(value) {
  return normalizeHealthCardPhase(value)
}

export function normalizeCatalogType(value) {
  return normalizeHealthCourseworkType(value)
}

export function normalizeCatalogTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function courseworkIdentity(item = {}) {
  const phase = normalizeCatalogPhase(item.phase)
  const itemType = normalizeCatalogType(item.item_type || item.itemType || item.type)
  const title = normalizeCatalogTitle(item.title)
  if (!HEALTH_CARD_PHASES.includes(phase) || !itemType || !title) return ''
  return `${phase.toLowerCase()}|${itemType}|${title}`
}
