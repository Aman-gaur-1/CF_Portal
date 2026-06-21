import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  return moatJson({
    ok: false,
    deprecated: true,
    resource: 'sync',
    status: 'deprecated',
    message: 'The generic Moat sync stub is deprecated. Use scoped ingestion endpoints such as /api/moat/test-sync until a production sync workflow exists.',
  })
}
