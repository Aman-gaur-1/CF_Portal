import { debugLog } from '@/lib/logger'
import {
  AI_PROVIDER_TIMEOUT_SAFETY_MS,
  AI_PROVIDER_TIMEOUTS_MS,
  AI_REQUEST_TIMEOUT_MS,
  AI_RETRY_COOLDOWN_MS,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_FALLBACKS,
} from './constants'
import diagnosticsChannel from 'diagnostics_channel'
import {
  getActiveAiProviderConfig,
  getProviderApiKey,
  getSecretProviderSetting,
  sanitizeProviderConfig,
} from './provider-settings'
import {
  classifyProviderFailure,
  isFailoverEligibleError,
  resolveProviderOrder,
} from './provider-manager'
import { recordProviderLatency } from './runtime-state'
import {
  buildAssistantResponseDiagnostics,
  buildStructuredOutputRequestControls,
  createStructuredOutputContractError,
  recoverStructuredOutput,
} from './structured-output.mjs'

let fetchDiagnosticsInstalled = false

function resolveModelCandidates(preferred, providerConfig) {
  const fromConfig = providerConfig?.model?.trim()
  const prefersNamespace = prefersNvidiaNamespace(providerConfig)
  const ordered = [preferred, fromConfig, process.env.AI_MODEL?.trim(), DEFAULT_AI_MODEL, ...GEMINI_MODEL_FALLBACKS]
    .filter(Boolean)
    .flatMap(modelName => {
      const namespaced = withNvidiaNamespace(modelName, providerConfig)
      if (prefersNamespace && namespaced) return [namespaced]
      return [modelName, namespaced]
    })
    .filter(Boolean)
  return [...new Set(ordered)]
}

/**
 * Provider request layer for NVIDIA's OpenAI-compatible Qwen chat completions API.
 *
 * The legacy export name is retained so the orchestrator and AI workflow remain unchanged.
 */
