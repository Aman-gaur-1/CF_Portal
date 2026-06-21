import { SUPPORTED_MOAT_SOURCE_TYPES } from './source-validation'

function normalizeWebsiteUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    return new URL(raw).toString()
  } catch {
    try {
      return new URL(`https://${raw}`).toString()
    } catch {
      return null
    }
  }
}

function websiteHost(value) {
  const normalized = normalizeWebsiteUrl(value)
  if (!normalized) return ''
  return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase()
}

function queryFor(competitor) {
  return [competitor?.name, competitor?.city].filter(Boolean).join(' ').trim()
}

function searchUrl(base, query) {
  const url = new URL(base)
  url.searchParams.set('q', query)
  return url.toString()
}

function googleMapsUrl(query) {
  const url = new URL('https://www.google.com/maps/search/')
  url.searchParams.set('api', '1')
  url.searchParams.set('query', query)
  return url.toString()
}

export function discoverSourceProfile({ competitor, sourceType }) {
  if (!competitor?.id) throw new Error('Competitor is required')
  if (!SUPPORTED_MOAT_SOURCE_TYPES.includes(sourceType)) throw new Error('Unsupported source type')

  const website = normalizeWebsiteUrl(competitor.website_url)
  const host = websiteHost(website)
  const query = queryFor(competitor)
  const name = String(competitor.name || '').trim()

  if (sourceType === 'website') {
    if (!website) throw new Error('Competitor website is required for website discovery')
    return {
      source_type: sourceType,
      profile_url: website,
      search_pattern: '',
      external_identifier: host,
      confidence: 0.95,
      confidence_label: 'high',
      rationale: 'Uses the competitor website already stored in Moat.',
    }
  }

  if (sourceType === 'trustpilot') {
    if (!host) throw new Error('Competitor website is required for Trustpilot discovery')
    return {
      source_type: sourceType,
      profile_url: `https://www.trustpilot.com/review/${host}`,
      search_pattern: `Trustpilot ${host}`,
      external_identifier: host,
      confidence: 0.7,
      confidence_label: 'medium',
      rationale: 'Derives the standard Trustpilot review URL from the website domain.',
    }
  }

  if (sourceType === 'google_maps') {
    if (!query) throw new Error('Competitor name is required for Google Maps discovery')
    return {
      source_type: sourceType,
      profile_url: googleMapsUrl(query),
      search_pattern: `${query} Google Maps reviews`,
      external_identifier: query,
      confidence: 0.55,
      confidence_label: 'low',
      rationale: 'Creates a Google Maps search URL from competitor identity. Exact place URL should be verified before ingestion.',
    }
  }

  if (sourceType === 'reddit') {
    if (!name) throw new Error('Competitor name is required for Reddit discovery')
    return {
      source_type: sourceType,
      profile_url: '',
      search_pattern: `site:reddit.com ${name}`,
      external_identifier: name.toLowerCase().replace(/\s+/g, '-'),
      confidence: 0.6,
      confidence_label: 'medium',
      rationale: 'Creates a Reddit search pattern for future source review.',
    }
  }

  if (sourceType === 'youtube') {
    if (!name) throw new Error('Competitor name is required for YouTube discovery')
    return {
      source_type: sourceType,
      profile_url: searchUrl('https://www.youtube.com/results', name),
      search_pattern: `${name} YouTube`,
      external_identifier: name,
      confidence: 0.55,
      confidence_label: 'low',
      rationale: 'Creates a YouTube search URL. Exact channel/profile should be verified before collection.',
    }
  }

  if (sourceType === 'quora') {
    if (!name) throw new Error('Competitor name is required for Quora discovery')
    return {
      source_type: sourceType,
      profile_url: searchUrl('https://www.quora.com/search', name),
      search_pattern: `${name} Quora`,
      external_identifier: name,
      confidence: 0.55,
      confidence_label: 'low',
      rationale: 'Creates a Quora search URL. Exact topic/profile should be verified before collection.',
    }
  }

  throw new Error('Auto discovery is not supported for this source type yet')
}
