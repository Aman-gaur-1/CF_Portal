import { unstable_noStore as noStore } from 'next/cache'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'
import { getIngestionProviderCatalog } from '@/lib/moat/jobs/ingestion-runner'
import { listIngestionJobs } from '@/lib/moat/jobs/ingestion-history'
import { updateIngestionJobStatus } from '@/lib/moat/jobs/ingestion-queue'
import { parseMoatLimit } from '@/lib/moat/response-limits'
import { getReviewAutoSyncStatus } from '@/lib/moat/jobs/bulk-review-collection'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const jobs = await listIngestionJobs({
      status: searchParams.get('status') || 'all',
      limit: parseMoatLimit(searchParams.get('limit') || '50'),
    })
    const autoSync = await getReviewAutoSyncStatus()
    return moatJson({ jobs, providers: getIngestionProviderCatalog(), autoSync })
  } catch (err) {
    console.error('[moat-jobs] load failed', err?.message)
    return moatJson({ error: 'Could not load ingestion jobs' }, { status: 500 })
  }
}

export async function PATCH(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json()
    const job = await updateIngestionJobStatus({
      jobId: body?.id,
      createdAt: body?.created_at,
      status: body?.status,
      errorMessage: body?.error_message,
      reviewsCollected: body?.reviews_collected,
    })
    return moatJson({ job })
  } catch (err) {
    console.error('[moat-jobs] update failed', err?.message)
    return moatJson({ error: err?.message || 'Could not update ingestion job' }, { status: 400 })
  }
}
