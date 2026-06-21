import { unstable_noStore as noStore } from 'next/cache'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'
import { getScalerGoogleMapsSyncOptions, runScalerGoogleMapsSync } from '@/lib/moat/jobs/review-ingestion'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const options = await getScalerGoogleMapsSyncOptions()
    return moatJson({
      scope: {
        competitor: 'Scaler',
        source_type: 'google_maps',
        max_reviews: 10,
      },
      ...options,
    })
  } catch (err) {
    console.error('[moat-test-sync] load failed', err?.message)
    return moatJson({ error: 'Could not load test sync options' }, { status: 500 })
  }
}

export async function POST(request) {
  const admin = requireMoatAdmin(request)
  if (!admin) return moatUnauthorized()

  try {
    const body = await request.json()
    const result = await runScalerGoogleMapsSync({
      competitorId: body?.competitor_id,
      sourceProfileId: body?.source_profile_id,
      requestedBy: admin.name,
    })
    return moatJson({ result })
  } catch (err) {
    console.error('[moat-test-sync] run failed', err?.message)
    return moatJson({ error: err?.message || 'Could not run test sync' }, { status: 400 })
  }
}
