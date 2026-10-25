import { NextResponse } from 'next/server'
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/login-rate-limit'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  createStudentToken,
  createStudentRefreshToken,
  hashStudentPasswordSecure,
  safeStudentProfile,
  validateStudentLoginInput,
  verifyStudentPassword,
  escapeStudentNameForIlike,
  resolveLegacyStudentCandidates,
  STUDENT_REFRESH_COOKIE,
  STUDENT_REFRESH_TTL_MS,
} from '@/lib/student-auth'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'

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

async function findLegacyStudent(supabase, selectFields, name, batch) {
  const { data, error } = await supabase
    .from('students')
    .select(selectFields)
    .eq('batch', batch)
    .ilike('name', escapeStudentNameForIlike(name))
    .limit(2)

  if (error) return { error, status: null, student: null }
  const resolution = resolveLegacyStudentCandidates(data, { name, batch })
  return { error: null, ...resolution }
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

    const input = validateStudentLoginInput(await request.json())
    if (input.error) return jsonNoStore({ success: false, error: input.error }, { status: 400 })

    const { name, loginId, batch, password } = input.value
    const supabase = getSupabaseAdmin()
    let data = null
    let error = null
    let legacyResolution = null

    if (loginId) {
      ({ data, error } = await supabase
        .from('students')
        .select('id,name,batch,password_hash,login_id,must_change_password,status')
        .eq('login_id', loginId)
        .limit(1)
        .maybeSingle())
    } else {
      legacyResolution = await findLegacyStudent(
        supabase,
        'id,name,batch,password_hash,login_id,must_change_password,status',
        name,
        batch
      )
      data = legacyResolution.student
      error = legacyResolution.error
    }

    if (error && isMissingHealthCardSchema(error)) {
      if (loginId) {
        return jsonNoStore({ success: false, error: 'Roster login is not configured yet.' }, { status: 503 });
      }
      legacyResolution = await findLegacyStudent(supabase, 'id,name,batch,password_hash', name, batch)
      data = legacyResolution.student
      error = legacyResolution.error
    }

    if (error) throw new Error(error.message)
    if (legacyResolution?.status === 'ambiguous') {
      return jsonNoStore(
        { success: false, error: 'Legacy login is unavailable for duplicate names in this batch. Use your Login ID or contact an administrator.' },
        { status: 409 }
      )
    }
    const passwordResult = await verifyStudentPassword(password, data?.password_hash)
    if (!data || !passwordResult.ok) {
      return jsonNoStore({ success: false, error: 'Invalid Login ID or password.' }, { status: 401 })
    }
    if (data.status === 'inactive') {
      return jsonNoStore({ success: false, error: 'Your student account is inactive. Please contact your trainer or administrator.' }, { status: 403 })
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
        legacyLogin: !loginId,
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
