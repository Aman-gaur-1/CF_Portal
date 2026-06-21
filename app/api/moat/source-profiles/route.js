import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'
import { normalizeSourceProfilePayload, SUPPORTED_MOAT_SOURCE_TYPES } from '@/lib/moat/source-validation'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const competitorId = searchParams.get('competitor_id')
    const active = searchParams.get('active')

    let query = getSupabaseAdmin()
      .from('competitor_source_profiles')
      .select('id, competitor_id, source_type, profile_url, search_pattern, external_identifier, active, created_at, updated_at, competitors(id, name, category, city)')
      .order('created_at', { ascending: false })

    if (competitorId && competitorId !== 'all') query = query.eq('competitor_id', competitorId)
    if (active === 'true') query = query.eq('active', true)
    if (active === 'false') query = query.eq('active', false)

    const { data, error } = await query
    if (error) throw error
    return moatJson({ sourceProfiles: data || [], supportedSourceTypes: SUPPORTED_MOAT_SOURCE_TYPES })
  } catch (err) {
    console.error('[moat-source-profiles] load failed', err?.message)
    return moatJson({ error: 'Could not load source profiles' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    const payload = normalizeSourceProfilePayload(body)
    const { data, error } = await getSupabaseAdmin()
      .from('competitor_source_profiles')
      .insert({ ...payload, created_at: new Date().toISOString() })
      .select('id, competitor_id, source_type, profile_url, search_pattern, external_identifier, active, created_at, updated_at, competitors(id, name, category, city)')
      .single()
    if (error) throw error
    return moatJson({ sourceProfile: data }, { status: 201 })
  } catch (err) {
    console.error('[moat-source-profiles] create failed', err?.message)
    return moatJson({ error: err?.message || 'Could not create source profile' }, { status: 400 })
  }
}

export async function PATCH(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    if (!body?.id) throw new Error('Source profile id is required')
    const payload = normalizeSourceProfilePayload(body)
    const { data, error } = await getSupabaseAdmin()
      .from('competitor_source_profiles')
      .update(payload)
      .eq('id', body.id)
      .select('id, competitor_id, source_type, profile_url, search_pattern, external_identifier, active, created_at, updated_at, competitors(id, name, category, city)')
      .single()
    if (error) throw error
    return moatJson({ sourceProfile: data })
  } catch (err) {
    console.error('[moat-source-profiles] update failed', err?.message)
    return moatJson({ error: err?.message || 'Could not update source profile' }, { status: 400 })
  }
}
