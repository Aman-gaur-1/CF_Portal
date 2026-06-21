import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'
import { SUPPORTED_MOAT_SOURCE_TYPES } from '@/lib/moat/source-validation'

export const dynamic = 'force-dynamic'

function isMissingRelation(error) {
  const message = String(error?.message || '')
  return error?.code === '42P01' || error?.code === 'PGRST205' || /could not find.*table|relation .* does not exist/i.test(message)
}

function optionalRows(result, tableName) {
  if (!result.error) return result.data || []
  if (isMissingRelation(result.error)) {
    console.warn(`[moat-readiness] optional table missing: ${tableName}`)
    return []
  }
  throw result.error
}

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const supabase = getSupabaseAdmin()
    const [competitorsResult, reviewSourcesResult, profilesResult, providersResult] = await Promise.all([
      supabase.from('competitors').select('id, name, active').eq('active', true),
      supabase.from('review_sources').select('id, competitor_id, source_type, active').eq('active', true),
      supabase.from('competitor_source_profiles').select('id, competitor_id, source_type, active').eq('active', true),
      supabase.from('provider_configs').select('id, provider_name, enabled').eq('enabled', true),
    ])

    if (competitorsResult.error) throw competitorsResult.error
    if (reviewSourcesResult.error) throw reviewSourcesResult.error

    const competitors = competitorsResult.data || []
    const reviewSources = reviewSourcesResult.data || []
    const profiles = optionalRows(profilesResult, 'competitor_source_profiles')
    const providers = optionalRows(providersResult, 'provider_configs')
    const sourceTypes = SUPPORTED_MOAT_SOURCE_TYPES
    const competitorCount = competitors.length
    const requiredSlots = competitorCount * sourceTypes.length
    const coverageKeys = new Set([
      ...reviewSources.map(row => `${row.competitor_id}:${row.source_type}`),
      ...profiles.map(row => `${row.competitor_id}:${row.source_type}`),
    ])
    const coveragePercent = requiredSlots ? Math.round((coverageKeys.size / requiredSlots) * 100) : 0

    const coverage = competitors.map(competitor => {
      const bySource = Object.fromEntries(sourceTypes.map(type => [type, coverageKeys.has(`${competitor.id}:${type}`)]))
      return { competitor_id: competitor.id, competitor_name: competitor.name, bySource }
    })

    return moatJson({
      metrics: {
        competitors: competitorCount,
        sourceProfiles: coverageKeys.size,
        reviewSources: reviewSources.length,
        coveragePercent,
        providersEnabled: providers.length,
      },
      coverage,
      supportedSourceTypes: sourceTypes,
    })
  } catch (err) {
    console.error('[moat-readiness] load failed', err?.message)
    return moatJson({ error: 'Could not load Moat readiness metrics' }, { status: 500 })
  }
}
