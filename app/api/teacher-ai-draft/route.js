import { NextResponse } from 'next/server'
import { AI_STATUS } from '@/lib/ai/constants'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'
import { isReviewedSubmission } from '@/lib/review-state'
import { scheduleAutoApprovalIfEligible } from '@/lib/auto-approval'
import { appendActivity } from '@/lib/activity-log'
import { AI_WORKFLOW_STATE } from '@/lib/ai/workflow-state'

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
    if (isReviewedSubmission(submission)) {
      return jsonNoStore({ error: 'Submission already has approved feedback' }, { status: 409 })
    }
    if (submission.ai_status === AI_STATUS.PROCESSING || submission.ai_status === AI_STATUS.PENDING) {
      return jsonNoStore({ error: 'AI draft is still generating' }, { status: 409 })
    }

    const { data: updatedRows, error } = await supabase
      .from('submissions')
      .update({
        ai_feedback: draft,
        ai_status: AI_STATUS.READY,
        ai_workflow_state: AI_WORKFLOW_STATE.DRAFT_READY,
        ai_error: null,
        ai_failure_reason: null,
        ai_feedback_at: new Date().toISOString(),
      })
      .eq('id', submissionId)
      .is('feedback', null)
      .is('feedback_at', null)
      .is('approval_at', null)
      .is('approved_at', null)
      .select('id')

    if (error) throw new Error(error.message)
    if (!updatedRows?.length) {
      return jsonNoStore({ error: 'Submission already has approved feedback' }, { status: 409 })
    }
    await scheduleAutoApprovalIfEligible(submissionId, { supabase }).catch(err => {
      console.warn('[teacher-ai-draft] auto approval scheduling failed', { submissionId, error: err?.message })
    })
    await appendActivity({
      eventType: 'ai_draft_trainer_edited',
      description: `trainer edited AI draft for ${submission.topic || 'assignment'}`,
      actorName: teacher.name,
      actorRole: 'teacher',
      supabase,
    })
    return jsonNoStore({ success: true, ai_feedback: draft, ai_status: AI_STATUS.READY })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-ai-draft] failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not save draft' }, { status })
  }
}
