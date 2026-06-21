import { unstable_noStore as noStore } from 'next/cache'
import { loadMoatExecutiveReport } from '@/lib/moat/executive-report-engine'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const data = await loadMoatExecutiveReport()
    return moatJson(data)
  } catch (err) {
    console.error('[moat-reports] load failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not load executive report') }, { status: 500 })
  }
}
