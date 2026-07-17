import { normalizeSubmissionId } from './sanitize'
import { consumeSharedRateLimit, getClientIp } from '@/lib/rate-limit'

const RATE_WINDOW_SECONDS = 60
const MAX_PER_IP = 20
const MAX_PER_SUBMISSION = 5

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
export async function guardEvaluateRequest(request, body) {
  const submissionId = normalizeSubmissionId(body?.submissionId)
  if (!submissionId) {
    return { error: 'Valid submissionId is required', status: 400 }
  }

  const ip = getClientIp(request)
  const ipLimit = await consumeSharedRateLimit({
    key: `evaluate:ip:${ip}`,
    windowSeconds: RATE_WINDOW_SECONDS,
    maxAttempts: MAX_PER_IP,
  })
  if (!ipLimit.allowed) {
    return { error: 'Too many requests. Please try again shortly.', status: 429, retryAfterSeconds: ipLimit.retryAfterSeconds }
  }
  const submissionLimit = await consumeSharedRateLimit({
    key: `evaluate:submission:${submissionId}`,
    windowSeconds: RATE_WINDOW_SECONDS,
    maxAttempts: MAX_PER_SUBMISSION,
  })
  if (!submissionLimit.allowed) {
    return { error: 'This submission was evaluated too recently. Please wait.', status: 429, retryAfterSeconds: submissionLimit.retryAfterSeconds }
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
