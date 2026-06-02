import { NextResponse } from 'next/server'
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/login-rate-limit'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  hashStudentPassword,
  safeStudentProfile,
  validateStudentCredentialsInput,
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
    const rateLimit = consumeLoginAttempt(request, 'student')
    if (!rateLimit.allowed) {
      return jsonNoStore(
        { success: false, error: 'Too many login attempts. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      )
    }

    const input = validateStudentCredentialsInput(await request.json())
    if (input.error) return jsonNoStore({ success: false, error: input.error }, { status: 400 })

    const { name, batch, password } = input.value
    const { data, error } = await getSupabaseAdmin()
      .from('students')
      .select('id,name,batch')
      .ilike('name', name)
      .eq('batch', batch)
      .eq('password_hash', hashStudentPassword(password))
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return jsonNoStore({ success: false, error: 'Invalid name, batch, or password.' }, { status: 401 })

    clearLoginAttempts(request, 'student')
    return jsonNoStore({ success: true, student: safeStudentProfile(data) })
  } catch (err) {
    console.error('[student-login] failed', err?.message)
    return jsonNoStore({ success: false, error: 'Student login is unavailable.' }, { status: 500 })
  }
}
