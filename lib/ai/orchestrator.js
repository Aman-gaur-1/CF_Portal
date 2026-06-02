import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { AI_EVALUATION_SCHEMA_VERSION, AI_STATUS, DEFAULT_GEMINI_MODEL } from './constants'
import { extractSubmissionForEvaluation } from './extract'
import { retrieveContext } from './retrieve'
import { buildEvaluationPrompt } from './prompt'
import { generateWithGemini } from './gemini'
import { parseEvaluationResponse } from './parse'
import { extractSafeStudentFirstName, sanitizeSubmissionFields } from './sanitize'
import { claimSubmissionForEvaluation } from './claim-evaluation'
import { appendActivity } from '@/lib/activity-log'

/**
 * Run the full AI evaluation pipeline for one submission.
 * @returns {{ status: string, draft?: string, evaluation?: object, error?: string }}
 */
export async function evaluateSubmission(submissionId, options = {}) {
  if (!submissionId) {
    return { status: AI_STATUS.FAILED, error: 'submissionId is required' }
  }

  console.info('[evaluate] start', { submissionId })
  const supabase = getSupabaseAdmin()

  const claim = await claimSubmissionForEvaluation(supabase, submissionId, {
    allowRegenerate: options.allowRegenerate !== false,
  })

  if (claim.notFound) {
    return { status: AI_STATUS.FAILED, error: 'Submission not found' }
  }

  if (!claim.claimed) {
    if (claim.inProgress) {
      return { status: AI_STATUS.PROCESSING, message: 'Evaluation already in progress' }
    }
    return { status: AI_STATUS.FAILED, error: 'Submission is not eligible for evaluation' }
  }

  const submission = sanitizeSubmissionFields(claim.submission)

  try {
    const startedAt = Date.now()
    const { text: submissionText, diagnostics: parserDiagnostics } =
      await extractSubmissionForEvaluation(submission, supabase)

    const { chunks, ragVersion, diagnostics: retrievalDiagnostics } = await retrieveContext(supabase, {
      phase: submission.phase,
      topic: submission.topic,
    })

    console.info('[evaluate] context ready', {
      submissionId,
      parser: parserDiagnostics?.parser,
      parserSupported: parserDiagnostics?.supported,
      extractedChars: submissionText?.length || 0,
      selectedChunks: retrievalDiagnostics?.selected_chunks || 0,
      topicChunks: retrievalDiagnostics?.topic_specific_chunks || 0,
    })

    const personalizedFirstName = shouldPersonalizeFeedback()
      ? extractSafeStudentFirstName(submission.student_name)
      : ''

    const prompt = buildEvaluationPrompt({
      submission,
      submissionText,
      chunks,
      parserDiagnostics,
      retrievalDiagnostics,
      personalizedFirstName,
    })

    const {
      text: rawAiText,
      model,
      provider,
      provider_id,
      fallback_used,
      fallback_from,
      retry_count,
      provider_source,
      provider_resolution_source,
      provider_infrastructure,
      final_provider_used,
    } = await generateWithGemini(prompt)
    console.info('[evaluate] AI response success', {
      submissionId,
      model,
      provider: final_provider_used || provider,
      fallback_used,
      responseChars: rawAiText?.length || 0,
    })
    const { evaluation, draft } = parseEvaluationResponse(rawAiText)

    if (!draft?.trim()) {
      throw new Error('AI returned empty feedback')
    }

    const completedAt = new Date().toISOString()
    const enrichedEvaluation = {
      ...evaluation,
      schema_version: evaluation.schema_version || AI_EVALUATION_SCHEMA_VERSION,
      // Internal structured diagnostics live in ai_evaluation. The reviewer still
      // receives ai_feedback as editable plain text, preserving approval flow.
      diagnostics: {
        ...(evaluation.diagnostics || {}),
        parser: parserDiagnostics,
        retrieval: retrievalDiagnostics,
        evaluation_ms: Date.now() - startedAt,
        ai_provider: {
          provider: provider || null,
          final_provider_used: final_provider_used || provider || null,
          provider_id: provider_id || null,
          provider_source: provider_source || null,
          provider_resolution_source: provider_resolution_source || null,
          infrastructure: provider_infrastructure || null,
          fallback_used: Boolean(fallback_used),
          fallback_from: fallback_from || [],
          retry_count: retry_count || 0,
        },
      },
    }

    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        ai_status: AI_STATUS.READY,
        ai_feedback: draft,
        ai_evaluation: enrichedEvaluation,
        submission_text: submissionText || null,
        ai_error: null,
        ai_model: model || DEFAULT_GEMINI_MODEL,
        ai_rag_version: ragVersion,
        ai_feedback_at: completedAt,
      })
      .eq('id', submissionId)
      .eq('ai_status', AI_STATUS.PROCESSING)

    if (updateError) {
      console.error('[evaluate] completion update failed', submissionId, updateError.message)
      throw new Error(updateError.message)
    }

    console.info('[evaluate] ai_status transition', {
      submissionId,
      from: AI_STATUS.PROCESSING,
      to: AI_STATUS.READY,
    })

    console.info('[evaluate] completed', {
      submissionId,
      score: enrichedEvaluation.score,
      confidence: enrichedEvaluation.confidence,
      flags: enrichedEvaluation.flags || [],
      durationMs: enrichedEvaluation.diagnostics.evaluation_ms,
    })

    const topic = submission.topic || 'assignment'
    await appendActivity({
      eventType: 'ai_draft_generated',
      description: `draft generated for ${topic}`,
      actorName: 'AI',
      actorRole: 'system',
      supabase,
    })
    if (fallback_used) {
      await appendActivity({
        eventType: 'ai_fallback_used',
        description: `fallback used (${[...(fallback_from || []), final_provider_used || provider].join(' -> ')})`,
        actorName: 'AI',
        actorRole: 'system',
        supabase,
      })
    }

    return {
      status: AI_STATUS.READY,
      draft,
      ai_feedback: draft,
      evaluation: enrichedEvaluation,
    }
  } catch (err) {
    const message = sanitizePublicError(err?.message || 'Evaluation failed')
    console.error('[evaluate] AI response failure', {
      submissionId,
      error: err?.message,
      runtimeDiagnostics: err?.runtimeDiagnostics || null,
      failureLayer: classifyEvaluationFailureLayer(err),
    })

    await supabase
      .from('submissions')
      .update({
        ai_status: AI_STATUS.FAILED,
        ai_error: message,
        ...(err?.runtimeDiagnostics ? { ai_evaluation: buildProviderFailureEvaluation(err.runtimeDiagnostics) } : {}),
      })
      .eq('id', submissionId)
      .eq('ai_status', AI_STATUS.PROCESSING)

    console.info('[evaluate] ai_status transition', {
      submissionId,
      from: AI_STATUS.PROCESSING,
      to: AI_STATUS.FAILED,
    })

    await appendActivity({
      eventType: 'ai_draft_failed',
      description: `draft failed for ${submission.topic || 'assignment'}`,
      actorName: 'AI',
      actorRole: 'system',
      supabase,
    })

    return { status: AI_STATUS.FAILED, error: message }
  }
}

