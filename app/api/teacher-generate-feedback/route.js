import { NextResponse } from 'next/server'
import { AI_STATUS } from '@/lib/ai/constants'
import { evaluateSubmission } from '@/lib/ai/orchestrator'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'

export const maxDuration = 60

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
    const result = await evaluateSubmission(submissionId)

    if (result.status === AI_STATUS.FAILED) {
      return jsonNoStore({ error: result.error || 'AI generation failed', status: result.status }, { status: 500 })
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
      message: 'AI draft ready.',
    })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-generate-feedback] failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'AI generation failed' }, { status })
  }
}
