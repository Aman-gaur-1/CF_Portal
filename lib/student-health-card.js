export const HEALTH_CARD_EPOCH = '2026-10-01'
export const HEALTH_CARD_TIMEZONE = 'Asia/Kolkata'

const HEALTH_ACTIVITY_TYPES = new Set(['assignment', 'project'])

export function getIndiaDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HEALTH_CARD_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

export function normalizeHealthActivityType(value) {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'project' || type === '200') return 'project'
  if (type === 'assignment' || type === '100') return 'assignment'
  return ''
}

export function isHealthActivityType(value) {
  return HEALTH_ACTIVITY_TYPES.has(normalizeHealthActivityType(value))
}

export function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate|unique/i.test(String(error?.message || ''))
}

export function isMissingHealthCardSchema(error) {
  return /relation .*does not exist|function .*does not exist|schema cache|column .*does not exist/i.test(
    String(error?.message || '')
  )
}