function buildProviderFailureEvaluation(runtimeDiagnostics) {
  const attempts = Array.isArray(runtimeDiagnostics?.attempts) ? runtimeDiagnostics.attempts : []
  const finalAttempt = attempts.at(-1) || {}
  const finalProvider = runtimeDiagnostics?.final_provider_attempted || finalAttempt.provider || null
  const attemptedProviders = [...new Set(attempts.map(attempt => attempt?.provider).filter(Boolean))]

  return {
    schema_version: AI_EVALUATION_SCHEMA_VERSION,
    diagnostics: {
      ai_provider: {
        provider: finalProvider,
        final_provider_attempted: finalProvider,
        model: finalAttempt.model || null,
        provider_id: finalAttempt.provider_id || null,
        fallback_used: attemptedProviders.length > 1,
        fallback_from: attemptedProviders.slice(0, -1),
        attempts,
        trace_id: runtimeDiagnostics?.trace_id || null,
        failure_reason: runtimeDiagnostics?.final_failure_reason || null,
        failure_classification: runtimeDiagnostics?.final_failure_classification || null,
      },
    },
  }
}

function shouldPersonalizeFeedback() {
  return crypto.randomInt(100) < 35
}

/** Avoid leaking API keys or raw stack traces to clients. */
function sanitizePublicError(message) {
  const text = String(message || 'Evaluation failed')
  if (/api[_\s-]?key/i.test(text)) return 'AI service configuration error'
  if (/provider|timeout|rate limit|quota|resourceexhausted|503|429|fetch failed|network|connection/i.test(text)) {
    return 'AI service is temporarily unavailable. Please try again shortly.'
  }
  if (text.length > 280) return `${text.slice(0, 280)}…`
  return text
}

function classifyEvaluationFailureLayer(err) {
  const message = String(err?.message || '')
  if (err?.runtimeDiagnostics) return 'provider'
  if (/parse|json|schema|feedback|evaluation/i.test(message)) return 'parser'
  if (/submission|claim|status|supabase|database/i.test(message)) return 'orchestration'
  return 'unknown'
}
