import { unstable_noStore as noStore } from 'next/cache'
import { analyzeMoatReviews } from '@/lib/moat/review-intelligence'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const body = await request.json().catch(() => ({}))
    const result = await analyzeMoatReviews({ batchSize: body?.batch_size || 25 })
    return moatJson(result)
  } catch (err) {
    console.error('[moat-analyze-reviews] run failed', err?.message)
    return moatJson({
      processed: 0,
      skipped: 0,
      failed: 1,
      error: err?.message || 'Could not analyze reviews',
    }, { status: 500 })
  }
}
