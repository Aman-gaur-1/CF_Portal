import { unstable_noStore as noStore } from 'next/cache'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'
import { collectReviewsForProfiles } from '@/lib/moat/jobs/bulk-review-collection'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function collectionLimit(request) {
  return new URL(request.url).searchParams.get('limit')
}

export async function POST(request) {
  noStore()
  const admin = requireMoatAdmin(request)
  if (!admin) return moatUnauthorized()

  try {
    const result = await collectReviewsForProfiles({
      mode: 'all',
      requestedBy: admin.name || 'admin',
      limit: collectionLimit(request),
    })
    return moatJson(result)
  } catch (err) {
    console.error('[moat-collect-all] failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Could not collect reviews') }, { status: 500 })
  }
}
