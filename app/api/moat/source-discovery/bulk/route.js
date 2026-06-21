import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'
import { runBulkSourceDiscovery } from '@/lib/moat/source-discovery-bulk'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const result = await runBulkSourceDiscovery({ mode: 'discover_all' })
    return moatJson(result)
  } catch (err) {
    console.error('[moat-source-discovery-bulk] failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not run bulk source discovery') }, { status: 500 })
  }
}
