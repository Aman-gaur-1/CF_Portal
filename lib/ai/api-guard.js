import { normalizeSubmissionId } from './sanitize'

const RATE_WINDOW_MS = 60_000
const MAX_PER_IP = 20
const MAX_PER_SUBMISSION = 5

/** @type {Map<string, { count: number, resetAt: number }>} */
const ipBuckets = new Map()
/** @type {Map<string, { count: number, resetAt: number }>} */
const submissionBuckets = new Map()

function checkBucket(store, key, max) {
  const now = Date.now()
  let entry = store.get(key)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS }
    store.set(key, entry)
  }
  entry.count += 1
  if (entry.count > max) {
    return false
  }
  return true
}

export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'local'
}

/**
 * Optional shared secret for evaluation endpoints (set EVALUATE_SECRET in production).
 */
export function assertEvaluateAuth(request) {
  const secret = process.env.EVALUATE_SECRET
  if (!secret) return null

  const provided =
    request.headers.get('x-evaluate-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (provided !== secret) {
    return { error: 'Unauthorized', status: 401 }
  }
  return null
}

/**
 * Rate limit + validate evaluation requests.
 */
export function guardEvaluateRequest(request, body) {
  const authError = assertEvaluateAuth(request)
  if (authError) return authError

  const submissionId = normalizeSubmissionId(body?.submissionId)
  if (!submissionId) {
    return { error: 'Valid submissionId is required', status: 400 }
  }

  const ip = getClientIp(request)
  if (!checkBucket(ipBuckets, ip, MAX_PER_IP)) {
    return { error: 'Too many requests. Please try again shortly.', status: 429 }
  }
  if (!checkBucket(submissionBuckets, submissionId, MAX_PER_SUBMISSION)) {
    return { error: 'This submission was evaluated too recently. Please wait.', status: 429 }
  }

  return { submissionId }
}

/**
 * Protect curriculum write operations when secret is configured.
 */
export function assertAdminSecret(request, envKey = 'EVALUATE_SECRET') {
  const secret = process.env[envKey]
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { error: 'Admin secret not configured', status: 503 }
    }
    return null
  }

  const provided =
    request.headers.get('x-evaluate-secret') ||
    request.headers.get('x-ingest-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (provided !== secret) {
    return { error: 'Unauthorized', status: 401 }
  }
  return null
}
