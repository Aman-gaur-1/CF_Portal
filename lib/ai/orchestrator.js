import { debugLog } from '@/lib/logger'
import crypto from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  AI_EVALUATION_SCHEMA_VERSION,
  AI_EVALUATION_TIMEOUT_MS,
  AI_MAX_CONCURRENT_EVALUATIONS,
  AI_STATUS,
  DEFAULT_GEMINI_MODEL,
} from './constants'
import { extractSubmissionForEvaluation } from './extract'
import { retrieveContext } from './retrieve'
import { buildEvaluationPrompt } from './prompt'
import { generateWithGemini } from './gemini'
import { parseEvaluationResponse } from './parse'
import { extractSafeStudentFirstName, sanitizeSubmissionFields } from './sanitize'
import { claimSubmissionForEvaluation } from './claim-evaluation'
import { recordGenerationResult } from './runtime-state'
import { appendActivity } from '@/lib/activity-log'
import { countPythonCodeCharacters } from './code-signals'
import { scheduleAutoApprovalIfEligible } from '@/lib/auto-approval'
import { selectFinalEvaluationPhase, shouldSkipAiEvaluation } from '@/lib/assignment-analysis'
import { AI_WORKFLOW_STATE, classifyAiFailureReason } from '@/lib/ai/workflow-state'

const activeEvaluations = globalThis.__cfActiveAiEvaluations || new Set()
globalThis.__cfActiveAiEvaluations = activeEvaluations

/**
 * Run the full AI evaluation pipeline for one submission.
 * @returns {{ status: string, draft?: string, evaluation?: object, error?: string }}
 */
