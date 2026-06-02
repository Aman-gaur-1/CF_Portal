import crypto from 'crypto'

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function getSecret() {
  if (process.env.ADMIN_SESSION_SECRET) return process.env.ADMIN_SESSION_SECRET
  if (process.env.NODE_ENV !== 'production') return 'cf-admin-dev-secret'
  throw new Error('ADMIN_SESSION_SECRET is required in production')
}

function base64url(input) {
  return Buffer.from(input).toString('base64url')
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function createAdminToken(name) {
  const payload = JSON.stringify({
    name,
    role: 'admin',
    exp: Date.now() + TOKEN_TTL_MS,
  })
  const encoded = base64url(payload)
  return `${encoded}.${sign(encoded)}`
}

export function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [encoded, signature] = token.split('.')
  try {
    if (!encoded || !signature || sign(encoded) !== signature) return null
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (payload.role !== 'admin' || !payload.name || payload.exp < Date.now()) return null
    return { name: payload.name }
  } catch {
    return null
  }
}

export function getAdminFromRequest(request) {
  const header = request.headers.get('authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  return verifyAdminToken(token)
}