export async function generateWithGemini(prompt, { model, responseFormat = 'json_object', timeoutBudgetMs } = {}) {
  const traceId = createTraceId()
  const providers = await resolveProviderOrder()
  const errors = []
  let totalRetries = 0
  const startedAt = Date.now()

  if (!providers.length) {
    throw new Error('No usable AI provider is configured for the selected generation mode')
  }

  debugLog('[ai-provider] resolution', {
    trace_id: traceId,
    provider_count: providers.length,
    order: providers.map((provider, index) => ({
      provider: provider.provider,
      provider_id: provider.id || null,
      role: index === 0 ? 'primary' : `backup_${index}`,
      priority: provider.priority,
      source: provider.resolution_source || provider.source || 'unknown',
      infrastructure: provider.infrastructure || null,
    })),
  })

  for (let providerIndex = 0; providerIndex < providers.length; providerIndex++) {
    const providerConfig = providers[providerIndex]
    let apiKeyInfo
    try {
      apiKeyInfo = await getProviderApiKey(providerConfig)
    } catch (err) {
      errors.push({ provider: providerConfig.provider, message: err?.message })
      if (providerIndex < providers.length - 1) continue
      throw new Error('AI service configuration error')
    }

    if (!apiKeyInfo.apiKey) {
      errors.push({ provider: providerConfig.provider, message: `Missing ${apiKeyInfo.keyName || 'AI provider API key'}` })
      if (providerIndex < providers.length - 1) continue
      throw new Error(`Missing ${apiKeyInfo.keyName || 'AI provider API key'}`)
    }

    try {
      const result = await generateWithProviderRetries({
        traceId,
        prompt,
        model,
        responseFormat,
        providerConfig,
        apiKey: apiKeyInfo.apiKey,
        timeoutBudgetMs: remainingTimeoutBudget(timeoutBudgetMs, startedAt),
      })
      return {
        ...result,
        provider: providerConfig.provider,
        final_provider_used: providerConfig.provider,
        provider_id: providerConfig.id || null,
        fallback_used: providerIndex > 0,
        fallback_from: providerIndex > 0 ? providers.slice(0, providerIndex).map(item => item.provider) : [],
        retry_count: totalRetries + result.retry_count,
        provider_source: providerConfig.source || apiKeyInfo.source || 'db',
        provider_resolution_source: providerConfig.resolution_source || providerConfig.source || 'db',
        provider_infrastructure: providerConfig.infrastructure || null,
        runtime_trace_id: traceId,
      }
    } catch (err) {
      recordProviderLatency({
        provider: providerConfig.provider,
        model: providerConfig.model,
        elapsedMs: err?.elapsedMs,
        status: err?.status,
        classification: classifyProviderFailure(err),
      })
      totalRetries += err.retry_count || 0
      const structuredDiagnostics = err?.runtimeDiagnostics || {}
      errors.push({
        provider: providerConfig.provider,
        provider_id: providerConfig.id || null,
        priority: providerConfig.priority,
        base_url: providerConfig.base_url,
        model: providerConfig.model,
        status: err?.status || null,
        timeout_ms: err?.timeoutMs || null,
        elapsed_ms: err?.elapsedMs || null,
        message: sanitizeLogMessage(err?.message),
        classification: classifyProviderFailure(err),
        failover_eligible: isFailoverEligibleError(err),
        retry_count: err.retry_count || 0,
        structured_retry_count: structuredDiagnostics.structured_retry_count || 0,
        response: structuredDiagnostics.response || null,
      })

      if (!isFailoverEligibleError(err) || providerIndex === providers.length - 1) {
        console.error('[ai-provider] generation failed', {
          trace_id: traceId,
          final_provider_attempted: providerConfig.provider,
          classification: classifyProviderFailure(err),
          failover_eligible: isFailoverEligibleError(err),
          attempts: errors,
        })
        const finalError = new Error(formatAiError(err))
        finalError.code = err?.code
        finalError.runtimeDiagnostics = {
          ...structuredDiagnostics,
          trace_id: traceId,
          attempts: errors,
          final_provider_attempted: providerConfig.provider,
          final_provider: providerConfig.provider,
          fallback_used: providerIndex > 0,
          fallback_from: providerIndex > 0 ? providers.slice(0, providerIndex).map(item => item.provider) : [],
          provider_retry_count: totalRetries,
          final_failure_reason: sanitizeLogMessage(err?.message),
          final_failure_classification: classifyProviderFailure(err),
        }
        throw finalError
      }

      console.warn('[ai-provider] falling back to backup provider', {
        trace_id: traceId,
        from: providerConfig.provider,
        to: providers[providerIndex + 1]?.provider,
        status: err?.status,
        classification: classifyProviderFailure(err),
        message: sanitizeLogMessage(err?.message),
      })
      await sleep(fallbackCooldownMs(err))
    }
  }

  throw new Error(formatAiError(errors.at(-1)) || 'AI generation failed')
}

export const generateWithQwen = generateWithGemini

export function generatePlainTextWithGemini(prompt, options = {}) {
  return generateWithGemini(prompt, { ...options, responseFormat: null })
}

