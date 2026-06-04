import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
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

function createDiagnosticId() {
  return `tf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function logPublishDiagnostic(level, message, details) {
  const safeDetails = {
    diagnosticId: details.diagnosticId,
    submissionId: details.submissionId,
    teacherName: details.teacherName,
    feedbackLength: details.feedbackLength,
    wasPending: details.wasPending,
    updateReturnedRow: details.updateReturnedRow,
    verifiedPersisted: details.verifiedPersisted,
    supabaseCode: details.supabaseCode,
    supabaseMessage: details.supabaseMessage,
  }
  console[level](`[teacher-feedback] ${message}`, safeDetails)
}

export async function PATCH(request) {
  const diagnosticId = createDiagnosticId()
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) {
      logPublishDiagnostic('warn', 'unauthorized publish attempt', { diagnosticId })
      return jsonNoStore({ error: 'Unauthorized', diagnosticId }, { status: 401 })
    }

    const body = await request.json()
    const submissionId = String(body?.submissionId || '').trim()
    const feedback = sanitizeStudentText(body?.feedback, 8000)
    if (!submissionId || !feedback) {
      return jsonNoStore({ error: 'submissionId and feedback are required', diagnosticId }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { submission } = await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)
    const wasPending = !submission.feedback && !submission.feedback_at

    const feedbackAt = new Date().toISOString()
    const update = {
      feedback,
      feedback_by: teacher.name,
      feedback_at: feedbackAt,
      review_active_by: null,
      review_active_at: null,
    }
    if (body?.submission_type) update.submission_type = String(body.submission_type)
    if (body?.phase) update.phase = String(body.phase)

    const { data: updated, error } = await supabase
      .from('submissions')
      .update(update)
      .eq('id', submissionId)
      .select('id, feedback, feedback_at, feedback_by, submission_type, phase')
      .maybeSingle()
    if (error) {
      logPublishDiagnostic('error', 'supabase update failed', {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
        feedbackLength: feedback.length,
        wasPending,
        supabaseCode: error.code,
        supabaseMessage: error.message,
      })
      throw new Error(error.message)
    }

    if (!updated) {
      const { data: current, error: verifyError } = await supabase
        .from('submissions')
        .select('id, feedback, feedback_at, feedback_by')
        .eq('id', submissionId)
        .maybeSingle()
      if (verifyError) throw new Error(verifyError.message)

      logPublishDiagnostic('error', 'supabase update returned no row', {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
        feedbackLength: feedback.length,
        wasPending,
        updateReturnedRow: false,
        verifiedPersisted: Boolean(current?.feedback === feedback && current?.feedback_at),
      })
      return jsonNoStore({ error: 'Feedback was not saved. Please refresh and try again.', diagnosticId }, { status: 409 })
    }

    const { data: verified, error: verifyError } = await supabase
      .from('submissions')
      .select('id, feedback, feedback_at, feedback_by, submission_type, phase')
      .eq('id', submissionId)
      .maybeSingle()
    if (verifyError) throw new Error(verifyError.message)

    const persisted = Boolean(
      verified?.id &&
      verified.feedback === feedback &&
      verified.feedback_at &&
      verified.feedback_by === teacher.name
    )

    if (!persisted) {
      logPublishDiagnostic('error', 'post-update persistence verification failed', {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
        feedbackLength: feedback.length,
        wasPending,
        updateReturnedRow: true,
        verifiedPersisted: false,
      })
      return jsonNoStore({ error: 'Feedback was not confirmed saved. Please refresh and try again.', diagnosticId }, { status: 409 })
    }

    const topic = submission.topic || 'assignment'
    const approvedAiDraft = Boolean(submission.ai_feedback)
    try {
      await appendActivity({
        eventType: approvedAiDraft ? 'review_approved' : 'manual_feedback_submitted',
        description: approvedAiDraft ? `approved ${topic}` : `submitted manual feedback for ${topic}`,
        actorName: teacher.name,
        actorRole: 'teacher',
        supabase,
      })
    } catch (err) {
      logPublishDiagnostic('warn', 'activity log append failed after feedback persisted', {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
        feedbackLength: feedback.length,
        wasPending,
        updateReturnedRow: true,
        verifiedPersisted: true,
        supabaseMessage: err?.message,
      })
    }

    logPublishDiagnostic('info', 'feedback persisted', {
      diagnosticId,
      submissionId,
      teacherName: teacher.name,
      feedbackLength: feedback.length,
      wasPending,
      updateReturnedRow: true,
      verifiedPersisted: true,
    })

    return jsonNoStore({
      success: true,
      persisted: true,
      diagnosticId,
      submission: {
        id: verified.id,
        feedback: verified.feedback,
        feedback_at: verified.feedback_at,
        feedback_by: verified.feedback_by,
        submission_type: verified.submission_type,
        phase: verified.phase,
      },
    })
  } catch (err) {
    const status = err?.status || 500
    logPublishDiagnostic('error', 'failed', {
      diagnosticId,
      supabaseMessage: err?.message,
    })
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not save feedback', diagnosticId }, { status })
  }
}
