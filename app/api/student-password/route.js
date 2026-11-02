import { NextResponse } from 'next/server'
import { appendActivity } from '@/lib/activity-log'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  createStudentRefreshToken,
  createStudentToken,
  getStudentFromRequest,
  hashStudentPasswordSecure,
  safeStudentProfile,
  STUDENT_REFRESH_COOKIE,
  STUDENT_REFRESH_TTL_MS,
} from '@/lib/student-auth'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
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

export async function PATCH(request) {
  try {
    const identity = getStudentFromRequest(request, { allowPasswordChangeRequired: true })
    if (!identity?.must_change_password) return jsonNoStore({ error: 'A temporary-password session is required.' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const password = String(body.password || '').trim()
    const confirmation = String(body.confirmation || '').trim()
    if (password.length < 8) return jsonNoStore({ error: 'New password must be at least 8 characters.' }, { status: 400 })
    if (password.length > 200) return jsonNoStore({ error: 'New password is too long.' }, { status: 400 })
    if (password !== confirmation) return jsonNoStore({ error: 'Passwords do not match.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data: student, error: loadError } = await supabase
      .from('students')
      .select('id,name,batch,login_id,must_change_password,status')
      .eq('id', identity.id)
      .eq('status', 'active')
      .maybeSingle()
    if (loadError) throw loadError
    if (!student) return jsonNoStore({ error: 'Student account is unavailable.' }, { status: 403 })
    if (!student.must_change_password) return jsonNoStore({ error: 'Password change is no longer required.' }, { status: 409 })

    const { data: updated, error: updateError } = await supabase
      .from('students')
      .update({ password_hash: await hashStudentPasswordSecure(password), must_change_password: false })
      .eq('id', student.id)
      .eq('must_change_password', true)
      .select('id,name,batch,login_id,must_change_password,status')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) return jsonNoStore({ error: 'Password change is no longer required.' }, { status: 409 })

    await appendActivity({
      eventType: 'student_initial_password_changed',
      description: `Student ${updated.name} completed the required first-login password change.`,
      actorName: updated.name,
      actorRole: 'student',
      action: 'change_initial_password',
      metadata: { student_id: updated.id, batch: updated.batch },
      supabase,
    })

    const response = jsonNoStore({
      success: true,
      student: { ...safeStudentProfile(updated), token: createStudentToken(updated) },
    })
    setRefreshCookie(response, updated)
    return response
  } catch (error) {
    console.error('[student-password] failed', error?.message)
    return jsonNoStore({ error: 'Could not change the password.' }, { status: 500 })
  }
}
