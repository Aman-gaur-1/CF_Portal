import { getSupabaseAdmin } from '@/lib/supabase-server'

const DEFAULT_SETTINGS = {
  AUTO_APPROVAL_ENABLED: false,
  AUTO_APPROVAL_DELAY: 30,
  STUDENT_QUERY_ENABLED: false,
  NOTIFICATIONS_ENABLED: false,
  DEFAULT_PHASE: null,
}

function hasDefault(key) {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
}

export async function getSetting(key, fallback = undefined, { supabase = getSupabaseAdmin() } = {}) {
  const settingKey = String(key || '').trim()
  if (!settingKey) return fallback

  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', settingKey)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (data) return data.value
  if (fallback !== undefined) return fallback
  return hasDefault(settingKey) ? DEFAULT_SETTINGS[settingKey] : null
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