async function generateWithProviderRetries({ traceId, prompt, model, responseFormat, providerConfig, apiKey, timeoutBudgetMs }) {
  const candidates = resolveModelCandidates(model, providerConfig)
  let lastError = null
  let retryCount = 0
  const maxRetries = providerRetryCount()
  const modelName = candidates[0]
  const startedAt = Date.now()
  let structuredRetryCount = 0
  const structuredResponseAttempts = []

  for (let i = 0; i <= maxRetries; i++) {
    try {
      debugLog('[ai-provider] provider attempt', {
        trace_id: traceId,
        provider: providerConfig.provider,
        provider_id: providerConfig.id || null,
        priority: providerConfig.priority,
        attempt: i + 1,
        max_attempts: maxRetries + 1,
        model: modelName,
        candidate_models: candidates,
        timeout_ms: providerTimeoutMs(providerConfig, remainingTimeoutBudget(timeoutBudgetMs, startedAt)),
      })
      const result = await callQwenOnce(apiKey, modelName, prompt, providerConfig, traceId, {
        responseFormat,
        timeoutBudgetMs: remainingTimeoutBudget(timeoutBudgetMs, startedAt),
      })
      structuredResponseAttempts.push(result.response_diagnostics)
      const remainingBudgetMs = remainingTimeoutBudget(timeoutBudgetMs, startedAt)
      const canStructuredRetry = Boolean(result.text) && structuredRetryCount === 0 && hasStructuredRetryBudget(remainingBudgetMs)
      const recovered = await recoverStructuredOutput(result, {
        enabled: Boolean(responseFormat),
        canRetry: canStructuredRetry,
        retry: async () => {
          structuredRetryCount += 1
          console.warn('[ai-provider] retrying structured output on same provider', {
            trace_id: traceId,
            provider: providerConfig.provider,
            provider_id: providerConfig.id || null,
            model: modelName,
            structured_retry_count: structuredRetryCount,
            response_format: responseFormat,
          })
          const retryResult = await callQwenOnce(apiKey, modelName, prompt, providerConfig, traceId, {
            responseFormat,
            timeoutBudgetMs: remainingTimeoutBudget(timeoutBudgetMs, startedAt),
          })
          structuredResponseAttempts.push(retryResult.response_diagnostics)
          return retryResult
        },
      })

      if (!recovered.valid) {
        const structuredError = createStructuredOutputContractError({
          responseDiagnostics: mergeStructuredResponseDiagnostics(
            recovered.result?.response_diagnostics,
            structuredResponseAttempts,
            structuredRetryCount
          ),
          structuredRetryCount,
          skippedReason: structuredRetryCount === 0 && !canStructuredRetry
            ? (result.text ? 'insufficient_timeout_budget' : 'empty_content')
            : null,
        })
        const responseDiagnostics = structuredError.runtimeDiagnostics.response
        console.error('[ai-provider] structured output contract violation', {
          trace_id: traceId,
          provider: providerConfig.provider,
          provider_id: providerConfig.id || null,
          model: modelName,
          ...responseDiagnostics,
        })
        throw structuredError
      }

      return {
        ...recovered.result,
        retry_count: retryCount,
        structured_retry_count: structuredRetryCount,
        response_diagnostics: {
          ...mergeStructuredResponseDiagnostics(
            recovered.result?.response_diagnostics,
            structuredResponseAttempts,
            structuredRetryCount
          ),
        },
      }
    } catch (err) {
      lastError = err
      if (structuredRetryCount > 0 && !err.runtimeDiagnostics) {
        err.runtimeDiagnostics = { structured_retry_count: structuredRetryCount }
      }
      const retryable = isFailoverEligibleError(err)
      const isLast = i === maxRetries

      if (!retryable || isLast) {
        err.retry_count = retryCount
        throw err
      }

      retryCount += 1
      console.warn('[ai-provider] retrying transient provider error', {
        trace_id: traceId,
        provider: providerConfig.provider,
        model: modelName,
        attempt: i + 1,
        status: err?.status,
        classification: classifyProviderFailure(err),
        cooldown_ms: retryCooldownMs(err, i),
        message: sanitizeLogMessage(err?.message),
      })
      await sleep(retryCooldownMs(err, i))
    }
  }

  lastError.retry_count = retryCount
  throw lastError
}

