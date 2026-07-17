import { getProviderRequest, log, snippet, TIMEOUT_MS } from './common.mjs'

const axiosModule = process.env.AXIOS_IMPORT
  ? await import(process.env.AXIOS_IMPORT)
  : await import('axios')
const axios = axiosModule.default || axiosModule

const request = await getProviderRequest(Number.parseInt(process.argv[2] || '1', 10))
const startedAt = Date.now()

log('axios:start', {
  provider: request.row.provider,
  model: request.row.model,
  url: request.url,
  timeout_ms: TIMEOUT_MS,
  headers: request.safeHeaders,
  body: request.body,
})

try {
  const response = await axios.post(request.url, request.body, {
    headers: request.headers,
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
  })
  log('axios:response', {
    elapsed_ms: Date.now() - startedAt,
    status: response.status,
    headers: response.headers,
    body: snippet(JSON.stringify(response.data)),
  })
} catch (err) {
  log('axios:error', {
    elapsed_ms: Date.now() - startedAt,
    name: err?.name || null,
    message: err?.message || String(err),
    code: err?.code || null,
    status: err?.response?.status || null,
  })
}
