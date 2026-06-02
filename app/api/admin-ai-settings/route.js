import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import {
  listAiProviderSettings,
  deleteAiProviderSetting,
  getAiProviderHealth,
  getAiProviderRuntimeState,
  setActiveAiProviderSetting,
  upsertAiProviderSetting,
} from '@/lib/ai/provider-settings'

function unauthorized() {
  return NextResponse.json({ error: 'Admin authorization required' }, { status: 401 })
}

export async function GET(request) {
  if (!getAdminFromRequest(request)) return unauthorized()

  try {
    const settings = await listAiProviderSettings()
    const runtime = await getAiProviderRuntimeState()
    const health = await getAiProviderHealth()
    return NextResponse.json({ settings, runtime, health })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Could not load AI provider settings' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!getAdminFromRequest(request)) return unauthorized()

  try {
    const body = await request.json()
    const action = body?.action || 'save'

    if (action === 'set_active') {
      const setting = await setActiveAiProviderSetting(body?.id)
      return NextResponse.json({ setting })
    }

    if (action === 'delete') {
      const deleted = await deleteAiProviderSetting(body?.id)
      return NextResponse.json({ deleted })
    }

    const setting = await upsertAiProviderSetting(body)
    return NextResponse.json({ setting })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Could not save AI provider setting' }, { status: 400 })
  }
}
