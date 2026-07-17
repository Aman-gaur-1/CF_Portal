import { NextResponse } from 'next/server'
import { getDefaultPhaseName, listAssignmentPhases, resolveDefaultPhase } from '@/lib/assignment-phases'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function GET() {
  try {
    const [phases, defaultPhase] = await Promise.all([
      listAssignmentPhases(),
      resolveDefaultPhase(),
    ])

    return jsonNoStore({
      phases,
      defaultPhase,
      defaultPhaseName: defaultPhase?.name || await getDefaultPhaseName(),
    })
  } catch (err) {
    console.error('[assignment-phases] load failed', err?.message)
    return jsonNoStore({ error: 'Could not load assignment phases' }, { status: 500 })
  }
}
