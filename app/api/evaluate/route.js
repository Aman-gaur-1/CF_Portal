import { NextResponse } from 'next/server'
import { evaluateSubmission } from '@/lib/ai/orchestrator'
import { AI_STATUS } from '@/lib/ai/constants'
import { guardEvaluateRequest } from '@/lib/ai/api-guard'

export const maxDuration = 55

export async function POST(req) {
  try {
    let body = {}
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const guard = guardEvaluateRequest(req, body)
    if (guard.error) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const result = await evaluateSubmission(guard.submissionId)

    if (result.status === AI_STATUS.FAILED) {
      const status = result.error === 'Submission not found' ? 404 : 500
      return NextResponse.json({ error: result.error, status: result.status }, { status })
    }

    if (result.status === AI_STATUS.PROCESSING) {
      return NextResponse.json(result, { status: 202 })
    }

    return NextResponse.json({
      status: result.status,
      draft: result.draft,
      ai_feedback: result.ai_feedback,
    })
  } catch (err) {
    console.error('[evaluate] unexpected error', err?.message)
    return NextResponse.json({ error: 'Evaluation failed', status: AI_STATUS.FAILED }, { status: 500 })
  }
}
