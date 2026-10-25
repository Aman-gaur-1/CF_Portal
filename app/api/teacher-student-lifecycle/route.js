import { NextResponse } from 'next/server'
import { appendActivity } from '@/lib/activity-log'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export async function PATCH(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const studentId = String(body?.studentId || '').trim()
    const action = String(body?.action || '').trim().toLowerCase()
    if (!validUuid(studentId)) return jsonNoStore({ error: 'A valid studentId is required.' }, { status: 400 })
    if (action !== 'deactivate') return jsonNoStore({ error: 'Teachers can only deactivate students in their assigned batches.' }, { status: 403 })

    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) return jsonNoStore({ error: 'Student is outside your assigned batch scope.' }, { status: 403 })
    const { data: student, error: lookupError } = await supabase
      .from('students')
      .select('id,name,batch,login_id,status')
      .eq('id', studentId)
      .in('batch', scope.batchNames)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!student) return jsonNoStore({ error: 'Student is outside your assigned batch scope.' }, { status: 403 })

    const { data: updated, error: updateError } = await supabase
      .from('students')
      .update({ status: 'inactive', status_changed_at: new Date().toISOString(), status_changed_by: teacher.name })
      .eq('id', studentId)
      .in('batch', scope.batchNames)
      .select('id,name,batch,login_id,status,status_changed_at')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) return jsonNoStore({ error: 'Student is outside your assigned batch scope.' }, { status: 403 })

    await appendActivity({
      eventType: 'student_deactivated',
      description: `Deactivated student ${student.name} (${student.login_id || student.id}) in ${student.batch}.`,
      actorName: teacher.name,
      actorRole: 'teacher',
      action: 'deactivate',
      metadata: { student_id: student.id, batch: student.batch, status: 'inactive' },
      supabase,
    })
    return jsonNoStore({ success: true, student: updated })
  } catch (err) {
    console.error('[teacher-student-lifecycle] failed', err?.message)
    return jsonNoStore({ error: 'Could not deactivate student.' }, { status: 500 })
  }
}
