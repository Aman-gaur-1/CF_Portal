import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'
import { ASSIGNMENTS_BUCKET } from '@/lib/assignment-storage'
import { appendActivity } from '@/lib/activity-log'

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

export async function DELETE(request) {
  try {
    noStore()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const submissionId = String(body?.submissionId || '').trim()
    if (!submissionId) return jsonNoStore({ error: 'submissionId is required' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { scoped, submission } = await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)

    const { error: deleteError } = await supabase
      .from('submissions')
      .delete()
      .eq('id', submissionId)
    if (deleteError) throw new Error(deleteError.message)

    if (submission.file_name) {
      const { error: storageError } = await supabase.storage
        .from(ASSIGNMENTS_BUCKET)
        .remove([submission.file_name])
      if (storageError) {
        console.warn('[teacher-submission] storage cleanup failed', {
          submissionId,
          fileName: submission.file_name,
          error: storageError.message,
        })
      }
    }

    await appendActivity({
      eventType: 'teacher_submission_deleted',
      description: `deleted ${submission.topic || 'assignment'} for ${submission.student_name || 'student'}`,
      actorName: scoped.teacherName || teacher.name,
      actorRole: 'teacher',
      supabase,
    })

    return jsonNoStore({ success: true, submissionId })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-submission] delete failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not delete submission' }, { status })
  }
}
