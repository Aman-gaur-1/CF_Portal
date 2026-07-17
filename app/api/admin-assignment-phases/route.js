import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import {
  createAssignmentPhase,
  listAssignmentPhases,
  resolveDefaultPhase,
  setDefaultPhase,
  updateAssignmentPhase,
} from '@/lib/assignment-phases'

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

function unauthorized() {
  return jsonNoStore({ error: 'Admin authorization required' }, { status: 401 })
}

export async function GET(request) {
  try {
    if (!getAdminFromRequest(request)) return unauthorized()
    const [phases, defaultPhase] = await Promise.all([
      listAssignmentPhases({ includeInactive: true }),
      resolveDefaultPhase(),
    ])
    return jsonNoStore({ phases, defaultPhase })
  } catch (err) {
    console.error('[admin-assignment-phases] load failed', err?.message)
    return jsonNoStore({ error: 'Could not load assignment phases' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    if (!getAdminFromRequest(request)) return unauthorized()
    const body = await request.json().catch(() => ({}))
    const phase = await createAssignmentPhase(body)
    if (body.defaultPhase === true) await setDefaultPhase(phase.slug)
    const defaultPhase = await resolveDefaultPhase()
    return jsonNoStore({ phase, defaultPhase }, { status: 201 })
  } catch (err) {
    console.error('[admin-assignment-phases] create failed', err?.message)
    return jsonNoStore({ error: err?.message || 'Could not create assignment phase' }, { status: 400 })
  }
}

export async function PATCH(request) {
  try {
    if (!getAdminFromRequest(request)) return unauthorized()
    const body = await request.json().catch(() => ({}))

    if (body.action === 'default_phase') {
      const defaultPhase = await setDefaultPhase(body.slug)
      return jsonNoStore({ defaultPhase })
    }

    const phase = await updateAssignmentPhase(body.id, body)
    const defaultPhase = body.defaultPhase === true ? await setDefaultPhase(phase.slug) : await resolveDefaultPhase()
    return jsonNoStore({ phase, defaultPhase })
  } catch (err) {
    console.error('[admin-assignment-phases] update failed', err?.message)
    return jsonNoStore({ error: err?.message || 'Could not update assignment phase' }, { status: 400 })
  }
}
