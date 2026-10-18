import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { hashStudentPasswordSecure } from '@/lib/student-auth'
import { generateTemporaryPassword } from '@/lib/roster-import'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const studentId = String(body.studentId || '').trim()
    if (!studentId) return jsonNoStore({ error: 'studentId is required.' }, { status: 400 })
    const supabase = getSupabaseAdmin()
    const { data: student, error: loadError } = await supabase.from('students').select('id,name,batch,login_id').eq('id', studentId).maybeSingle()
    if (loadError) throw loadError
    if (!student) return jsonNoStore({ error: 'Student not found.' }, { status: 404 })
    const temporaryPassword = generateTemporaryPassword()
    const { error } = await supabase.from('students').update({ password_hash: await hashStudentPasswordSecure(temporaryPassword), must_change_password: true }).eq('id', student.id)
    if (error) throw error
    return jsonNoStore({ success: true, credential: { name: student.name, batch: student.batch, loginId: student.login_id || null, temporaryPassword } })
  } catch (error) {
    console.error('[admin-student-credentials] failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Roster credential fields are not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not regenerate the temporary password.' }, { status: 500 })
  }
}
