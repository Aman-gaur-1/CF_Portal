import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'

export function moatJson(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export function moatUnauthorized() {
  return moatJson({ error: 'Admin authorization required' }, { status: 401 })
}

export function requireMoatAdmin(request) {
  return getAdminFromRequest(request)
}

export function safeMoatErrorMessage(error, fallback = 'Moat request failed') {
  const tokenValues = [
    process.env.APIFY_TOKEN,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.ADMIN_SESSION_SECRET,
  ].filter(Boolean)
  let message = String(error?.message || fallback)
  tokenValues.forEach(value => {
    message = message.replaceAll(String(value), '[redacted]')
  })
  return message || fallback
}
