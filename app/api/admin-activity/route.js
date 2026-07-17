import { NextResponse } from 'next/server'
import { appendActivity, loadActivityTimelines, loadRecentActivity } from '@/lib/activity-log'
import { getAdminFromRequest } from '@/lib/admin-auth'

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

export async function GET(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const params = request.nextUrl.searchParams
    const mode = params.get('mode') || 'recent'
    const filters = {
      date: params.get('date') || '',
      actor: params.get('actor') || '',
      role: params.get('role') || '',
      search: params.get('search') || '',
    }
    const limit = mode === 'log' ? 500 : 20
    const [activity, timelines] = await Promise.all([
      loadRecentActivity({ limit, filters }),
      mode === 'log' ? loadActivityTimelines({ limit: 150 }) : Promise.resolve([]),
    ])
    return jsonNoStore({ success: true, activity, timelines })
  } catch (err) {
    console.error('[admin-activity] load failed', err?.message)
    return jsonNoStore({ error: 'Could not load recent activity' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const teacherName = String(body?.teacherName || '').trim()
    if (!teacherName) return jsonNoStore({ error: 'teacherName is required' }, { status: 400 })

    const descriptions = {
      teacher_created: `created teacher ${teacherName}`,
      teacher_deactivated: `deactivated teacher ${teacherName}`,
    }
    const description = descriptions[body?.eventType]
    if (!description) return jsonNoStore({ error: 'Unsupported activity event' }, { status: 400 })

    await appendActivity({
      eventType: body.eventType,
      description,
      actorName: admin.name,
      actorRole: 'admin',
    })
    return jsonNoStore({ success: true })
  } catch (err) {
    console.error('[admin-activity] append failed', err?.message)
    return jsonNoStore({ error: 'Could not record activity' }, { status: 500 })
  }
}
