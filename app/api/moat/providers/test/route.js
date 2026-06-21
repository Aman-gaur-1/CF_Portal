import { getSupabaseAdmin } from '@/lib/supabase-server'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'
import { createApifyProvider } from '@/lib/moat/providers/apify-provider'

export const dynamic = 'force-dynamic'

function dbStatusFor(result) {
  if (result.status === 'missing_token') return 'not_configured'
  if (result.status === 'ready') return 'ready'
  return 'error'
}

function labelFor(result) {
  if (result.status === 'missing_token') return 'Missing Token'
  if (result.status === 'invalid_token') return 'Invalid Token'
  if (result.status === 'ready') return 'Connected'
  return 'Connection Error'
}

export async function POST(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json().catch(() => ({}))
    const providerName = String(body?.provider_name || '').trim()
    if (providerName !== 'apify') throw new Error('Only Apify health check is supported.')

    const result = await createApifyProvider().testConnection()
    const status = dbStatusFor(result)

    const { data, error } = await getSupabaseAdmin()
      .from('provider_configs')
      .upsert({
        provider_name: 'apify',
        enabled: status === 'ready',
        status,
        last_tested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_name' })
      .select('id, provider_name, enabled, status, last_tested_at, created_at, updated_at')
      .single()

    if (error) throw error

    return moatJson({
      result: {
        provider_name: 'apify',
        ok: result.ok,
        status,
        label: labelFor(result),
        message: result.message,
        providerStatus: result.providerStatus || null,
      },
      provider: data,
    })
  } catch (err) {
    console.error('[moat-provider-test] failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not test provider connection') }, { status: 400 })
  }
}
