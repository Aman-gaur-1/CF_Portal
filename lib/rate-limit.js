import { getSupabaseAdmin } from '@/lib/supabase-server'

export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'local'
}

export async function consumeSharedRateLimit({
  key,
  windowSeconds,
  maxAttempts,
  supabase = getSupabaseAdmin(),
}) {
  const safeKey = String(key || '').trim().slice(0, 220)
  if (!safeKey) return { allowed: false, retryAfterSeconds: windowSeconds || 60 }

  const { data, error } = await supabase.rpc('cf_consume_rate_limit', {
    p_rate_key: safeKey,
    p_window_seconds: Math.max(Number(windowSeconds) || 60, 1),
    p_max_attempts: Math.max(Number(maxAttempts) || 1, 1),
  })
  if (error) {
    console.error('[rate-limit] cf_consume_rate_limit rpc failed', {
      code: error.code || null,
      message: error.message || null,
      details: error.details || null,
      hint: error.hint || null,
    })
    throw new Error(error.message)
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    allowed: Boolean(row?.allowed),
    retryAfterSeconds: Math.max(Number(row?.retry_after_seconds) || 0, 0),
    currentCount: Number(row?.current_count) || 0,
    resetAt: row?.reset_at || null,
  }
}

export async function clearSharedRateLimit(key, supabase = getSupabaseAdmin()) {
  const safeKey = String(key || '').trim().slice(0, 220)
  if (!safeKey) return
  const { error } = await supabase.from('cf_rate_limits').delete().eq('rate_key', safeKey)
  if (error) console.warn('[rate-limit] clear failed', error.message)
}
