import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function normalizeCompetitorPayload(body) {
  const name = String(body?.name || '').trim()
  if (!name) throw new Error('Name is required')

  const active = body?.active !== false
  return {
    name,
    slug: slugify(body?.slug || name),
    website_url: String(body?.website || body?.website_url || '').trim() || null,
    category: String(body?.category || '').trim() || null,
    city: String(body?.city || '').trim() || null,
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
    const search = searchParams.get('search')?.trim()
    const category = searchParams.get('category')?.trim()
    const active = searchParams.get('active')

    let query = getSupabaseAdmin()
      .from('competitors')
      .select('id, name, slug, website_url, category, city, active, status, created_at, updated_at')
      .order('name', { ascending: true })

    if (search) query = query.ilike('name', `%${search}%`)
    if (category && category !== 'all') query = query.eq('category', category)
    if (active === 'true') query = query.eq('active', true)
    if (active === 'false') query = query.eq('active', false)

    const { data, error } = await query
    if (error) throw error

    const categories = [...new Set((data || []).map(row => row.category).filter(Boolean))].sort()
    return moatJson({ competitors: data || [], categories })
  } catch (err) {
    console.error('[moat-competitors] load failed', err?.message)
    return moatJson({ error: 'Could not load competitors' }, { status: 500 })
  }
}

export async function POST(request) {
  const admin = requireMoatAdmin(request)
  if (!admin) return moatUnauthorized()

  try {
    const body = await request.json()
    const payload = normalizeCompetitorPayload(body)
    const { data, error } = await getSupabaseAdmin()
      .from('competitors')
      .insert({ ...payload, created_at: new Date().toISOString() })
      .select('id, name, slug, website_url, category, city, active, status, created_at, updated_at')
      .single()

    if (error) throw error
    return moatJson({ competitor: data }, { status: 201 })
  } catch (err) {
    console.error('[moat-competitors] create failed', err?.message)
    return moatJson({ error: err?.message || 'Could not create competitor' }, { status: 400 })
  }
}

export async function PATCH(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    const id = body?.id
    if (!id) throw new Error('Competitor id is required')

    const payload = normalizeCompetitorPayload(body)
    const { data, error } = await getSupabaseAdmin()
      .from('competitors')
      .update(payload)
      .eq('id', id)
      .select('id, name, slug, website_url, category, city, active, status, created_at, updated_at')
      .single()

    if (error) throw error
    return moatJson({ competitor: data })
  } catch (err) {
    console.error('[moat-competitors] update failed', err?.message)
    return moatJson({ error: err?.message || 'Could not update competitor' }, { status: 400 })
  }
}
