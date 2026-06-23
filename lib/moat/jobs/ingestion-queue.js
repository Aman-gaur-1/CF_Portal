import { getSupabaseAdmin } from '@/lib/supabase-server'

export const INGESTION_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled']

export async function enqueueIngestionJob({ competitorId, sourceId, requestedBy, provider, metadata = {} }) {
  if (!competitorId) throw new Error('competitorId is required')
  if (!provider) throw new Error('provider is required')

  const supabase = getSupabaseAdmin()
  const payload = {
    competitor_id: competitorId,
    source_id: sourceId || null,
    job_type: 'review_sync',
    status: 'queued',
    requested_by: requestedBy || 'admin',
    request_payload: { provider, ...metadata },
    result_summary: {},
    reviews_collected: 0,
  }

  const { data, error } = await supabase
    .from('scrape_jobs')
    .insert(payload)
    .select('*, competitors(id, name), review_sources(id, source_type, source_url)')
    .single()

  if (error) throw error
  return data
}

export async function updateIngestionJobStatus({ jobId, createdAt, status, errorMessage, reviewsCollected, resultSummary }) {
  if (!jobId || !createdAt) throw new Error('jobId and createdAt are required')
  if (!INGESTION_JOB_STATUSES.includes(status)) throw new Error('Unsupported job status')

  const patch = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (status === 'running') patch.started_at = new Date().toISOString()
  if (['succeeded', 'failed', 'cancelled'].includes(status)) {
    patch.completed_at = new Date().toISOString()
  }
  if (errorMessage !== undefined) patch.error_message = errorMessage || null
  if (reviewsCollected !== undefined) patch.reviews_collected = Number(reviewsCollected) || 0
  if (resultSummary !== undefined) patch.result_summary = resultSummary || {}

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('scrape_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('created_at', createdAt)
    .select('*, competitors(id, name), review_sources(id, source_type, source_url)')
    .single()

  if (error) throw error
  return data
}
