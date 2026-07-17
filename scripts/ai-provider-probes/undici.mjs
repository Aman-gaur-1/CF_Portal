import diagnosticsChannel from 'diagnostics_channel'
import { getProviderRequest, log, snippet, TIMEOUT_MS } from './common.mjs'

const undiciModule = process.env.UNDICI_IMPORT
  ? await import(process.env.UNDICI_IMPORT)
  : await import('undici')
const { request: undiciRequest } = undiciModule

for (const name of [
  'undici:client:beforeConnect',
  'undici:client:connected',
  'undici:client:connectError',
  'undici:client:sendHeaders',
  'undici:request:create',
  'undici:request:bodySent',
  'undici:request:headers',
  'undici:request:trailers',
  'undici:request:error',
]) {
  diagnosticsChannel.channel(name).subscribe(message => {
    log(name, {
      origin: message?.request?.origin || null,
      path: message?.request?.path || null,
      method: message?.request?.method || null,
      status_code: message?.response?.statusCode || null,
      error: message?.error ? {
        name: message.error.name || null,
        message: message.error.message || null,
        code: message.error.code || null,
      } : null,
    })
  })
}

const request = await getProviderRequest(Number.parseInt(process.argv[2] || '1', 10))
const startedAt = Date.now()

log('undici:start', {
  provider: request.row.provider,
  model: request.row.model,
  url: request.url,
  timeout_ms: TIMEOUT_MS,
  headers: request.safeHeaders,
  body: request.body,
})

try {
  const response = await undiciRequest(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.bodyText,
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  })
  log('undici:headers', {
    elapsed_ms: Date.now() - startedAt,
    status: response.statusCode,
    headers: response.headers,
  })
  const text = await response.body.text()
  log('undici:body', {
    elapsed_ms: Date.now() - startedAt,
    chars: text.length,
    body: snippet(text),
  })
} catch (err) {
  log('undici:error', {
    elapsed_ms: Date.now() - startedAt,
    name: err?.name || null,
    message: err?.message || String(err),
    code: err?.code || null,
  })
}
