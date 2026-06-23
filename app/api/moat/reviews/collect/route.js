import { unstable_noStore as noStore } from 'next/cache'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'
import { collectReviewsForProfiles } from '@/lib/moat/jobs/bulk-review-collection'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function readOptions(request) {
  const { searchParams } = new URL(request.url)
  const body = await request.json().catch(() => ({}))
  return {
    mode: body.mode || searchParams.get('mode') || 'all',
    collectionMode: body.collection_mode || body.collectionMode || searchParams.get('collection_mode') || 'incremental',
    reviewFilter: body.review_filter || body.reviewFilter || searchParams.get('review_filter') || 'all',
    competitorIds: body.competitor_ids || body.competitorIds || searchParams.get('competitor_ids'),
    sourceTypes: body.source_types || body.sourceTypes || searchParams.get('source_types'),
    startDate: body.start_date || body.startDate || searchParams.get('start_date'),
    endDate: body.end_date || body.endDate || searchParams.get('end_date'),
    limit: body.limit || searchParams.get('limit'),
  }
}

export async function POST(request) {
  noStore()
  const admin = requireMoatAdmin(request)
  if (!admin) return moatUnauthorized()

  try {
    const options = await readOptions(request)
    const result = await collectReviewsForProfiles({
      ...options,
      requestedBy: admin.name || 'admin',
    })
    return moatJson(result)
  } catch (err) {
    console.error('[moat-advanced-collect] failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not run advanced collection') }, { status: 500 })
  }
}