function formatAiError(err) {
  const message = err?.message || 'AI generation failed'
  if (/quota/i.test(message) || /rate limit/i.test(message)) {
    return 'AI service is busy or quota exceeded. Please try again in a few minutes.'
  }
  if (/api[_\s-]?key/i.test(message)) return 'AI service configuration error'
  if (/timeout|aborted/i.test(message)) return 'AI service timed out. Please try again.'
  if (err?.status === 404) {
    return `AI provider endpoint not found (404). Check AI_BASE_URL; attempted ${err.url || 'provider chat completions endpoint'}.`
  }
  return message
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const MAX_PROMPT_CHARS = 90_000
const DEFAULT_MAX_COMPLETION_TOKENS = 1024

async function callQwenOnce(apiKey, model, prompt, providerConfig, traceId, { responseFormat = 'json_object', timeoutBudgetMs } = {}) {
  const safePrompt =
    prompt.length > MAX_PROMPT_CHARS
      ? `${prompt.slice(0, MAX_PROMPT_CHARS)}\n\n[prompt truncated]`
      : prompt

  const { baseUrl, url } = resolveProviderEndpoint(providerConfig?.base_url || DEFAULT_AI_BASE_URL)

  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content: safePrompt,
      },
    ],
    temperature: 0.3,
    max_tokens: maxCompletionTokens(),
    ...buildStructuredOutputRequestControls({ model, responseFormat }),
  }
  if (responseFormat) requestBody.response_format = { type: responseFormat }

  debugLog('[ai-provider] request prepared', {
    trace_id: traceId,
    provider: providerConfig?.provider || 'qwen',
    provider_id: providerConfig?.id || null,
    priority: providerConfig?.priority || null,
    config_source: providerConfig?.source || 'env',
    resolution_source: providerConfig?.resolution_source || null,
    infrastructure: providerConfig?.infrastructure || null,
    baseUrl,
    url,
    model,
    response_format: requestBody.response_format?.type || null,
    thinking_disabled: requestBody.chat_template_kwargs?.enable_thinking === false,
    promptChars: safePrompt.length,
    promptTruncated: prompt.length > MAX_PROMPT_CHARS,
    max_tokens: requestBody.max_tokens,
    timeout_ms: providerTimeoutMs(providerConfig, timeoutBudgetMs),
  })

  const data = await postChatCompletions(url, apiKey, requestBody, {
    model,
    providerConfig,
    traceId,
    timeoutMs: providerTimeoutMs(providerConfig, timeoutBudgetMs),
  })
  const text = extractAssistantText(data)
  const responseDiagnostics = buildAssistantResponseDiagnostics(data, text, data?.__cfAiRequestDiagnostics)

  if (!text && !responseFormat) {
    const finishReason = data?.choices?.[0]?.finish_reason
    throw new Error(finishReason ? `AI returned no content (${finishReason})` : 'AI generation returned no content')
  }

  debugLog('[ai-provider] response received', {
    trace_id: traceId,
    provider: providerConfig?.provider || 'qwen',
    config_source: providerConfig?.source || 'env',
    infrastructure: providerConfig?.infrastructure || null,
    model: data?.model || model,
    finish_reason: data?.choices?.[0]?.finish_reason,
    usage: data?.usage || null,
    elapsed_ms: data?.__cfAiElapsedMs || null,
  })

  recordProviderLatency({
    provider: providerConfig?.provider || 'qwen',
    model: data?.model || model,
    elapsedMs: data?.__cfAiElapsedMs,
    status: 200,
  })

  return {
    text,
    model: data?.model || model || DEFAULT_GEMINI_MODEL,
    raw: data,
    response_diagnostics: responseDiagnostics,
  }
}

export async function testAiProviderConnection(config) {
  const routeStartedAt = Date.now()
  const saved = config?.id ? await getSecretProviderSetting(config.id) : null
  const providerConfig = {
    ...(await getActiveAiProviderConfig()),
    ...(saved || {}),
    ...config,
    ...sanitizeProviderConfig({ ...(saved || {}), ...config }),
    source: config?.source || 'admin-test',
  }
  if (config?.api_key) providerConfig.api_key = String(config.api_key).trim()

  const { apiKey, keyName } = providerConfig.api_key
    ? { apiKey: providerConfig.api_key, keyName: 'api_key' }
    : await getProviderApiKey(providerConfig)

  if (!apiKey) {
    return {
      ok: false,
      status: 400,
      message: `Missing ${keyName || 'AI provider API key'}`,
      key_env: keyName || null,
    }
  }

  const model = resolveModelCandidates(providerConfig.model, providerConfig)[0]
  const { url } = resolveProviderEndpoint(providerConfig.base_url)
  const requestBody = {
    model,
    messages: [{ role: 'user', content: 'Respond with a short plain-text acknowledgement.' }],
    temperature: 0,
    max_tokens: 64,
  }
  const traceId = createTraceId('test')
  const timeoutMs = providerTimeoutMs(providerConfig)

  debugProvider('test_connection:resolved', {
    trace_id: traceId,
    elapsed_ms: Date.now() - routeStartedAt,
    provider: providerConfig.provider,
    provider_id: providerConfig.id || null,
    model,
    base_url: providerConfig.base_url,
    url,
    timeout_ms: timeoutMs,
    key_source: providerConfig.api_key ? 'request_body' : 'stored_or_env',
    request_headers: sanitizeHeaders(providerHeaders(apiKey, providerConfig)),
    request_body: requestBody,
  })

  try {
    debugLog('[ai-provider] health check request', {
      trace_id: traceId,
      provider: providerConfig?.provider || 'qwen',
      model,
      timeout_ms: timeoutMs,
    })

    const data = await postChatCompletions(url, apiKey, requestBody, { model, providerConfig, timeoutMs, traceId })
    validateChatCompletionHealthResponse(data)
    return {
      ok: true,
      status: 200,
      provider: providerConfig.provider,
      model: data?.model || model,
      url,
      message: 'Provider connection succeeded',
    }
  } catch (err) {
    return {
      ok: false,
      status: err?.status || 500,
      provider: providerConfig.provider,
      model,
      url: err?.url || url,
      message: sanitizeLogMessage(err?.message || 'Provider connection failed'),
      body_snippet: err?.bodySnippet || null,
    }
  }
}

