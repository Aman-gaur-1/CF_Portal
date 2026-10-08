import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  createStudentRefreshToken,
  createStudentToken,
  safeStudentProfile,
  STUDENT_REFRESH_COOKIE,
  STUDENT_REFRESH_TTL_MS,
  verifyLegacyStudentTokenForRefresh,
  verifyStudentRefreshToken,
  verifyStudentToken,
} from '@/lib/student-auth'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

function setRefreshCookie(response, student) {
  response.cookies.set(STUDENT_REFRESH_COOKIE, createStudentRefreshToken(student), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(STUDENT_REFRESH_TTL_MS / 1000),
  })
}

async function loadCurrentStudent(identity) {
  if (!identity) return null
  const { data, error } = await getSupabaseAdmin()
    .from('students')
    .select('id,name,batch')
    .eq('id', identity.id)
    .eq('name', identity.name)
    .eq('batch', identity.batch)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

export async function POST(request) {
  try {
    const refreshIdentity = verifyStudentRefreshToken(request.cookies.get(STUDENT_REFRESH_COOKIE)?.value)
    const authorization = request.headers.get('authorization') || ''
    const bearer = authorization.replace(/^Bearer\s+/i, '').trim()
    const bearerIdentity = refreshIdentity ? null : (verifyStudentToken(bearer) || verifyLegacyStudentTokenForRefresh(bearer))
    const student = await loadCurrentStudent(refreshIdentity || bearerIdentity)
    if (!student) return jsonNoStore({ success: false, error: 'Student session is invalid' }, { status: 401 })

    const response = jsonNoStore({
      success: true,
      student: { ...safeStudentProfile(student), token: createStudentToken(student) },
    })
    setRefreshCookie(response, student)
    return response
  } catch (error) {
    console.error('[student-session] refresh failed', error?.message)
    return jsonNoStore({ success: false, error: 'Student session is unavailable' }, { status: 500 })
  }
}

export async function DELETE() {
  const response = jsonNoStore({ success: true })
  response.cookies.set(STUDENT_REFRESH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
