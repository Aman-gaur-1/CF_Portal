import { unstable_noStore as noStore } from 'next/cache'
import { loadMoatMarketDemand } from '@/lib/moat/market-demand-engine'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const data = await loadMoatMarketDemand({
      competitorId: searchParams.get('competitor_id') || '',
      category: searchParams.get('category') || '',
      priority: searchParams.get('priority') || '',
      search: searchParams.get('search') || '',
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '50',
    })
    return moatJson(data)
  } catch (err) {
    console.error('[moat-market-demand] load failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not load market demand') }, { status: 500 })
  }
}