async function postChatCompletions(url, apiKey, body, { model, providerConfig, traceId, timeoutMs = AI_REQUEST_TIMEOUT_MS }) {
  const headers = providerHeaders(apiKey, providerConfig)
  debugProvider('post_chat:start', {
    trace_id: traceId,
    provider: providerConfig?.provider || null,
    model,
    url,
    timeout_ms: timeoutMs,
    headers: sanitizeHeaders(headers),
    request: safeRequestMetadata(body),
  })
  try {
    const data = await fetchJsonWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, timeoutMs, traceId, { provider: providerConfig?.provider, model })
    return attachRequestDiagnostics(data, {
      http_status: 200,
      response_format_requested: Boolean(body.response_format),
      response_format_removed_for_retry: false,
      retry_without_response_format: false,
      thinking_disabled: body.chat_template_kwargs?.enable_thinking === false,
      max_tokens_requested: body.max_tokens,
    })
  } catch (err) {
    if (body.response_format && shouldRetryWithoutResponseFormat(err)) {
      console.warn('[ai-provider] retrying without response_format', {
        trace_id: traceId,
        url,
        model,
        status: err?.status,
        message: sanitizeLogMessage(err?.message),
      })
      const fallbackBody = { ...body }
      delete fallbackBody.response_format
      const data = await fetchJsonWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(fallbackBody),
      }, timeoutMs, traceId, { provider: providerConfig?.provider, model })
      recordProviderLatency({
        provider: providerConfig?.provider,
        model,
        elapsedMs: data?.__cfAiElapsedMs,
        status: 200,
        fallbackUsed: true,
      })
      return attachRequestDiagnostics(data, {
        http_status: 200,
        response_format_requested: true,
        response_format_removed_for_retry: true,
        retry_without_response_format: true,
        thinking_disabled: fallbackBody.chat_template_kwargs?.enable_thinking === false,
        max_tokens_requested: fallbackBody.max_tokens,
      })
    }
    throw err
  }
}

