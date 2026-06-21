import { getSupabaseAdmin } from '@/lib/supabase-server'

export async function listIngestionJobs({ limit = 100, status } = {}) {
  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('scrape_jobs')
    .select('*, competitors(id, name), review_sources(id, source_type, source_url)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status && status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error
  return data || []
}
