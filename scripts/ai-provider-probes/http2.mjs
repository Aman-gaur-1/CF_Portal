import http2 from 'http2'
import { getProviderRequest, log, snippet, TARGET_URL, TIMEOUT_MS } from './common.mjs'

const request = await getProviderRequest(Number.parseInt(process.argv[2] || '1', 10))
const url = new URL(TARGET_URL)
const startedAt = Date.now()
const body = request.bodyText

log('http2:start', {
  provider: request.row.provider,
  model: request.row.model,
  url: TARGET_URL,
  timeout_ms: TIMEOUT_MS,
  headers: request.safeHeaders,
  body: request.body,
})

const client = http2.connect(url.origin)
const timer = setTimeout(() => {
  log('http2:timeout', { elapsed_ms: Date.now() - startedAt })
  client.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`))
}, TIMEOUT_MS)

client.on('connect', () => {
  log('http2:connected', {
    elapsed_ms: Date.now() - startedAt,
    alpn_protocol: client.socket.alpnProtocol,
    tls_protocol: client.socket.getProtocol(),
    authorized: client.socket.authorized,
  })

  const req = client.request({
    ':method': 'POST',
    ':path': url.pathname,
    ':scheme': url.protocol.replace(':', ''),
    ':authority': url.host,
    'content-type': 'application/json',
    authorization: `Bearer ${request.apiKey}`,
    'content-length': Buffer.byteLength(body),
  })

  const chunks = []
  req.on('response', headers => {
    const safeHeaders = { ...headers }
    if (safeHeaders.authorization) safeHeaders.authorization = '[redacted]'
    log('http2:headers', {
      elapsed_ms: Date.now() - startedAt,
      headers: safeHeaders,
    })
  })
  req.on('data', chunk => {
    if (!chunks.length) {
      log('http2:first_body_byte', {
        elapsed_ms: Date.now() - startedAt,
        bytes: chunk.length,
      })
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    clearTimeout(timer)
    const text = Buffer.concat(chunks).toString('utf8')
    log('http2:body', {
      elapsed_ms: Date.now() - startedAt,
      chars: text.length,
      body: snippet(text),
    })
    client.close()
  })
  req.on('error', err => {
    clearTimeout(timer)
    log('http2:request_error', {
      elapsed_ms: Date.now() - startedAt,
      name: err?.name || null,
      message: err?.message || String(err),
      code: err?.code || null,
    })
    client.destroy()
  })

  req.end(body)
  log('http2:request_body_sent', { elapsed_ms: Date.now() - startedAt })
})

client.on('error', err => {
  clearTimeout(timer)
  log('http2:client_error', {
    elapsed_ms: Date.now() - startedAt,
    name: err?.name || null,
    message: err?.message || String(err),
    code: err?.code || null,
  })
})
