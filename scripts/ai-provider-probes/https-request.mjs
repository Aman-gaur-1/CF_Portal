import https from 'https'
import { URL } from 'url'
import { getProviderRequest, log, snippet, TIMEOUT_MS } from './common.mjs'

const request = await getProviderRequest(Number.parseInt(process.argv[2] || '1', 10))
const url = new URL(request.url)
const startedAt = Date.now()

log('https:start', {
  provider: request.row.provider,
  model: request.row.model,
  url: request.url,
  timeout_ms: TIMEOUT_MS,
  headers: request.safeHeaders,
  body: request.body,
})

const req = https.request({
  method: 'POST',
  hostname: url.hostname,
  path: url.pathname,
  port: url.port || 443,
  headers: {
    ...request.headers,
    'Content-Length': Buffer.byteLength(request.bodyText),
  },
  timeout: TIMEOUT_MS,
}, res => {
  log('https:headers', {
    elapsed_ms: Date.now() - startedAt,
    status: res.statusCode,
    headers: res.headers,
  })
  let firstByte = false
  const chunks = []
  res.on('data', chunk => {
    if (!firstByte) {
      firstByte = true
      log('https:first_body_byte', {
        elapsed_ms: Date.now() - startedAt,
        bytes: chunk.length,
      })
    }
    chunks.push(chunk)
  })
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8')
    log('https:body', {
      elapsed_ms: Date.now() - startedAt,
      chars: text.length,
      body: snippet(text),
    })
  })
})

req.on('socket', socket => {
  log('https:socket_assigned', { elapsed_ms: Date.now() - startedAt })
  socket.on('lookup', (err, address, family, host) => {
    log('https:dns_lookup', {
      elapsed_ms: Date.now() - startedAt,
      error: err?.message || null,
      address,
      family,
      host,
    })
  })
  socket.on('connect', () => {
    log('https:tcp_connect', {
      elapsed_ms: Date.now() - startedAt,
      remote_address: socket.remoteAddress,
      remote_port: socket.remotePort,
    })
  })
  socket.on('secureConnect', () => {
    log('https:tls_secure_connect', {
      elapsed_ms: Date.now() - startedAt,
      authorized: socket.authorized,
      authorization_error: socket.authorizationError || null,
      protocol: socket.getProtocol(),
      cipher: socket.getCipher(),
      alpn_protocol: socket.alpnProtocol || null,
    })
  })
})

req.on('finish', () => log('https:request_body_sent', { elapsed_ms: Date.now() - startedAt }))
req.on('timeout', () => {
  log('https:timeout', { elapsed_ms: Date.now() - startedAt })
  req.destroy(new Error(`request timeout after ${TIMEOUT_MS}ms`))
})
req.on('error', err => {
  log('https:error', {
    elapsed_ms: Date.now() - startedAt,
    name: err?.name || null,
    message: err?.message || String(err),
    code: err?.code || null,
  })
})

req.write(request.bodyText)
req.end()
