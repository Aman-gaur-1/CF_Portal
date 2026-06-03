import { NextResponse } from 'next/server'
import { AI_STATUS } from '@/lib/ai/constants'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'

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
    const draft = sanitizeStudentText(body?.ai_feedback, 8000)
    if (!submissionId || !draft) {
      return jsonNoStore({ error: 'submissionId and ai_feedback are required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    await recoverStaleAiDrafts(supabase, { context: 'teacher-ai-draft-save' })
    const { submission } = await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)
    if (submission.feedback) {
      return jsonNoStore({ error: 'Submission already has approved feedback' }, { status: 409 })
    }
    if (submission.ai_status === AI_STATUS.PROCESSING || submission.ai_status === AI_STATUS.PENDING) {
      return jsonNoStore({ error: 'AI draft is still generating' }, { status: 409 })
    }

    const { error } = await supabase
      .from('submissions')
      .update({
        ai_feedback: draft,
        ai_status: AI_STATUS.READY,
        ai_error: null,
        ai_feedback_at: new Date().toISOString(),
      })
      .eq('id', submissionId)

    if (error) throw new Error(error.message)
    return jsonNoStore({ success: true, ai_feedback: draft, ai_status: AI_STATUS.READY })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-ai-draft] failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not save draft' }, { status })
  }
}
