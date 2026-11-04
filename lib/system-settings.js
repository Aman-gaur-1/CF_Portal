import { getSupabaseAdmin } from '@/lib/supabase-server'

const DEFAULT_SETTINGS = {
  AUTO_APPROVAL_ENABLED: false,
  AUTO_APPROVAL_DELAY: 30,
  STUDENT_QUERY_ENABLED: false,
  NOTIFICATIONS_ENABLED: false,
  DEFAULT_PHASE: null,
}

const SETTINGS_TTL_MS = 60 * 1000
const SETTINGS_CACHE_MAX = 128
const SETTINGS_CACHE_KEYS = new Set([
  ...Object.keys(DEFAULT_SETTINGS),
  'NOTIFICATION_RETENTION_DAYS',
  'NOTIFICATION_PREFERENCES',
])
const settingsCaches = new WeakMap()

function cacheFor(supabase) {
  if (!supabase || (typeof supabase !== 'object' && typeof supabase !== 'function')) return null
  let cache = settingsCaches.get(supabase)
  if (!cache) {
    cache = new Map()
    settingsCaches.set(supabase, cache)
  }
  return cache
}

function isCacheable(key) {
  return SETTINGS_CACHE_KEYS.has(key)
}

function remember(cache, key, value, ttlMs = SETTINGS_TTL_MS) {
  if (!cache) return
  if (cache.size >= SETTINGS_CACHE_MAX && !cache.has(key)) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.delete(key)
  cache.set(key, { value, expiresAt: Date.now() + Math.max(Number(ttlMs) || SETTINGS_TTL_MS, 1000) })
}

function hasDefault(key) {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
}

export async function getSetting(key, fallback = undefined, { supabase = getSupabaseAdmin(), cache = true, ttlMs = SETTINGS_TTL_MS } = {}) {
  const settingKey = String(key || '').trim()
  if (!settingKey) return fallback

  const settingsCache = cache && isCacheable(settingKey) ? cacheFor(supabase) : null
  const cached = settingsCache?.get(settingKey)
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.value
    settingsCache.delete(settingKey)
  }

  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', settingKey)
    .maybeSingle()

  if (error) throw new Error(error.message)
  const value = data
    ? data.value
    : fallback !== undefined
      ? fallback
      : hasDefault(settingKey)
        ? DEFAULT_SETTINGS[settingKey]
        : null
  remember(settingsCache, settingKey, value, ttlMs)
  return value
}

export async function setSetting(key, value, description = null, { supabase = getSupabaseAdmin() } = {}) {
  const settingKey = String(key || '').trim()
  if (!settingKey) throw new Error('Setting key is required')

  const payload = {
    key: settingKey,
    value,
    updated_at: new Date().toISOString(),
  }
  if (description !== null) payload.description = description

  const { data, error } = await supabase
    .from('system_settings')
    .upsert(payload, { onConflict: 'key' })
    .select('key, value, description, updated_at')
    .single()

  if (error) throw new Error(error.message)
  const settingsCache = cacheFor(supabase)
  settingsCache?.delete(settingKey)
  return data
}

export async function getBoolean(key, fallback = false, options = {}) {
  const value = await getSetting(key, fallback, options)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return Boolean(value)
}

export async function getNumber(key, fallback = 0, options = {}) {
  const value = await getSetting(key, fallback, options)
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export async function getString(key, fallback = '', options = {}) {
  const value = await getSetting(key, fallback, options)
  if (value === null || value === undefined) return fallback
  return String(value)
}
