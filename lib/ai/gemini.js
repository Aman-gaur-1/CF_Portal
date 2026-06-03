import {
  AI_REQUEST_TIMEOUT_MS,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_FALLBACKS,
} from './constants'
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
export async function generateWithGemini(prompt, { model, responseFormat = 'json_object' } = {}) {
  const traceId = createTraceId()
  const providers = await resolveProviderOrder()
  const errors = []
  let totalRetries = 0

  console.info('[ai-provider] resolution', {
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
      totalRetries += err.retry_count || 0
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
        finalError.runtimeDiagnostics = {
          trace_id: traceId,
          attempts: errors,
          final_provider_attempted: providerConfig.provider,
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
    }
  }

  throw new Error(formatAiError(errors.at(-1)) || 'AI generation failed')
}

export const generateWithQwen = generateWithGemini

export function generatePlainTextWithGemini(prompt, options = {}) {
  return generateWithGemini(prompt, { ...options, responseFormat: null })
}

async function generateWithProviderRetries({ traceId, prompt, model, responseFormat, providerConfig, apiKey }) {
  const candidates = resolveModelCandidates(model, providerConfig)
  let lastError = null
  let retryCount = 0
  const maxRetries = providerRetryCount()
  const modelName = candidates[0]

  for (let i = 0; i <= maxRetries; i++) {
    try {
      console.info('[ai-provider] provider attempt', {
        trace_id: traceId,
        provider: providerConfig.provider,
        provider_id: providerConfig.id || null,
        priority: providerConfig.priority,
        attempt: i + 1,
        max_attempts: maxRetries + 1,
        model: modelName,
        candidate_models: candidates,
      })
      const result = await callQwenOnce(apiKey, modelName, prompt, providerConfig, traceId, { responseFormat })
      return { ...result, retry_count: retryCount }
    } catch (err) {
      lastError = err
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
        message: sanitizeLogMessage(err?.message),
      })
      await sleep(500 * Math.pow(2, i))
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

const MAX_PROMPT_CHARS = 120_000
const PROVIDER_TEST_TIMEOUT_MS = 30_000
const DEFAULT_MAX_COMPLETION_TOKENS = 1024

async function callQwenOnce(apiKey, model, prompt, providerConfig, traceId, { responseFormat = 'json_object' } = {}) {
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
  }
  if (responseFormat) requestBody.response_format = { type: responseFormat }

  console.info('[ai-provider] request prepared', {
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
    promptChars: safePrompt.length,
    max_tokens: requestBody.max_tokens,
  })

  const data = await postChatCompletions(url, apiKey, requestBody, { model, providerConfig, traceId })
  const text = extractAssistantText(data)

  if (!text) {
    const finishReason = data?.choices?.[0]?.finish_reason
    throw new Error(finishReason ? `AI returned no content (${finishReason})` : 'AI generation returned no content')
  }

  console.info('[ai-provider] response received', {
    trace_id: traceId,
    provider: providerConfig?.provider || 'qwen',
    config_source: providerConfig?.source || 'env',
    infrastructure: providerConfig?.infrastructure || null,
    model: data?.model || model,
    finish_reason: data?.choices?.[0]?.finish_reason,
    usage: data?.usage || null,
  })

  return { text, model: data?.model || model || DEFAULT_GEMINI_MODEL, raw: data }
}

export async function testAiProviderConnection(config) {
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
    messages: [{ role: 'user', content: 'Reply with OK' }],
    temperature: 0,
    max_tokens: 8,
  }
  const traceId = createTraceId('test')

  try {
    const data = await postChatCompletions(url, apiKey, requestBody, { model, providerConfig, timeoutMs: PROVIDER_TEST_TIMEOUT_MS, traceId })
    const text = extractAssistantText(data)
    if (!/\bok\b/i.test(text || '')) {
      throw new Error('Provider returned an invalid health-check response')
    }
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
  try {
    return await fetchJsonWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, timeoutMs, traceId, { provider: providerConfig?.provider, model })
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
      return fetchJsonWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(fallbackBody),
      }, timeoutMs, traceId, { provider: providerConfig?.provider, model })
    }
    throw err
  }
}

async function fetchJsonWithTimeout(url, init, timeoutMs = AI_REQUEST_TIMEOUT_MS, traceId, diagnostics = {}) {
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const elapsedMs = Date.now() - startedAt
    const text = await response.text()
    const bodySnippet = snippetText(text)

    console.info('[ai-provider] response status', {
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
      data = parseJsonResponse(text, response.status)
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
      const message = data?.error?.message || data?.message || `AI provider error (${response.status})`
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
    throw err
  } finally {
    clearTimeout(timer)
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
  return resolveProviderEndpoint(providerConfig?.base_url || process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL).baseUrl.includes('integrate.api.nvidia.com')
}

function withNvidiaNamespace(modelName, providerConfig) {
  if (!modelName || modelName.includes('/')) return null
  if (modelName === DEFAULT_AI_MODEL || providerConfig?.provider === 'qwen' || providerConfig?.provider === 'nvidia') {
    return `qwen/${modelName}`
  }
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
