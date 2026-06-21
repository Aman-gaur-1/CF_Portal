import { unstable_noStore as noStore } from 'next/cache'
import { loadMoatInsights } from '@/lib/moat/review-intelligence'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const data = await loadMoatInsights()
    return moatJson(data)
  } catch (err) {
    console.error('[moat-insights] load failed', err?.message)
    return moatJson({ error: err?.message || 'Could not load insights' }, { status: 500 })
  }
}
