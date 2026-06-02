import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for API routes and AI pipeline only.
 * Never import this from client components.
 */
let adminClient = null

export function getSupabaseAdmin() {
  if (adminClient) return adminClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  }

  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return adminClient
}
