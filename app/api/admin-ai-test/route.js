import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { testAiProviderConnection } from '@/lib/ai/gemini'
import { recordProviderTestResult, sanitizeProviderConfig } from '@/lib/ai/provider-settings'

function unauthorized() {
  return NextResponse.json({ error: 'Admin authorization required' }, { status: 401 })
}

export async function POST(request) {
  if (!getAdminFromRequest(request)) return unauthorized()

  try {
    const body = await request.json()
    const config = {
      ...sanitizeProviderConfig(body),
      id: body?.id || null,
      api_key: typeof body?.api_key === 'string' ? body.api_key : '',
    }
    const result = await testAiProviderConnection(config)
    if (config.id) {
      result.setting = await recordProviderTestResult(config.id, result)
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'AI provider test failed' },
      { status: 500 }
    )
  }
}
