import { unstable_noStore as noStore } from 'next/cache'
import { loadMoatKpis } from '@/lib/moat/kpi-service'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const kpis = await loadMoatKpis()
    return moatJson({ kpis })
  } catch (err) {
    console.error('[moat-kpis] load failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not load Moat KPIs') }, { status: 500 })
  }
}
