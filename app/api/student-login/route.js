import { NextResponse } from 'next/server'
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/login-rate-limit'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  createStudentToken,
  createStudentRefreshToken,
  hashStudentPasswordSecure,
  safeStudentProfile,
  validateStudentCredentialsInput,
  verifyStudentPassword,
  STUDENT_REFRESH_COOKIE,
  STUDENT_REFRESH_TTL_MS,
} from '@/lib/student-auth'

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

export async function POST(request) {
  try {
    const rateLimit = await consumeLoginAttempt(request, 'student')
    if (!rateLimit.allowed) {
      return jsonNoStore(
        { success: false, error: 'Too many login attempts. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      )
    }

    const input = validateStudentCredentialsInput(await request.json())
    if (input.error) return jsonNoStore({ success: false, error: input.error }, { status: 400 })

    const { name, batch, password } = input.value
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('students')
      .select('id,name,batch,password_hash')
      .ilike('name', name)
      .eq('batch', batch)
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    const passwordResult = await verifyStudentPassword(password, data?.password_hash)
    if (!data || !passwordResult.ok) {
      return jsonNoStore({ success: false, error: 'Invalid name, batch, or password.' }, { status: 401 })
    }

    if (passwordResult.needsUpgrade) {
      const { error: upgradeError } = await supabase
        .from('students')
        .update({ password_hash: await hashStudentPasswordSecure(password) })
        .eq('id', data.id)
      if (upgradeError) console.warn('[student-login] password hash upgrade failed', upgradeError.message)
    }

    await clearLoginAttempts(request, 'student')
    const response = jsonNoStore({
      success: true,
      student: {
        ...safeStudentProfile(data),
        token: createStudentToken(data),
      },
    })
    response.cookies.set(STUDENT_REFRESH_COOKIE, createStudentRefreshToken(data), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(STUDENT_REFRESH_TTL_MS / 1000),
    })
    return response
  } catch (err) {
    console.error('[student-login] failed', err?.message)
    return jsonNoStore({ success: false, error: 'Student login is unavailable.' }, { status: 500 })
  }
}
