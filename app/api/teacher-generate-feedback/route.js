import { NextResponse } from 'next/server'
import { AI_SINGLE_QUEUE_LIMIT, AI_STATUS } from '@/lib/ai/constants'
import { evaluateSubmission, getAiEvaluationLoad } from '@/lib/ai/orchestrator'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'

export const maxDuration = 60

const queuedSingleGenerations = globalThis.__cfQueuedSingleAiGenerations || new Map()
globalThis.__cfQueuedSingleAiGenerations = queuedSingleGenerations

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
    await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)

    if (queuedSingleGenerations.has(submissionId)) {
      return jsonNoStore({
        status: AI_STATUS.PENDING,
        message: 'AI draft is already queued.',
        queue: queueSnapshot(),
      }, { status: 202 })
    }

    if (queuedSingleGenerations.size >= singleQueueLimit()) {
      return jsonNoStore({
        status: AI_STATUS.PROCESSING,
        message: 'AI queue is busy. Please try again shortly.',
        queue: queueSnapshot(),
      }, { status: 202 })
    }

    const queuedAt = new Date().toISOString()
    const { data: queuedRows, error: queueError } = await supabase
      .from('submissions')
      .update({
        ai_status: AI_STATUS.PENDING,
        ai_error: 'AI draft queued.',
        ai_feedback_at: queuedAt,
      })
      .eq('id', submissionId)
      .is('feedback', null)
      .or(`ai_status.is.null,ai_status.in.(${AI_STATUS.PENDING},${AI_STATUS.FAILED},${AI_STATUS.READY})`)
      .select('id, ai_status')

    if (queueError) throw new Error(queueError.message)

    if (!queuedRows?.length) {
      return jsonNoStore({
        status: AI_STATUS.PROCESSING,
        message: 'AI draft is already generating or not eligible.',
        queue: queueSnapshot(),
      }, { status: 202 })
    }

    queuedSingleGenerations.set(submissionId, { queuedAt, teacher: teacher.name })
    setTimeout(() => {
      evaluateSubmission(submissionId)
        .catch(err => console.error('[teacher-generate-feedback] queued generation failed', {
          submissionId,
          error: err?.message,
        }))
        .finally(() => queuedSingleGenerations.delete(submissionId))
    }, queueDelayMs())

    return jsonNoStore({
      status: AI_STATUS.PENDING,
      message: 'AI draft queued. You can keep reviewing while it generates.',
      queue: queueSnapshot(),
    }, { status: 202 })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-generate-feedback] failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'AI generation failed' }, { status })
  }
}

function queueSnapshot() {
  return {
    queued: queuedSingleGenerations.size,
    ...getAiEvaluationLoad(),
  }
}

function singleQueueLimit() {
  const configured = Number.parseInt(process.env.AI_SINGLE_QUEUE_LIMIT || '', 10)
  if (Number.isFinite(configured) && configured >= 1) return Math.min(configured, 50)
  return AI_SINGLE_QUEUE_LIMIT
}

function queueDelayMs() {
  const load = getAiEvaluationLoad()
  return Math.min(2_000, Math.max(150, load.active * 500))
}
