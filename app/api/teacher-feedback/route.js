import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
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

export async function PATCH(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const submissionId = String(body?.submissionId || '').trim()
    const feedback = sanitizeStudentText(body?.feedback, 8000)
    if (!submissionId || !feedback) {
      return jsonNoStore({ error: 'submissionId and feedback are required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { submission } = await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)

    const update = {
      feedback,
      feedback_by: teacher.name,
      feedback_at: new Date().toISOString(),
      review_active_by: null,
      review_active_at: null,
    }
    if (body?.submission_type) update.submission_type = String(body.submission_type)
    if (body?.phase) update.phase = String(body.phase)

    const { error } = await supabase.from('submissions').update(update).eq('id', submissionId)
    if (error) throw new Error(error.message)

    const topic = submission.topic || 'assignment'
    const approvedAiDraft = Boolean(submission.ai_feedback)
    await appendActivity({
      eventType: approvedAiDraft ? 'review_approved' : 'manual_feedback_submitted',
      description: approvedAiDraft ? `approved ${topic}` : `submitted manual feedback for ${topic}`,
      actorName: teacher.name,
      actorRole: 'teacher',
      supabase,
    })

    return jsonNoStore({ success: true })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-feedback] failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not save feedback' }, { status })
  }
}
