import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for API routes and AI pipeline only.
 * Never import this from client components.
 */
let adminClient = null

export function getSupabaseAdmin() {
  if (adminClient) return adminClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = resolveServiceRoleKey()

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or service-role Supabase key')
  }

  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return adminClient
}

function resolveServiceRoleKey() {
  const keys = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
  ].map(value => String(value || '').trim()).filter(Boolean)

  return keys.find(key => decodeJwtRole(key) === 'service_role') || ''
}

function decodeJwtRole(token) {
  try {
    const [, payload] = String(token || '').split('.')
    if (!payload) return ''
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.role || ''
  } catch {
    return ''
  }
}
