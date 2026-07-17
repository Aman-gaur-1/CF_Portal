import { getProviderRequest, log, snippet, TIMEOUT_MS } from './common.mjs'

const request = await getProviderRequest(Number.parseInt(process.argv[2] || '1', 10))
const startedAt = Date.now()
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

log('fetch:start', {
  provider: request.row.provider,
  model: request.row.model,
  url: request.url,
  timeout_ms: TIMEOUT_MS,
  headers: request.safeHeaders,
  body: request.body,
})

try {
  log('fetch:before_fetch', { elapsed_ms: Date.now() - startedAt })
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.bodyText,
    signal: controller.signal,
  })
  log('fetch:headers', {
    elapsed_ms: Date.now() - startedAt,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
  })
  log('fetch:before_body', { elapsed_ms: Date.now() - startedAt })
  const text = await response.text()
  log('fetch:body', {
    elapsed_ms: Date.now() - startedAt,
    chars: text.length,
    body: snippet(text),
  })
} catch (err) {
  log('fetch:error', {
    elapsed_ms: Date.now() - startedAt,
    name: err?.name || null,
    message: err?.message || String(err),
    code: err?.code || null,
    stalled_after: 'fetch:before_fetch',
  })
} finally {
  clearTimeout(timer)
}
