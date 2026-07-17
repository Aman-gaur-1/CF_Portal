import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope, getTeacherScope } from '@/lib/teacher-scope'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { decorateSubmissionReviewState, deriveReviewStatus } from '@/lib/review-state'
import {
  executeBulkAiApproval,
  fetchBulkApprovalCandidates,
  previewBulkAiApproval,
} from '@/lib/ai/bulk-approval'
import { APPROVAL_METHOD, publishSubmissionFeedback } from '@/lib/submission-publisher'

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

function serializeErrorForLog(err) {
  if (!err) return null
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
    code: err.code,
    details: err.details,
    hint: err.hint,
    status: err.status,
    statusCode: err.statusCode,
    cause: err.cause ? {
      name: err.cause.name,
      message: err.cause.message,
      stack: err.cause.stack,
      code: err.cause.code,
      details: err.cause.details,
      hint: err.cause.hint,
      status: err.cause.status,
      statusCode: err.cause.statusCode,
    } : undefined,
  }
}

function logCompleteException(context, err, { diagnosticId, ...extra } = {}) {
  console.error(`[teacher-feedback] ${context}`, {
    diagnosticId,
    message: err?.message,
    stack: err?.stack,
    cause: err?.cause,
    code: err?.code,
    details: err?.details,
    hint: err?.hint,
    status: err?.status,
    statusCode: err?.statusCode,
    ...extra,
    error: err,
  })
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
    reviewStatusBefore: details.reviewStatusBefore,
    reviewStatusAfter: details.reviewStatusAfter,
    aiStatusBefore: details.aiStatusBefore,
    aiStatusAfter: details.aiStatusAfter,
    error: serializeErrorForLog(details.error),
  }
  console[level](`[teacher-feedback] ${message}`, safeDetails)
}

export async function PATCH(request) {
  noStore()
  const diagnosticId = createDiagnosticId()
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) {
      logPublishDiagnostic('warn', 'unauthorized publish attempt', { diagnosticId })
      return jsonNoStore({ error: 'Unauthorized', diagnosticId }, { status: 401 })
    }

    const body = await request.json()
    const supabase = getSupabaseAdmin()
    if (body?.action === 'bulk_approve_preview') {
      return jsonNoStore({ success: true, ...await previewTeacherFeedback(supabase, teacher.name, { phase: body?.phase }) })
    }

    if (body?.action === 'bulk_approve') {
      return jsonNoStore({ success: true, ...await bulkApproveTeacherFeedback(supabase, teacher.name, { phase: body?.phase }) })
    }

    const submissionId = String(body?.submissionId || '').trim()
    const feedback = sanitizeStudentText(body?.feedback, 8000)
    if (!submissionId || !feedback) {
      return jsonNoStore({ error: 'submissionId and feedback are required', diagnosticId }, { status: 400 })
    }

    const { scoped, submission } = await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)
    const trainerName = scoped.teacherName || teacher.name
    const wasPending = !submission.feedback && !submission.feedback_at
    const reviewStatusBefore = deriveReviewStatus(submission)
    const aiStatusBefore = submission.ai_status || null

    let publishResult
    try {
      publishResult = await publishSubmissionFeedback({
        submissionId,
        feedback,
        actorName: trainerName,
        actorRole: 'teacher',
        approvalMethod: APPROVAL_METHOD.MANUAL,
        submissionType: body?.submission_type,
        phase: body?.phase,
        allowUpdatePublished: !wasPending,
        supabase,
      })
    } catch (err) {
      logCompleteException('publishSubmissionFeedback exception', err, {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
      })
      logPublishDiagnostic('error', 'supabase update failed', {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
        feedbackLength: feedback.length,
        wasPending,
        reviewStatusBefore,
        aiStatusBefore,
        supabaseMessage: err.message,
        error: err,
      })
      throw err
    }

    if (!publishResult.published) {
      logPublishDiagnostic('error', 'supabase update returned no row', {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
        feedbackLength: feedback.length,
        wasPending,
        updateReturnedRow: false,
        verifiedPersisted: Boolean(publishResult.submission?.feedback === feedback && publishResult.submission?.feedback_at),
        reviewStatusBefore,
        reviewStatusAfter: publishResult.submission ? deriveReviewStatus(publishResult.submission) : null,
        aiStatusBefore,
        aiStatusAfter: publishResult.submission?.ai_status || null,
      })
      return jsonNoStore({ error: 'Feedback was not saved. Please refresh and try again.', diagnosticId }, { status: 409 })
    }

    const verified = publishResult.submission

    const persisted = Boolean(
      verified?.id &&
      verified.feedback === feedback &&
      verified.feedback_at &&
      verified.feedback_by === trainerName
    )
    const decoratedSubmission = decorateSubmissionReviewState(verified)
    const reviewStatusAfter = decoratedSubmission?.review_status || null
    const aiStatusAfter = verified?.ai_status || null

    if (!persisted) {
      logPublishDiagnostic('error', 'post-update persistence verification failed', {
        diagnosticId,
        submissionId,
        teacherName: teacher.name,
        feedbackLength: feedback.length,
        wasPending,
        updateReturnedRow: true,
        verifiedPersisted: false,
        reviewStatusBefore,
        reviewStatusAfter,
        aiStatusBefore,
        aiStatusAfter,
      })
      return jsonNoStore({ error: 'Feedback was not confirmed saved. Please refresh and try again.', diagnosticId }, { status: 409 })
    }

    logPublishDiagnostic('info', 'feedback persisted', {
      diagnosticId,
      submissionId,
      teacherName: teacher.name,
      feedbackLength: feedback.length,
      wasPending,
      updateReturnedRow: true,
      verifiedPersisted: true,
      reviewStatusBefore,
      reviewStatusAfter,
      aiStatusBefore,
      aiStatusAfter,
    })

    return jsonNoStore({
      success: true,
      persisted: true,
      diagnosticId,
      submission: decoratedSubmission,
    })
  } catch (err) {
    const status = err?.status || 500
    logCompleteException('PATCH exception', err, { diagnosticId, status })
    logPublishDiagnostic('error', 'failed', {
      diagnosticId,
      supabaseMessage: err?.message,
      error: err,
    })
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not save feedback', diagnosticId }, { status })
  }
}

async function previewTeacherFeedback(supabase, teacherName, { phase = '' } = {}) {
  const scope = await getTeacherScope(supabase, teacherName)
  if (!scope.batchNames.length) return previewBulkAiApproval([])

  const rows = await fetchBulkApprovalCandidates({ supabase, batchNames: scope.batchNames, phase: String(phase || '').trim() })
  return previewBulkAiApproval(rows)
}

async function bulkApproveTeacherFeedback(supabase, teacherName, { phase = '' } = {}) {
  const scope = await getTeacherScope(supabase, teacherName)
  if (!scope.batchNames.length) return previewBulkAiApproval([])

  const selectedPhase = String(phase || '').trim()
  const rows = await fetchBulkApprovalCandidates({ supabase, batchNames: scope.batchNames, phase: selectedPhase })
  return executeBulkAiApproval({
    supabase,
    rows,
    actorName: scope.teacherName || teacherName,
    actorRole: 'teacher',
    batchNames: scope.batchNames,
    phase: selectedPhase,
    audit: { userName: scope.teacherName || teacherName },
  })
}
