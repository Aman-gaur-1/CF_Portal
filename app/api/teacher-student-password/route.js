import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { hashStudentPassword } from '@/lib/student-auth'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function PATCH(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const studentId = String(body?.studentId || '').trim()
    const password = String(body?.password || '').trim()
    if (!studentId) return jsonNoStore({ error: 'studentId is required' }, { status: 400 })
    if (password.length < 4) return jsonNoStore({ error: 'Password must be at least 4 characters.' }, { status: 400 })
    if (password.length > 200) return jsonNoStore({ error: 'Password is too long.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) return jsonNoStore({ error: 'Student is outside this teacher scope' }, { status: 403 })

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id')
      .eq('id', studentId)
      .in('batch', scope.batchNames)
      .maybeSingle()

    if (studentError) throw new Error(studentError.message)
    if (!student) return jsonNoStore({ error: 'Student is outside this teacher scope' }, { status: 403 })

    const { error } = await supabase
      .from('students')
      .update({ password_hash: hashStudentPassword(password) })
      .eq('id', studentId)
    if (error) throw new Error(error.message)

    return jsonNoStore({ success: true })
  } catch (err) {
    console.error('[teacher-student-password] failed', err?.message)
    return jsonNoStore({ error: 'Could not change student password' }, { status: 500 })
  }
}
