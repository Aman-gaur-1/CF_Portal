import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'
import { buildProviderRegistry, SUPPORTED_PROVIDER_NAMES } from '@/lib/moat/providers/provider-registry'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('provider_configs')
      .select('id, provider_name, enabled, status, last_tested_at, created_at, updated_at')
      .order('provider_name', { ascending: true })
    if (error) throw error

    const registry = buildProviderRegistry(data || [])
    return moatJson({ providers: data || [], registryStatus: registry.getStatus() })
  } catch (err) {
    console.error('[moat-providers] load failed', err?.message)
    return moatJson({ error: 'Could not load providers' }, { status: 500 })
  }
}

export async function PATCH(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    const providerName = String(body?.provider_name || '').trim()
    if (!SUPPORTED_PROVIDER_NAMES.includes(providerName)) throw new Error('Unsupported provider')

    const enabled = body?.enabled === true
    const { data, error } = await getSupabaseAdmin()
      .from('provider_configs')
      .upsert({
        provider_name: providerName,
        enabled,
        status: enabled ? 'ready' : 'not_configured',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_name' })
      .select('id, provider_name, enabled, status, last_tested_at, created_at, updated_at')
      .single()

    if (error) throw error
    return moatJson({ provider: data })
  } catch (err) {
    console.error('[moat-providers] update failed', err?.message)
    return moatJson({ error: err?.message || 'Could not update provider' }, { status: 400 })
  }
}
