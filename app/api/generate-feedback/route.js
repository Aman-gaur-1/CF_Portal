import { NextResponse } from 'next/server'
import { evaluateSubmission } from '@/lib/ai/orchestrator'
import { AI_STATUS } from '@/lib/ai/constants'
import { guardEvaluateRequest } from '@/lib/ai/api-guard'
import { authorizeEvaluationRequest } from '@/lib/ai/evaluation-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const maxDuration = 55

/**
 * Legacy endpoint — delegates to the shared evaluation orchestrator.
 */
export async function POST(req) {
    try {
    let body = {}
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

        // Validate submissionId presence and basic format
        let submissionId = body?.submissionId
    
        // Handle different ID formats
        if (submissionId === null || submissionId === undefined) {
          return NextResponse.json({ error: 'Valid submissionId is required' }, { status: 400 })
        }
    
        // Convert to string if needed
        submissionId = String(submissionId).trim()
    
        // Basic validation
        if (submissionId.length === 0) {
          return NextResponse.json({ error: 'Valid submissionId is required' }, { status: 400 })
        }

    const guard = await guardEvaluateRequest(req, body)
    if (guard.error) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const auth = await authorizeEvaluationRequest(req, guard.submissionId, getSupabaseAdmin())
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const result = await evaluateSubmission(guard.submissionId)

    if (result.status === AI_STATUS.FAILED) {
      const status = result.error === 'Submission not found' ? 404 : 500
      return NextResponse.json(
        { error: result.error || 'AI generation failed', status: result.status },
        { status }
      )
    }

    if (result.status === AI_STATUS.PROCESSING) {
      return NextResponse.json(
        { status: result.status, message: result.message },
        { status: 202 }
      )
    }

    return NextResponse.json({
      draft: result.draft,
      ai_feedback: result.ai_feedback,
      status: result.status,
    })
  } catch (err) {
    console.error('[generate-feedback] unexpected error', err?.message)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