async function fetchJsonWithTimeout(url, init, timeoutMs = AI_REQUEST_TIMEOUT_MS, traceId, diagnostics = {}) {
  installFetchDiagnostics()
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    debugProvider('fetch:before_fetch', {
      trace_id: traceId,
      provider: diagnostics.provider || null,
      model: diagnostics.model || null,
      url,
      timeout_ms: timeoutMs,
      method: init?.method || 'GET',
      headers: sanitizeHeaders(init?.headers || {}),
      request: safeRequestMetadata(safeJsonParse(init?.body)),
    })
    const response = await fetch(url, { ...init, signal: controller.signal })
    const elapsedMs = Date.now() - startedAt
    debugProvider('fetch:response_headers_received', {
      trace_id: traceId,
      provider: diagnostics.provider || null,
      model: diagnostics.model || null,
      url,
      elapsed_ms: elapsedMs,
      status: response.status,
      headers: sanitizeHeaders(Object.fromEntries(response.headers.entries())),
    })
    debugProvider('fetch:before_read_body', {
      trace_id: traceId,
      provider: diagnostics.provider || null,
      model: diagnostics.model || null,
      url,
      elapsed_ms: Date.now() - startedAt,
    })
    const text = await response.text()
    debugProvider('fetch:body_read_complete', {
      trace_id: traceId,
      provider: diagnostics.provider || null,
      model: diagnostics.model || null,
      url,
      elapsed_ms: Date.now() - startedAt,
      body_chars: text.length,
    })
    const bodySnippet = snippetText(text)

    debugLog('[ai-provider] response status', {
      trace_id: traceId,
      provider: diagnostics.provider || null,
      model: diagnostics.model || null,
      url,
      status: response.status,
      elapsed_ms: elapsedMs,
      content_type: response.headers.get('content-type') || '',
      request_id: response.headers.get('x-request-id') || response.headers.get('x-nv-request-id'),
      body_snippet: response.ok ? undefined : bodySnippet,
    })

    let data
    try {
      debugProvider('fetch:before_json_parse', {
        trace_id: traceId,
        provider: diagnostics.provider || null,
        model: diagnostics.model || null,
        url,
        elapsed_ms: Date.now() - startedAt,
      })
      data = parseJsonResponse(text, response.status)
      debugProvider('fetch:json_parse_complete', {
        trace_id: traceId,
        provider: diagnostics.provider || null,
        model: diagnostics.model || null,
        url,
        elapsed_ms: Date.now() - startedAt,
      })
    } catch (err) {
      err.url = url
      err.bodySnippet = bodySnippet
      console.error('[ai-provider] non-json response', {
        trace_id: traceId,
        url,
        status: response.status,
        content_type: response.headers.get('content-type') || '',
        body_snippet: bodySnippet,
      })
      throw err
    }

    if (!response.ok) {
      const message = data?.error?.message || data?.detail || data?.message || data?.title || `AI provider error (${response.status})`
      const err = new Error(message)
      err.status = response.status
      err.body = data
      err.url = url
      err.bodySnippet = bodySnippet
      console.error('[ai-provider] request failed', {
        trace_id: traceId,
        url,
        status: response.status,
        message: sanitizeLogMessage(message),
        request_id: response.headers.get('x-request-id') || response.headers.get('x-nv-request-id'),
        body_snippet: bodySnippet,
      })
      throw err
    }

    if (data && typeof data === 'object') data.__cfAiElapsedMs = elapsedMs
    return data
  } catch (err) {
    if (err?.name === 'AbortError') {
      const elapsedMs = Date.now() - startedAt
      const timeoutError = new Error(`AI provider timeout after ${timeoutMs}ms`)
      timeoutError.status = 504
      timeoutError.url = url
      timeoutError.elapsedMs = elapsedMs
      timeoutError.timeoutMs = timeoutMs
      console.error('[ai-provider] request timed out', {
        provider: diagnostics.provider || null,
        model: diagnostics.model || null,
        timeoutMs,
        elapsedMs,
      })
      debugProvider('fetch:abort_timeout', {
        trace_id: traceId,
        provider: diagnostics.provider || null,
        model: diagnostics.model || null,
        url,
        timeout_ms: timeoutMs,
        elapsed_ms: elapsedMs,
        stalled_after: 'fetch:before_fetch',
        response_headers_received: false,
        body_read_started: false,
        json_parse_started: false,
      })
      console.error('[ai-provider] request timeout classified', {
        trace_id: traceId,
        provider: diagnostics.provider || null,
        model: diagnostics.model || null,
        url,
        status: timeoutError.status,
        timeout_ms: timeoutMs,
        elapsed_ms: elapsedMs,
        classification: classifyProviderFailure(timeoutError),
      })
      throw timeoutError
    }
    debugProvider('fetch:error', {
      trace_id: traceId,
      provider: diagnostics.provider || null,
      model: diagnostics.model || null,
      url,
      elapsed_ms: Date.now() - startedAt,
      name: err?.name || null,
      message: sanitizeLogMessage(err?.message),
      code: err?.code || null,
      status: err?.status || null,
    })
    throw err
  } finally {
    clearTimeout(timer)
    debugProvider('fetch:timer_cleared', {
      trace_id: traceId,
      provider: diagnostics.provider || null,
      model: diagnostics.model || null,
      url,
      elapsed_ms: Date.now() - startedAt,
    })
  }
}

function parseJsonResponse(text, status) {
  if (!text?.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    const snippet = snippetText(text)
    const err = new Error(
      status >= 400
        ? `AI provider returned non-JSON error response (${status})${snippet ? `: ${snippet}` : ''}`
        : 'AI provider returned non-JSON response'
    )
    err.status = status >= 400 ? status : 502
    err.bodySnippet = snippet
    throw err
  }
}

function extractAssistantText(data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .join('')
      .trim()
  }
  return ''
}

function validateChatCompletionHealthResponse(data) {
  if (data?.error) {
    throw new Error(data.error?.message || data.error || 'AI provider returned an error')
  }

  const choices = data?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('AI provider returned no chat choices')
  }

  const message = choices[0]?.message
  if (!message || typeof message !== 'object') {
    throw new Error('AI provider returned no assistant message')
  }

  if (message.role && message.role !== 'assistant') {
    throw new Error(`AI provider returned unexpected message role: ${message.role}`)
  }

  if (!hasAssistantResponsePayload(message)) {
    throw new Error('AI provider returned no assistant response content')
  }
}