export async function evaluateSubmission(submissionId, options = {}) {
  if (!submissionId) {
    return { status: AI_STATUS.FAILED, error: 'submissionId is required' }
  }

  debugLog('[evaluate] start', { submissionId })
  const supabase = getSupabaseAdmin()
  const releaseSlot = acquireEvaluationSlot(submissionId)
  if (!releaseSlot) {
    console.warn('[evaluate] concurrency limit reached', {
      submissionId,
      active: activeEvaluations.size,
      limit: evaluationConcurrencyLimit(),
    })
    return { status: AI_STATUS.PROCESSING, message: 'AI generation is busy. Please retry shortly.' }
  }

  let submission = null
  let startedAt = Date.now()
  try {
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

    submission = sanitizeSubmissionFields(claim.submission)

    startedAt = Date.now()
    const { text: submissionText, diagnostics: parserDiagnostics } =
      await extractSubmissionForEvaluation(submission, supabase)

    const skipEvaluation = shouldSkipAiEvaluation(parserDiagnostics)
    if (skipEvaluation.skip) {
      const err = new Error(skipEvaluation.message)
      err.publicMessage = skipEvaluation.message
      throw err
    }

    const detectedLanguage = parserDiagnostics?.detected_language || parserDiagnostics?.structured_assignment?.detected_language || null
    const detectedPhase = parserDiagnostics?.detected_phase || parserDiagnostics?.structured_assignment?.detected_phase || null
    const detectionConfidence = parserDiagnostics?.detection_confidence ?? parserDiagnostics?.structured_assignment?.detection_confidence ?? 0
    const detectedAssignmentType = parserDiagnostics?.structured_assignment?.assignment_type || null
    const phaseDecision = selectFinalEvaluationPhase({
      selectedPhase: submission.phase,
      detectedPhase,
      detectionConfidence,
    })
    const evaluationSubmission = {
      ...submission,
      selected_phase: submission.phase || null,
      phase: phaseDecision.final_evaluation_phase,
      final_evaluation_phase: phaseDecision.final_evaluation_phase,
    }

    const { chunks, ragVersion, diagnostics: retrievalDiagnostics } = await retrieveContext(supabase, {
      phase: phaseDecision.final_evaluation_phase,
      topic: submission.topic,
    })

    debugLog('[evaluate] context ready', {
      submissionId,
      extractedTopic: submission.topic || null,
      selectedPhase: phaseDecision.selected_phase,
      finalEvaluationPhase: phaseDecision.final_evaluation_phase,
      detectedPhase,
      detectionConfidence,
      normalizedTopic: retrievalDiagnostics?.normalized_topic || null,
      canonicalTopic: retrievalDiagnostics?.canonical_topic || null,
      matchedCurriculumTopic: retrievalDiagnostics?.matched_curriculum_topic || null,
      fallbackReason: retrievalDiagnostics?.fallback_reason || null,
      retrievedChunks: retrievalDiagnostics?.chunk_titles || [],
      parser: parserDiagnostics?.parser,
      parserSupported: parserDiagnostics?.supported,
      extractionMethod: parserDiagnostics?.extraction_method || null,
      extractionQuality: parserDiagnostics?.extraction_quality || null,
      extractionConfidence: parserDiagnostics?.extraction_confidence || null,
      extractionScore: parserDiagnostics?.extraction_score ?? null,
      extractedCodeChars: parserDiagnostics?.extracted_code_characters ?? null,
      commentedCodeChars: parserDiagnostics?.commented_code_characters ?? null,
      assignmentAnswerChars: parserDiagnostics?.assignment_answer_characters ?? null,
      codeSignalMatches: parserDiagnostics?.code_signal_matches || [],
      commentedCodeMatches: parserDiagnostics?.commented_code_matches || [],
      usabilityReasons: parserDiagnostics?.usability_reasons || [],
      ocrTriggered: Boolean(parserDiagnostics?.ocr_triggered),
      ocrSkippedReason: parserDiagnostics?.ocr_skipped_reason || null,
      ocrChars: parserDiagnostics?.ocr_characters || 0,
      extractedChars: submissionText?.length || 0,
      selectedChunks: retrievalDiagnostics?.selected_chunks || 0,
      topicChunks: retrievalDiagnostics?.topic_specific_chunks || 0,
    })
    debugLog('[evaluate] submission text handoff', {
      submissionId,
      parser: parserDiagnostics?.parser || null,
      finalTextLength: submissionText?.length || 0,
      finalCodeLength: parserDiagnostics?.extracted_code_characters ?? countCodeCharacters(submissionText),
      finalCommentedCodeLength: parserDiagnostics?.commented_code_characters ?? 0,
      finalAssignmentAnswerLength: parserDiagnostics?.assignment_answer_characters ?? 0,
      lowQuality: Boolean(parserDiagnostics?.low_quality),
      quality: parserDiagnostics?.extraction_quality || null,
      confidence: parserDiagnostics?.extraction_confidence || null,
      usabilityReasons: parserDiagnostics?.usability_reasons || [],
    })

    const personalizedFirstName = shouldPersonalizeFeedback()
      ? extractSafeStudentFirstName(submission.student_name)
      : ''

    const prompt = buildEvaluationPrompt({
      submission: evaluationSubmission,
      submissionText,
      chunks,
      parserDiagnostics,
      retrievalDiagnostics,
      personalizedFirstName,
    })

    const timeoutBudgetMs = Math.max(5_000, Math.min(48_000, AI_EVALUATION_TIMEOUT_MS - (Date.now() - startedAt)))
    const {
      text: rawAiText,
      model,
      provider,
      provider_id,
      fallback_used,
      fallback_from,
      retry_count,
      structured_retry_count,
      response_diagnostics,
      provider_source,
      provider_resolution_source,
      provider_infrastructure,
      final_provider_used,
    } = await withProcessingDurationSafeguard(generateWithGemini(prompt, { timeoutBudgetMs }), {
      submissionId,
      startedAt,
      timeoutMs: timeoutBudgetMs,
    })
    debugLog('[evaluate] AI response success', {
      submissionId,
      model,
      provider: final_provider_used || provider,
      fallback_used,
      retry_count,
      structured_retry_count,
      responseChars: rawAiText?.length || 0,
      durationMs: Date.now() - startedAt,
    })
    const { evaluation, draft } = parseEvaluationResponse(rawAiText, {
      parserDiagnostics,
      submissionText,
    })

    if (!draft?.trim()) {
      throw new Error('AI returned empty feedback')
    }

    const completedAt = new Date().toISOString()
    const phaseDetectionWarning = phaseDecision.detected_phase !== 'Unknown' && phaseDecision.detected_phase !== phaseDecision.selected_phase
    const enrichedEvaluation = {
      ...evaluation,
      schema_version: evaluation.schema_version || AI_EVALUATION_SCHEMA_VERSION,
      // Internal structured diagnostics live in ai_evaluation. The reviewer still
      // receives ai_feedback as editable plain text, preserving approval flow.
      diagnostics: {
        ...(evaluation.diagnostics || {}),
        parser: parserDiagnostics,
        retrieval: retrievalDiagnostics,
        assignment_phase: {
          selected_phase: phaseDecision.selected_phase,
          selected: phaseDecision.selected_phase,
          detected_language: detectedLanguage,
          detected_phase: detectedPhase,
          confidence: phaseDecision.confidence,
          confidence_percent: phaseDecision.confidence_percent,
          final_evaluation_phase: phaseDecision.final_evaluation_phase,
          overridden: phaseDecision.overridden,
          reason: phaseDecision.reason,
          mismatch: phaseDetectionWarning,
          assignment_type: detectedAssignmentType,
        },
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
          structured_retry_count: structured_retry_count || 0,
          response: response_diagnostics || null,
        },
      },
    }

    const { data: completedRows, error: updateError } = await supabase
      .from('submissions')
      .update({
        ai_status: AI_STATUS.READY,
        ai_workflow_state: AI_WORKFLOW_STATE.DRAFT_READY,
        ai_feedback: draft,
        ai_evaluation: enrichedEvaluation,
        submission_text: submissionText || null,
        ai_error: null,
        ai_failure_reason: null,
        ai_last_duration_ms: Date.now() - startedAt,
        ai_model: model || DEFAULT_GEMINI_MODEL,
        ai_rag_version: ragVersion,
        ai_feedback_at: completedAt,
        detected_assignment_language: detectedLanguage,
        detected_assignment_phase: detectedPhase,
        detected_assignment_type: detectedAssignmentType,
        final_evaluation_phase: phaseDecision.final_evaluation_phase,
        phase_detection_warning: phaseDetectionWarning,
      })
      .eq('id', submissionId)
      .eq('ai_status', AI_STATUS.PROCESSING)
      .select('id, ai_status, ai_feedback')

    if (updateError) {
      console.error('[evaluate] completion update failed', submissionId, updateError.message)
      throw new Error(updateError.message)
    }

    if (completedRows?.length && (!completedRows[0]?.ai_feedback || completedRows[0]?.ai_status !== AI_STATUS.READY)) {
      console.error('[evaluate] completion update did not persist AI draft', { submissionId })
      throw new Error('AI draft could not be saved. Please retry generation.')
    }

    if (!completedRows?.length) {
      // Race condition: stale recovery may have reset status. Force update anyway since AI succeeded.
      console.warn('[evaluate] completion skipped race - forcing status update', { submissionId })
      const { data: forceRows, error: forceError } = await supabase
        .from('submissions')
        .update({
          ai_status: AI_STATUS.READY,
          ai_workflow_state: AI_WORKFLOW_STATE.DRAFT_READY,
          ai_feedback: draft,
          ai_evaluation: enrichedEvaluation,
          submission_text: submissionText || null,
          ai_error: null,
          ai_failure_reason: null,
          ai_last_duration_ms: Date.now() - startedAt,
          ai_model: model || DEFAULT_GEMINI_MODEL,
          ai_rag_version: ragVersion,
          ai_feedback_at: completedAt,
          detected_assignment_language: detectedLanguage,
          detected_assignment_phase: detectedPhase,
          detected_assignment_type: detectedAssignmentType,
          final_evaluation_phase: phaseDecision.final_evaluation_phase,
          phase_detection_warning: phaseDetectionWarning,
        })
        .eq('id', submissionId)
        .is('feedback', null)
        .select('id, ai_status, ai_feedback')

      if (forceError) {
        console.error('[evaluate] force update also failed', submissionId, forceError.message)
        return { status: AI_STATUS.FAILED, error: 'AI draft was already reset. Please retry generation.' }
      }
      if (!forceRows?.length) {
        console.error('[evaluate] force update matched no rows', { submissionId })
        return { status: AI_STATUS.FAILED, error: 'AI draft could not be saved. Please retry generation.' }
      }
      if (!forceRows[0]?.ai_feedback || forceRows[0]?.ai_status !== AI_STATUS.READY) {
        console.error('[evaluate] force update did not persist AI draft', { submissionId })
        return { status: AI_STATUS.FAILED, error: 'AI draft could not be saved. Please retry generation.' }
      }
      debugLog('[evaluate] force update succeeded', { submissionId })
    }

    debugLog('[evaluate] ai_status transition', {
      submissionId,
      from: AI_STATUS.PROCESSING,
      to: AI_STATUS.READY,
    })

    try {
      await scheduleAutoApprovalIfEligible(submissionId, { supabase, now: new Date(completedAt) })
    } catch (err) {
      console.warn('[evaluate] auto approval scheduling failed', { submissionId, error: err?.message })
    }

    debugLog('[evaluate] completed', {
      submissionId,
      score: enrichedEvaluation.score,
      confidence: enrichedEvaluation.confidence,
      flags: enrichedEvaluation.flags || [],
      durationMs: enrichedEvaluation.diagnostics.evaluation_ms,
      fallback_used: Boolean(fallback_used),
      provider: final_provider_used || provider || null,
    })
    recordGenerationResult({
      durationMs: enrichedEvaluation.diagnostics.evaluation_ms,
      fallbackUsed: Boolean(fallback_used),
      retryCount: retry_count || 0,
      status: AI_STATUS.READY,
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
    recordGenerationResult({
      durationMs: null,
      fallbackUsed: Boolean(err?.runtimeDiagnostics?.attempts?.length > 1),
      retryCount: 0,
      status: AI_STATUS.FAILED,
    })

    const { data: failedRows, error: failureUpdateError } = await supabase
      .from('submissions')
      .update({
        ai_status: AI_STATUS.FAILED,
        ai_workflow_state: AI_WORKFLOW_STATE.FAILED,
        ai_error: message,
        ai_failure_reason: classifyAiFailureReason(message, err?.runtimeDiagnostics),
        ai_last_duration_ms: startedAt ? Date.now() - startedAt : null,
        auto_approval_due_at: null,
        ...(err?.runtimeDiagnostics ? { ai_evaluation: buildProviderFailureEvaluation(err.runtimeDiagnostics) } : {}),
      })
      .eq('id', submissionId)
      .eq('ai_status', AI_STATUS.PROCESSING)
      .is('ai_feedback', null)
      .select('id')

    if (failureUpdateError) {
      console.error('[evaluate] failure update failed', { submissionId, error: failureUpdateError.message })
    }

    if (!failedRows?.length) {
      const { data: preservedRows, error: preserveError } = await supabase
        .from('submissions')
        .update({
          ai_status: AI_STATUS.READY,
          ai_workflow_state: AI_WORKFLOW_STATE.DRAFT_READY,
          ai_error: null,
          ai_failure_reason: null,
        })
        .eq('id', submissionId)
        .not('ai_feedback', 'is', null)
        .select('id, ai_feedback')

      if (preserveError) {
        console.error('[evaluate] existing AI draft preserve failed', { submissionId, error: preserveError.message })
      } else if (preservedRows?.length) {
        debugLog('[evaluate] preserved existing AI draft after regenerate failure', { submissionId })
        const preservedDraft = preservedRows[0]?.ai_feedback || submission?.ai_feedback || ''
        try {
          await scheduleAutoApprovalIfEligible(submissionId, { supabase })
        } catch (scheduleErr) {
          console.warn('[evaluate] auto approval scheduling failed for preserved draft', {
            submissionId,
            error: scheduleErr?.message,
          })
        }
        return {
          status: AI_STATUS.READY,
          draft: preservedDraft,
          ai_feedback: preservedDraft,
          error: message,
        }
      }
    }

    debugLog('[evaluate] ai_status transition', {
      submissionId,
      from: AI_STATUS.PROCESSING,
      to: AI_STATUS.FAILED,
      applied: Boolean(failedRows?.length),
    })

    await appendActivity({
      eventType: 'ai_draft_failed',
      description: `draft failed for ${submission?.topic || 'assignment'}`,
      actorName: 'AI',
      actorRole: 'system',
      supabase,
    })

    return { status: AI_STATUS.FAILED, error: message }
  } finally {
    releaseSlot()
  }
}

function countCodeCharacters(text) {
  return countPythonCodeCharacters(text)
}

export function getAiEvaluationLoad() {
  return {
    active: activeEvaluations.size,
    limit: evaluationConcurrencyLimit(),
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
        retry_count: runtimeDiagnostics?.provider_retry_count || finalAttempt.retry_count || 0,
        structured_retry_count: runtimeDiagnostics?.structured_retry_count || finalAttempt.structured_retry_count || 0,
        response: runtimeDiagnostics?.response || finalAttempt.response || null,
        timeout_ms: runtimeDiagnostics?.timeout_ms || null,
        elapsed_ms: runtimeDiagnostics?.elapsed_ms || null,
      },
    },
  }
}

