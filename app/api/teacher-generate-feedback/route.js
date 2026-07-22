import { NextResponse } from 'next/server'
import { AI_STATUS } from '@/lib/ai/constants'
import { evaluateSubmission } from '@/lib/ai/orchestrator'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'
import { appendActivity } from '@/lib/activity-log'
import { classifyAiFailureReason } from '@/lib/ai/workflow-state'

export const maxDuration = 55

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function POST(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const submissionId = String(body?.submissionId || '').trim()
    if (!submissionId) return jsonNoStore({ error: 'Valid submissionId is required' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { scoped, submission } = await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)
    const actionName = submission.ai_status === AI_STATUS.FAILED ? 'retry' : submission.ai_feedback ? 'regenerate' : 'generate'
    await appendActivity({
      eventType: `ai_draft_${actionName}_requested`,
      description: `${actionName} requested for ${submission.topic || 'assignment'}`,
      actorName: scoped.teacherName || teacher.name,
      actorRole: 'teacher',
      supabase,
    })
    const result = await evaluateSubmission(submissionId)

    if (result.status === AI_STATUS.FAILED) {
      return jsonNoStore({
        error: result.error || 'AI generation failed',
        status: result.status,
        failure_reason: classifyAiFailureReason(result.error),
      }, { status: 500 })
    }
    if (result.status === AI_STATUS.PROCESSING) {
      return jsonNoStore({
        status: result.status,
        message: result.message || 'AI generation is already in progress.',
      }, { status: 202 })
    }

    return jsonNoStore({
      status: result.status,
      draft: result.draft,
      ai_feedback: result.ai_feedback,
      ai_score: normalizeAiScore(result.evaluation?.score),
      ai_assignment_diagnostics: result.evaluation?.diagnostics?.assignment_phase || null,
      message: 'AI draft ready.',
    })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-generate-feedback] failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'AI generation failed' }, { status })
  }
}

function normalizeAiScore(score) {
  const value = Number(score)
  return Number.isFinite(value) ? value : null
}