function hasAssistantResponsePayload(message) {
  if (extractAssistantText({ choices: [{ message }] })) return true

  const equivalentFields = [
    message.reasoning_content,
    message.reasoning,
    message.refusal,
  ]
  if (equivalentFields.some(value => typeof value === 'string' && value.trim())) return true

  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0
}

function resolveProviderEndpoint(rawUrl) {
  const normalized = normalizeBaseUrl(rawUrl)
  const withoutChatPath = normalized.replace(/\/chat\/completions$/i, '')
  const baseUrl = /\/v1$/i.test(withoutChatPath) ? withoutChatPath : `${withoutChatPath}/v1`
  return {
    baseUrl,
    url: `${baseUrl}/chat/completions`,
  }
}

function normalizeBaseUrl(url) {
  return String(url || DEFAULT_AI_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
}

function prefersNvidiaNamespace(providerConfig) {
  const provider = String(providerConfig?.provider || '').toLowerCase()
  if (provider === 'nemotron' || provider === 'nvidia') return true
  return resolveProviderEndpoint(providerConfig?.base_url || process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL).baseUrl.includes('integrate.api.nvidia.com')
}

function withNvidiaNamespace(modelName, providerConfig) {
  if (!modelName || modelName.includes('/')) return null
  const provider = String(providerConfig?.provider || '').toLowerCase()
  if (provider === 'qwen') return `qwen/${modelName}`
  if (provider === 'nvidia' || provider === 'nemotron') return `nvidia/${modelName}`
  return null
}

function sanitizeLogMessage(message) {
  const text = String(message || '')
  return text.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 400)
}

function snippetText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function shouldRetryWithoutResponseFormat(err) {
  const message = err?.message || ''
  return (
    /response_format|json_object/i.test(message) ||
    (err?.status === 400 && /invalid|unsupported|unknown|bad request/i.test(message))
  )
}

function providerHeaders(apiKey, providerConfig) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  if (providerConfig?.provider === 'openrouter' || /openrouter\.ai/i.test(providerConfig?.base_url || '')) {
    headers['HTTP-Referer'] = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'
    headers['X-Title'] = 'CF Portal'
  }

  return headers
}

function debugProvider(event, payload = {}) {
  if (!isProviderDebugEnabled()) return
  try {
    debugLog('[ai-provider-debug]', JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    }, null, 2))
  } catch {
    // Debug logging must never alter provider execution.
  }
}

function isProviderDebugEnabled() {
  return process.env.AI_PROVIDER_DEBUG === '1' || process.env.NODE_ENV !== 'production'
}

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => {
      if (/authorization|api[-_]?key|token|secret|cookie/i.test(key)) return [key, '[redacted]']
      return [key, value]
    })
  )
}

function safeJsonParse(value) {
  if (typeof value !== 'string') return value || null
  try {
    return JSON.parse(value)
  } catch {
    return snippetText(value)
  }
}

function safeRequestMetadata(body) {
  if (!body || typeof body !== 'object') return null
  const messages = Array.isArray(body.messages) ? body.messages : []
  return {
    model: body.model || null,
    message_count: messages.length,
    message_roles: messages.map(message => message?.role || null),
    prompt_chars: messages.reduce((total, message) => total + String(message?.content || '').length, 0),
    temperature: body.temperature ?? null,
    max_tokens: body.max_tokens ?? null,
    response_format: body.response_format?.type || null,
    thinking_disabled: body.chat_template_kwargs?.enable_thinking === false,
  }
}

function attachRequestDiagnostics(data, diagnostics) {
  if (!data || typeof data !== 'object') return data
  Object.defineProperty(data, '__cfAiRequestDiagnostics', {
    value: { ...diagnostics },
    configurable: true,
    enumerable: false,
  })
  return data
}

function mergeStructuredResponseDiagnostics(finalDiagnostics, attempts, structuredRetryCount) {
  const safeAttempts = attempts.filter(Boolean)
  return {
    ...(finalDiagnostics || {}),
    response_format_requested: safeAttempts.some(item => item.response_format_requested),
    response_format_removed_for_retry: safeAttempts.some(item => item.response_format_removed_for_retry),
    retry_without_response_format: safeAttempts.some(item => item.retry_without_response_format),
    structured_retry_count: structuredRetryCount,
    structured_attempts: safeAttempts,
  }
}