function evaluationConcurrencyLimit() {
  const configured = Number.parseInt(process.env.AI_MAX_CONCURRENT_EVALUATIONS || '', 10)
  if (Number.isFinite(configured) && configured >= 1) return Math.min(configured, 5)
  return AI_MAX_CONCURRENT_EVALUATIONS
}

function acquireEvaluationSlot(submissionId) {
  const key = String(submissionId)
  if (activeEvaluations.has(key)) return null
  if (activeEvaluations.size >= evaluationConcurrencyLimit()) return null
  activeEvaluations.add(key)
  return () => activeEvaluations.delete(key)
}

async function withProcessingDurationSafeguard(promise, { submissionId, startedAt, timeoutMs }) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const elapsedMs = Date.now() - startedAt
          const err = new Error(`AI processing timed out after ${elapsedMs}ms`)
          err.status = 504
          err.runtimeDiagnostics = {
            trace_id: null,
            attempts: [],
            final_provider_attempted: null,
            final_failure_reason: 'processing_duration_timeout',
            final_failure_classification: 'timeout',
            timeout_ms: timeoutMs,
            elapsed_ms: elapsedMs,
          }
          console.error('[evaluate] processing duration timeout', {
            submissionId,
            elapsedMs,
            timeoutMs,
          })
          reject(err)
        }, Math.min(timeoutMs, 48_000))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function shouldPersonalizeFeedback() {
  return crypto.randomInt(100) < 35
}

/** Avoid leaking API keys or raw stack traces to clients. */
function sanitizePublicError(message) {
  const text = String(message || 'Evaluation failed')
  if (/api[_\s-]?key/i.test(text)) return 'AI service configuration error'
  if (/provider|timed out|timeout|rate limit|quota|resourceexhausted|503|429|fetch failed|network|connection/i.test(text)) {
    return 'AI service is temporarily unavailable. Please try again shortly.'
  }
  if (text.length > 280) return `${text.slice(0, 280)}...`
  return text
}

function classifyEvaluationFailureLayer(err) {
  const message = String(err?.message || '')
  if (err?.runtimeDiagnostics) return 'provider'
  if (/parse|json|schema|feedback|evaluation/i.test(message)) return 'parser'
  if (/submission|claim|status|supabase|database/i.test(message)) return 'orchestration'
  return 'unknown'
}
