import { getSupabaseAdmin } from '@/lib/supabase-server'
import { discoverSourceProfile } from './source-discovery'
import { normalizeSourceProfilePayload } from './source-validation'

export const BULK_DISCOVERY_SOURCE_TYPES = [
  'google_maps',
  'trustpilot',
  'reddit',
  'youtube',
  'quora',
  'website',
]

function existingKey(profile) {
  return `${profile.competitor_id}:${profile.source_type}`
}

function serializeError(error) {
  return String(error?.message || 'Discovery failed')
}

async function loadDiscoveryContext() {
  const supabase = getSupabaseAdmin()
  const [competitorsResult, profilesResult] = await Promise.all([
    supabase
      .from('competitors')
      .select('id, name, slug, website_url, category, city, active')
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('competitor_source_profiles')
      .select('id, competitor_id, source_type, profile_url, search_pattern, external_identifier, active, created_at, updated_at'),
  ])

  if (competitorsResult.error) throw competitorsResult.error
  if (profilesResult.error) throw profilesResult.error

  return {
    competitors: competitorsResult.data || [],
    existingProfiles: profilesResult.data || [],
  }
}

function buildProfilePayload(competitor, sourceType) {
  const discovery = discoverSourceProfile({ competitor, sourceType })
  return normalizeSourceProfilePayload({
    competitor_id: competitor.id,
    source_type: sourceType,
    profile_url: discovery.profile_url,
    search_pattern: discovery.search_pattern,
    external_identifier: discovery.external_identifier,
    active: true,
  })
}

async function createProfile(payload) {
  const { data, error } = await getSupabaseAdmin()
    .from('competitor_source_profiles')
    .insert({ ...payload, created_at: new Date().toISOString() })
    .select('id, competitor_id, source_type')
    .single()
  if (error) throw error
  return data
}

async function updateProfile(id, payload) {
  const { data, error } = await getSupabaseAdmin()
    .from('competitor_source_profiles')
    .update(payload)
    .eq('id', id)
    .select('id, competitor_id, source_type')
    .single()
  if (error) throw error
  return data
}

export async function runBulkSourceDiscovery({ mode }) {
  const { competitors, existingProfiles } = await loadDiscoveryContext()
  const existingByCompetitorType = new Map(existingProfiles.map(profile => [existingKey(profile), profile]))
  const summary = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  }

  for (const competitor of competitors) {
    let competitorTouched = false
    const competitorFailures = []

    for (const sourceType of BULK_DISCOVERY_SOURCE_TYPES) {
      const key = `${competitor.id}:${sourceType}`
      const existing = existingByCompetitorType.get(key)

      if (mode === 'missing' && existing) {
        summary.skipped += 1
        continue
      }

      if (mode === 'discover_all' && existing) {
        summary.skipped += 1
        continue
      }

      if (mode === 'refresh_all' && !existing) {
        summary.skipped += 1
        continue
      }

      try {
        const payload = buildProfilePayload(competitor, sourceType)
        if (mode === 'refresh_all') {
          const updated = await updateProfile(existing.id, payload)
          existingByCompetitorType.set(key, { ...existing, ...payload, id: updated.id })
          summary.updated += 1
        } else {
          const created = await createProfile(payload)
          existingByCompetitorType.set(key, { ...payload, id: created.id })
          summary.created += 1
        }
        competitorTouched = true
      } catch (error) {
        summary.failed += 1
        competitorFailures.push({ source_type: sourceType, error: serializeError(error) })
      }
    }

    summary.processed += 1
    summary.details.push({
      competitor_id: competitor.id,
      competitor: competitor.name,
      changed: competitorTouched,
      failures: competitorFailures,
    })
  }

  return summary
}
