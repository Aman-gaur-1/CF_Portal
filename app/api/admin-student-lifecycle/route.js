import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { appendActivity } from '@/lib/activity-log'
import { getSupabaseAdmin } from '@/lib/supabase-server'

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
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const studentId = String(body?.studentId || '').trim()
    const action = String(body?.action || '').trim().toLowerCase()
    if (!validUuid(studentId)) return jsonNoStore({ error: 'A valid studentId is required.' }, { status: 400 })
    if (!['deactivate', 'reactivate'].includes(action)) return jsonNoStore({ error: 'Unsupported student lifecycle action.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data: student, error: lookupError } = await supabase
      .from('students')
      .select('id,name,batch,login_id,status')
      .eq('id', studentId)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!student) return jsonNoStore({ error: 'Student not found.' }, { status: 404 })

    const status = action === 'deactivate' ? 'inactive' : 'active'
    const { data: updated, error: updateError } = await supabase
      .from('students')
      .update({ status, status_changed_at: new Date().toISOString(), status_changed_by: admin.name })
      .eq('id', studentId)
      .select('id,name,batch,login_id,status,status_changed_at')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) return jsonNoStore({ error: 'Student not found.' }, { status: 404 })

    await appendActivity({
      eventType: action === 'deactivate' ? 'student_deactivated' : 'student_reactivated',
      description: `${action === 'deactivate' ? 'Deactivated' : 'Reactivated'} student ${student.name} (${student.login_id || student.id}).`,
      actorName: admin.name,
      actorRole: 'admin',
      action,
      metadata: { student_id: student.id, batch: student.batch, status },
      supabase,
    })
    return jsonNoStore({ success: true, student: updated })
  } catch (err) {
    console.error('[admin-student-lifecycle] patch failed', err?.message)
    return jsonNoStore({ error: 'Could not update student status.' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const studentId = String(body?.studentId || '').trim()
    if (!validUuid(studentId)) return jsonNoStore({ error: 'A valid studentId is required.' }, { status: 400 })
    if (String(body?.confirmation || '') !== 'DELETE') return jsonNoStore({ error: 'Type DELETE to permanently remove this student.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data: student, error: lookupError } = await supabase
      .from('students')
      .select('id,name,batch,login_id,status')
      .eq('id', studentId)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!student) return jsonNoStore({ error: 'Student not found.' }, { status: 404 })

    const { data: result, error: deleteError } = await supabase.rpc('cf_delete_zero_history_student', { p_student_id: studentId })
    if (deleteError) {
      console.error('[admin-student-lifecycle] delete rpc failed', deleteError.message)
      return jsonNoStore({ error: 'Permanent deletion is unavailable until the student lifecycle schema is applied.' }, { status: 503 })
    }
    if (!result?.deleted) {
      if (result?.reason === 'history') {
        return jsonNoStore({
          error: 'This student has historical coursework or attendance records. Deactivate the student instead.',
          dependencies: result.dependencies || {},
        }, { status: 409 })
      }
      return jsonNoStore({ error: 'Student not found.' }, { status: 404 })
    }

    await appendActivity({
      eventType: 'student_permanently_deleted',
      description: `Permanently deleted zero-history student ${student.name} (${student.login_id || student.id}).`,
      actorName: admin.name,
      actorRole: 'admin',
      action: 'permanently_delete',
      metadata: { student_id: student.id, batch: student.batch, status: student.status },
      supabase,
    })
    return jsonNoStore({ success: true, deleted: true, student: { id: student.id, name: student.name, batch: student.batch, login_id: student.login_id } })
  } catch (err) {
    console.error('[admin-student-lifecycle] delete failed', err?.message)
    return jsonNoStore({ error: 'Could not permanently delete student.' }, { status: 500 })
  }
}