function installFetchDiagnostics() {
  if (!isProviderDebugEnabled() || fetchDiagnosticsInstalled) return
  fetchDiagnosticsInstalled = true

  const channels = [
    'undici:client:beforeConnect',
    'undici:client:connected',
    'undici:client:connectError',
    'undici:client:sendHeaders',
    'undici:request:create',
    'undici:request:bodySent',
    'undici:request:headers',
    'undici:request:trailers',
    'undici:request:error',
  ]

  for (const name of channels) {
    diagnosticsChannel.channel(name).subscribe(message => {
      debugProvider(`undici:${name.replace(/^undici:/, '')}`, sanitizeUndiciMessage(message))
    })
  }
}

function sanitizeUndiciMessage(message) {
  const request = message?.request
  const error = message?.error
  const connectParams = message?.connectParams
  return {
    origin: request?.origin || connectParams?.origin || null,
    path: request?.path || connectParams?.path || null,
    method: request?.method || null,
    status_code: message?.response?.statusCode || null,
    headers: sanitizeHeaderList(message?.response?.headers || request?.headers || null),
    error: error ? {
      name: error.name || null,
      message: sanitizeLogMessage(error.message),
      code: error.code || null,
    } : null,
  }
}

function sanitizeHeaderList(headers) {
  if (!headers) return null
  if (Array.isArray(headers)) {
    const output = {}
    for (let i = 0; i < headers.length; i += 2) {
      output[String(headers[i])] = String(headers[i + 1] || '')
    }
    return sanitizeHeaders(output)
  }
  if (typeof headers === 'string') return headers.replace(/Authorization:\s*Bearer\s+[^\r\n]+/gi, 'Authorization: Bearer [redacted]')
  return sanitizeHeaders(headers)
}

function maxCompletionTokens() {
  const value = Number.parseInt(process.env.AI_MAX_TOKENS || '', 10)
  if (Number.isFinite(value) && value >= 256) return Math.min(value, 8192)
  return DEFAULT_MAX_COMPLETION_TOKENS
}

function createTraceId(prefix = 'gen') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function providerRetryCount() {
  const configured = Number.parseInt(process.env.AI_PROVIDER_RETRIES || '', 10)
  if (Number.isFinite(configured) && configured >= 0) return Math.min(configured, 3)
  return 1
}

function providerTimeoutMs(providerConfig, timeoutBudgetMs) {
  const provider = String(providerConfig?.provider || '').toLowerCase()
  const configured = Number.parseInt(process.env[`AI_TIMEOUT_${provider.toUpperCase()}_MS`] || '', 10)
  const base = Number.isFinite(configured) && configured >= 10_000
    ? configured
    : AI_PROVIDER_TIMEOUTS_MS[provider] || AI_PROVIDER_TIMEOUTS_MS.default || AI_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(timeoutBudgetMs) || timeoutBudgetMs <= 0) return base
  return Math.max(10_000, Math.min(base, timeoutBudgetMs - AI_PROVIDER_TIMEOUT_SAFETY_MS))
}

function hasStructuredRetryBudget(timeoutBudgetMs) {
  if (!Number.isFinite(timeoutBudgetMs)) return true
  return timeoutBudgetMs >= 10_500 + AI_PROVIDER_TIMEOUT_SAFETY_MS
}

function remainingTimeoutBudget(timeoutBudgetMs, startedAt) {
  if (!Number.isFinite(timeoutBudgetMs)) return null
  return Math.max(0, timeoutBudgetMs - (Date.now() - startedAt))
}

function retryCooldownMs(err, attemptIndex) {
  const configured = Number.parseInt(process.env.AI_RETRY_COOLDOWN_MS || '', 10)
  const base = Number.isFinite(configured) && configured >= 0 ? configured : AI_RETRY_COOLDOWN_MS
  const classification = classifyProviderFailure(err)
  const multiplier = classification === 'rate_limit' ? 2.5 : classification === 'timeout' ? 1.5 : 1
  return Math.min(Math.round(base * multiplier * Math.pow(1.5, attemptIndex)), 6_000)
}

function fallbackCooldownMs(err) {
  const classification = classifyProviderFailure(err)
  if (classification === 'rate_limit') return 2_000
  if (classification === 'timeout') return 1_000
  return 500
}
