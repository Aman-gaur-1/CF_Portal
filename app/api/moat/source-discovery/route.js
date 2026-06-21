import { getSupabaseAdmin } from '@/lib/supabase-server'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'
import { discoverSourceProfile } from '@/lib/moat/source-discovery'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    const competitorId = String(body?.competitor_id || '').trim()
    const sourceType = String(body?.source_type || '').trim()
    if (!competitorId) throw new Error('Competitor is required')
    if (!sourceType) throw new Error('Source type is required')

    const supabase = getSupabaseAdmin()
    const { data: competitor, error: competitorError } = await supabase
      .from('competitors')
      .select('id, name, slug, website_url, category, city, active')
      .eq('id', competitorId)
      .single()
    if (competitorError) throw competitorError

    const discovery = discoverSourceProfile({ competitor, sourceType })

    const { data: existing, error: existingError } = await supabase
      .from('competitor_source_profiles')
      .select('id, active, profile_url, search_pattern, external_identifier')
      .eq('competitor_id', competitorId)
      .eq('source_type', sourceType)
    if (existingError) throw existingError
    const duplicate = (existing || []).find(row => (
      (discovery.profile_url && row.profile_url === discovery.profile_url)
      || (discovery.search_pattern && row.search_pattern === discovery.search_pattern)
      || (discovery.external_identifier && row.external_identifier === discovery.external_identifier)
    ))

    return moatJson({
      discovery: {
        competitor_id: competitorId,
        ...discovery,
        duplicate: Boolean(duplicate),
        existing_profile_id: duplicate?.id || null,
      },
    })
  } catch (err) {
    console.error('[moat-source-discovery] failed', err?.message)
    return moatJson({ error: err?.message || 'Could not auto discover source profile' }, { status: 400 })
  }
}
