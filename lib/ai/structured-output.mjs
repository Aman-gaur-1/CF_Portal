import crypto from 'node:crypto'

const NEMOTRON_3_SUPER_MODELS = new Set([
  'nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-super-120b-a12b',
])

/**
 * Nemotron 3 Super enables reasoning by default. For strict JSON evaluation,
 * keep the completion budget for the final JSON instead of reasoning tokens.
 * This is deliberately model-specific and does not change other providers.
 */
export function buildStructuredOutputRequestControls({ model, responseFormat } = {}) {
  const normalizedModel = String(model || '').trim().toLowerCase()
  if (!responseFormat || !NEMOTRON_3_SUPER_MODELS.has(normalizedModel)) return {}

  return {
    chat_template_kwargs: {
      enable_thinking: false,
    },
  }
}

/** Match the evaluator parser's accepted raw, fenced, and wrapped JSON forms. */
export function extractJsonPayload(text) {
  const trimmed = String(text || '').trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

export function looksLikeJsonObject(text) {
  const trimmed = String(text || '').trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

export function inspectStructuredOutput(text) {
  const normalized = String(text || '').trim()
  const payload = extractJsonPayload(normalized)
  const containsJsonFence = /```(?:json)?/i.test(normalized)
  const firstBraceIndex = normalized.indexOf('{')
  const lastBraceIndex = normalized.lastIndexOf('}')
  const metadata = {
    content_shape: 'other',
    content_length: normalized.length,
    starts_with_brace: normalized.startsWith('{'),
    ends_with_brace: normalized.endsWith('}'),
    contains_json_fence: containsJsonFence,
    first_brace_index: firstBraceIndex,
    last_brace_index: lastBraceIndex,
    response_fingerprint: fingerprintStructuredOutput(normalized),
  }

  if (!normalized) return { valid: false, ...metadata, content_shape: 'empty' }

  if (looksLikeJsonObject(payload)) {
    try {
      const parsed = JSON.parse(payload)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          valid: true,
          ...metadata,
          content_shape: containsJsonFence
            ? 'fenced_json'
            : payload === normalized
              ? 'raw_json'
              : 'wrapped_json',
        }
      }
    } catch {
      return { valid: false, ...metadata, content_shape: 'malformed_json' }
    }
    return { valid: false, ...metadata, content_shape: 'malformed_json' }
  }

  if (firstBraceIndex === -1 && !containsJsonFence) {
    return { valid: false, ...metadata, content_shape: 'plain_text' }
  }
  if (firstBraceIndex !== -1 && (lastBraceIndex <= firstBraceIndex || !normalized.endsWith('}'))) {
    return { valid: false, ...metadata, content_shape: 'incomplete_json' }
  }
  return { valid: false, ...metadata }
}

/**
 * Apply at most one caller-supplied recovery request. This helper never chooses
 * a provider or changes request parameters.
 */
export async function recoverStructuredOutput(initialResult, {
  enabled = true,
  canRetry = true,
  getText = result => result?.text,
  retry,
} = {}) {
  if (!enabled) {
    return { valid: true, result: initialResult, inspection: null, structured_retry_count: 0 }
  }

  const initialInspection = inspectStructuredOutput(getText(initialResult))
  if (initialInspection.valid || !canRetry || typeof retry !== 'function') {
    return {
      valid: initialInspection.valid,
      result: initialResult,
      inspection: initialInspection,
      structured_retry_count: 0,
    }
  }

  const retryResult = await retry()
  const retryInspection = inspectStructuredOutput(getText(retryResult))
  return {
    valid: retryInspection.valid,
    result: retryResult,
    inspection: retryInspection,
    structured_retry_count: 1,
  }
}

export function buildAssistantResponseDiagnostics(data, text, requestDiagnostics = {}) {
  const message = data?.choices?.[0]?.message
  const inspection = inspectStructuredOutput(text)
  return {
    http_status: requestDiagnostics.http_status ?? 200,
    response_format_requested: Boolean(requestDiagnostics.response_format_requested),
    response_format_removed_for_retry: Boolean(requestDiagnostics.response_format_removed_for_retry),
    retry_without_response_format: Boolean(requestDiagnostics.retry_without_response_format),
    thinking_disabled: Boolean(requestDiagnostics.thinking_disabled),
    max_tokens_requested: Number.isFinite(requestDiagnostics.max_tokens_requested)
      ? requestDiagnostics.max_tokens_requested
      : null,
    finish_reason: data?.choices?.[0]?.finish_reason ?? null,
    response_top_level_keys: safeObjectKeys(data),
    message_keys: safeObjectKeys(message),
    content_length: inspection.content_length,
    content_shape: inspection.content_shape,
    starts_with_brace: inspection.starts_with_brace,
    ends_with_brace: inspection.ends_with_brace,
    contains_json_fence: inspection.contains_json_fence,
    first_brace_index: inspection.first_brace_index,
    last_brace_index: inspection.last_brace_index,
    reasoning_content_present: hasValue(message?.reasoning_content),
    reasoning_present: hasValue(message?.reasoning),
    refusal_present: hasValue(message?.refusal),
    tool_calls_present: Array.isArray(message?.tool_calls) && message.tool_calls.length > 0,
    response_fingerprint: inspection.response_fingerprint,
  }
}

export function createStructuredOutputContractError({
  responseDiagnostics,
  structuredRetryCount = 0,
  skippedReason = null,
} = {}) {
  const error = new Error('AI structured output contract violation')
  error.code = 'AI_STRUCTURED_OUTPUT_INVALID'
  error.runtimeDiagnostics = {
    structured_retry_count: structuredRetryCount,
    response: {
      ...(responseDiagnostics || {}),
      structured_retry_count: structuredRetryCount,
      structured_retry_skipped_reason: skippedReason,
    },
  }
  return error
}

function fingerprintStructuredOutput(normalizedText) {
  if (!normalizedText) return null
  const normalized = normalizedText.replace(/\s+/g, ' ').trim()
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function safeObjectKeys(value) {
  if (!value || typeof value !== 'object') return []
  return Object.keys(value).filter(key => !key.startsWith('__')).sort()
}

function hasValue(value) {
  if (typeof value === 'string') return Boolean(value.trim())
  return Boolean(value)
}
