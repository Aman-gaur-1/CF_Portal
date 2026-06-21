import { unstable_noStore as noStore } from 'next/cache'
import { moatJson, moatUnauthorized, requireMoatAdmin, safeMoatErrorMessage } from '@/lib/moat-api'
import { collectReviewsForProfiles, getReviewAutoSyncStatus } from '@/lib/moat/jobs/bulk-review-collection'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function collectionLimit(request) {
  return new URL(request.url).searchParams.get('limit')
}

function isCronAuthorized(request) {
  if (request.headers.get('x-vercel-cron') === '1') return true
  const secret = String(process.env.CRON_SECRET || '').trim()
  const authorization = request.headers.get('authorization') || ''
  return Boolean(secret && authorization === `Bearer ${secret}`)
}

export async function GET(request) {
  noStore()
  if (!isCronAuthorized(request)) return moatUnauthorized()

  try {
    const result = await collectReviewsForProfiles({
      mode: 'daily',
      requestedBy: 'vercel-cron',
      limit: collectionLimit(request),
    })
    return moatJson(result)
  } catch (err) {
    console.error('[moat-daily-sync] cron failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Daily sync failed') }, { status: 500 })
  }
}

export async function POST(request) {
  noStore()
  const admin = requireMoatAdmin(request)
  if (!admin) return moatUnauthorized()

  try {
    const result = await collectReviewsForProfiles({
      mode: 'daily',
      requestedBy: admin.name || 'admin',
      limit: collectionLimit(request),
    })
    return moatJson(result)
  } catch (err) {
    console.error('[moat-daily-sync] manual run failed', err?.message)
    return moatJson({ error: safeMoatErrorMessage(err, 'Daily sync failed') }, { status: 500 })
  }
}

export async function HEAD(request) {
  noStore()
  if (!requireMoatAdmin(request) && !isCronAuthorized(request)) return moatUnauthorized()
  await getReviewAutoSyncStatus()
  return new Response(null, { status: 204 })
}
