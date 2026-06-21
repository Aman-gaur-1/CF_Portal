import { unstable_noStore as noStore } from 'next/cache'
import { loadMoatAlerts } from '@/lib/moat/alert-engine'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const data = await loadMoatAlerts({
      competitorId: searchParams.get('competitor_id') || '',
      alertType: searchParams.get('alert_type') || '',
      severity: searchParams.get('severity') || '',
      search: searchParams.get('search') || '',
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '50',
    })
    return moatJson(data)
  } catch (err) {
    console.error('[moat-alerts] load failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not load alerts') }, { status: 500 })
  }
}
