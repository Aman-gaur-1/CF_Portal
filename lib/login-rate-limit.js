const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 10

const loginBuckets = globalThis.__cfLoginRateLimitBuckets || new Map()
globalThis.__cfLoginRateLimitBuckets = loginBuckets

export function consumeLoginAttempt(request, role) {
  const now = Date.now()
  const key = `${role}:${getClientIp(request)}`
  const current = loginBuckets.get(key)

  if (!current || current.resetAt <= now) {
    loginBuckets.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  current.count += 1
  if (current.count <= MAX_LOGIN_ATTEMPTS) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
  }
}

export function clearLoginAttempts(request, role) {
  loginBuckets.delete(`${role}:${getClientIp(request)}`)
}

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'local'
}
