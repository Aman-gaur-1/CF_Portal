import { clearSharedRateLimit, consumeSharedRateLimit, getClientIp } from '@/lib/rate-limit'

const LOGIN_WINDOW_SECONDS = 15 * 60
const MAX_LOGIN_ATTEMPTS = 10

export async function consumeLoginAttempt(request, role) {
  return consumeSharedRateLimit({
    key: loginRateLimitKey(request, role),
    windowSeconds: LOGIN_WINDOW_SECONDS,
    maxAttempts: MAX_LOGIN_ATTEMPTS,
  })
}

export async function clearLoginAttempts(request, role) {
  await clearSharedRateLimit(loginRateLimitKey(request, role))
}

function loginRateLimitKey(request, role) {
  return `login:${role}:${getClientIp(request)}`
}
