import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { hashStudentPassword, normalizeStudentName } from '@/lib/student-auth'
import { appendActivity } from '@/lib/activity-log'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function PATCH(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const studentId = String(body?.studentId || '').trim()
    const password = String(body?.password || '').trim()
    const name = normalizeStudentName(body?.name)
    if (!studentId) return jsonNoStore({ error: 'studentId is required' }, { status: 400 })
    if (!isUuid(studentId)) return jsonNoStore({ error: 'Invalid studentId.' }, { status: 400 })
    if (name && name.length > 120) return jsonNoStore({ error: 'Student name is too long.' }, { status: 400 })
    if (password && password.length < 4) return jsonNoStore({ error: 'Password must be at least 4 characters.' }, { status: 400 })
    if (password.length > 200) return jsonNoStore({ error: 'Password is too long.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) return jsonNoStore({ error: 'Student is outside this teacher scope' }, { status: 403 })

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id,name,batch')
      .eq('id', studentId)
      .in('batch', scope.batchNames)
      .maybeSingle()

    if (studentError) throw new Error(studentError.message)
    if (!student) return jsonNoStore({ error: 'Student is outside this teacher scope' }, { status: 403 })

    const update = {}
    if (name) update.name = name
    if (password) update.password_hash = hashStudentPassword(password)
    if (!Object.keys(update).length) return jsonNoStore({ error: 'Nothing to update.' }, { status: 400 })

    const { data: updatedStudent, error } = await supabase
      .from('students')
      .update(update)
      .eq('id', studentId)
      .select('id,name,batch,created_at')
      .single()
    if (error) throw new Error(error.message)

    if (name && name !== student.name) {
      const { error: submissionNameError } = await supabase
        .from('submissions')
        .update({ student_name: name })
        .eq('student_id', studentId)
        .in('batch', scope.batchNames)
      if (submissionNameError) throw new Error(submissionNameError.message)
    }

    await appendActivity({
      eventType: 'teacher_student_profile_updated',
      description: `updated ${updatedStudent.name}`,
      actorName: scope.teacherName || teacher.name,
      actorRole: 'teacher',
      supabase,
    })

    return jsonNoStore({ success: true, student: updatedStudent })
  } catch (err) {
    console.error('[teacher-student-password] failed', err?.message)
    return jsonNoStore({ error: 'Could not update student profile' }, { status: 500 })
  }
}
