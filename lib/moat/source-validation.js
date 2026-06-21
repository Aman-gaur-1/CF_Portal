export const SUPPORTED_MOAT_SOURCE_TYPES = [
  'google_maps',
  'trustpilot',
  'reddit',
  'youtube',
  'quora',
  'justdial',
  'website',
]

const URL_REQUIRED_TYPES = new Set(['google_maps', 'trustpilot', 'justdial', 'website'])
const URL_HOST_HINTS = {
  google_maps: ['google.', 'goo.gl', 'maps.app.goo.gl'],
  trustpilot: ['trustpilot.'],
  youtube: ['youtube.', 'youtu.be'],
  quora: ['quora.'],
  justdial: ['justdial.'],
}

export function isSupportedMoatSourceType(sourceType) {
  return SUPPORTED_MOAT_SOURCE_TYPES.includes(sourceType)
}

export function normalizeSourceProfilePayload(body) {
  const competitorId = String(body?.competitor_id || '').trim()
  const sourceType = String(body?.source_type || '').trim()
  const profileUrl = String(body?.profile_url || '').trim()
  const searchPattern = String(body?.search_pattern || '').trim()
  const externalIdentifier = String(body?.external_identifier || '').trim()
  const active = body?.active !== false

  if (!competitorId) throw new Error('Competitor is required')
  if (!isSupportedMoatSourceType(sourceType)) throw new Error('Unsupported source type')
  if (!profileUrl && !searchPattern && !externalIdentifier) {
    throw new Error('Provide a profile URL, search pattern, or external identifier')
  }
  if (URL_REQUIRED_TYPES.has(sourceType) && !profileUrl) {
    throw new Error(`${sourceType} requires a profile URL`)
  }
  if (profileUrl) validateProfileUrl(sourceType, profileUrl)

  return {
    competitor_id: competitorId,
    source_type: sourceType,
    profile_url: profileUrl || null,
    search_pattern: searchPattern || null,
    external_identifier: externalIdentifier || null,
    active,
    updated_at: new Date().toISOString(),
  }
}

export function validateProfileUrl(sourceType, value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Profile URL must be a valid URL')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Profile URL must use http or https')
  }

  const hints = URL_HOST_HINTS[sourceType] || []
  const host = url.hostname.toLowerCase()
  if (hints.length && !hints.some(hint => host.includes(hint))) {
    throw new Error(`Profile URL does not match ${sourceType}`)
  }
}
