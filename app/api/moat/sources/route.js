import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

const SUPPORTED_SOURCE_TYPES = new Set([
  'google_maps',
  'trustpilot',
  'reddit',
  'youtube',
  'quora',
  'justdial',
  'website',
])

function normalizeSourcePayload(body) {
  const competitorId = String(body?.competitor_id || '').trim()
  const sourceType = String(body?.source_type || '').trim()
  const sourceUrl = String(body?.source_url || '').trim()
  const active = body?.active !== false

  if (!competitorId) throw new Error('Competitor is required')
  if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) throw new Error('Unsupported source type')
  if (!sourceUrl) throw new Error('Source URL is required')

  return {
    competitor_id: competitorId,
    source_type: sourceType,
    source_name: String(body?.source_name || sourceType).trim(),
    source_url: sourceUrl,
    active,
    status: active ? 'active' : 'inactive',
    updated_at: new Date().toISOString(),
  }
}

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const competitorId = searchParams.get('competitor_id')
    const active = searchParams.get('active')

    let query = getSupabaseAdmin()
      .from('review_sources')
      .select('id, competitor_id, source_type, source_name, source_url, active, status, created_at, updated_at, competitors(id, name, category, city)')
      .order('created_at', { ascending: false })

    if (competitorId && competitorId !== 'all') query = query.eq('competitor_id', competitorId)
    if (active === 'true') query = query.eq('active', true)
    if (active === 'false') query = query.eq('active', false)

    const { data, error } = await query
    if (error) throw error
    return moatJson({ sources: data || [] })
  } catch (err) {
    console.error('[moat-sources] load failed', err?.message)
    return moatJson({ error: 'Could not load review sources' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    const payload = normalizeSourcePayload(body)
    const { data, error } = await getSupabaseAdmin()
      .from('review_sources')
      .insert({ ...payload, source_config: {}, created_at: new Date().toISOString() })
      .select('id, competitor_id, source_type, source_name, source_url, active, status, created_at, updated_at, competitors(id, name, category, city)')
      .single()

    if (error) throw error
    return moatJson({ source: data }, { status: 201 })
  } catch (err) {
    console.error('[moat-sources] create failed', err?.message)
    return moatJson({ error: err?.message || 'Could not create review source' }, { status: 400 })
  }
}

export async function PATCH(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    if (!body?.id) throw new Error('Source id is required')
    const payload = normalizeSourcePayload(body)
    const { data, error } = await getSupabaseAdmin()
      .from('review_sources')
      .update(payload)
      .eq('id', body.id)
      .select('id, competitor_id, source_type, source_name, source_url, active, status, created_at, updated_at, competitors(id, name, category, city)')
      .single()

    if (error) throw error
    return moatJson({ source: data })
  } catch (err) {
    console.error('[moat-sources] update failed', err?.message)
    return moatJson({ error: err?.message || 'Could not update review source' }, { status: 400 })
  }
}
