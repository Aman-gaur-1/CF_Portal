import { getSupabaseAdmin } from '@/lib/supabase-server'
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from './constants'
import { decryptSecret, encryptSecret, maskSecret } from './crypto'

export const DEFAULT_AI_PROVIDER = 'qwen'
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export const PROVIDER_LABELS = {
  qwen: 'Qwen',
  nemotron: 'Nemotron',
  openrouter: 'OpenRouter',
  step: 'Step',
}

const PROVIDER_ALIASES = {
  nvidia: 'qwen',
  qwen3: 'qwen',
  mistralnemotron: 'nemotron',
  'mistral-nemotron': 'nemotron',
  step35flash: 'step',
  'step-3.5-flash': 'step',
  openrouterai: 'openrouter',
}

const SELECT_SAFE_COLUMNS = [
  'id',
  'provider',
  'model',
  'base_url',
  'generation_mode',
  'enabled',
  'priority',
  'is_active',
  'masked_key_preview',
  'last_tested_at',
  'last_test_success',
  'last_test_message',
  'created_at',
  'updated_at',
].join(', ')

const SELECT_SAFE_COLUMNS_LEGACY = SELECT_SAFE_COLUMNS
  .split(',')
  .map(column => column.trim())
  .filter(column => column !== 'generation_mode')
  .join(', ')
const SELECT_SECRET_COLUMNS = `${SELECT_SAFE_COLUMNS}, encrypted_api_key`
const SELECT_SECRET_COLUMNS_LEGACY = `${SELECT_SAFE_COLUMNS_LEGACY}, encrypted_api_key`
const AI_GENERATION_MODES = new Set(['auto', 'primary', 'backup'])

export function envProviderConfig() {
  const provider = canonicalProviderKey(process.env.AI_PROVIDER?.trim() || DEFAULT_AI_PROVIDER)
  const baseUrl = process.env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL
  return enrichRuntimeProvider({
    id: null,
    provider,
    model: process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL,
    base_url: baseUrl,
    enabled: true,
    priority: 1,
    is_active: true,
    masked_key_preview: null,
    last_test_success: true,
    source: 'env',
    slot: 'primary',
  })
}

export async function getActiveAiProviderConfig() {
  const providers = await getAiProviderCandidates()
  return providers[0] || envProviderConfig()
}

export async function getAiProviderCandidates() {
  try {
    const rows = await listSecretProviderSettings()
    const { primary, backup } = selectProviderSlots(rows)
    const providers = []

    if (isRuntimeUsable(primary)) {
      providers.push(enrichRuntimeProvider({ ...sanitizeProviderConfig(primary), ...secretFields(primary), slot: 'primary', source: 'db' }))
    } else {
      providers.push(envProviderConfig())
    }

    if (backup && isRuntimeUsable(backup)) {
      providers.push(enrichRuntimeProvider({ ...sanitizeProviderConfig(backup), ...secretFields(backup), slot: 'backup', source: 'db' }))
    }

    console.info('[ai-provider-settings] primary/backup resolution', {
      primary: safeSlotSummary(primary),
      backup: safeSlotSummary(backup),
      runtime_order: providers.map(provider => ({
        slot: provider.slot,
        provider: provider.provider,
        provider_id: provider.id || null,
        source: provider.source,
        base_url: provider.base_url,
        model: provider.model,
      })),
    })

    return providers
  } catch (err) {
    console.warn('[ai-provider-settings] falling back to env configuration', {
      message: sanitizeLogMessage(err?.message),
    })
    return [envProviderConfig()]
  }
}

export async function getAiGenerationMode(rows = null) {
  try {
    const sourceRows = Array.isArray(rows) ? rows : await listSafeProviderRows()
    const { primary } = selectProviderSlots(sourceRows)
    return sanitizeGenerationMode(primary?.generation_mode || sourceRows.find(row => row?.generation_mode)?.generation_mode)
  } catch (err) {
    console.warn('[ai-provider-settings] generation mode fallback', {
      message: sanitizeLogMessage(err?.message),
    })
    return 'auto'
  }
}

export async function setAiGenerationMode(mode) {
  const generationMode = sanitizeGenerationMode(mode)
  const supabase = getSupabaseAdmin()
  const rows = await listSafeProviderRows()
  let target = selectProviderSlots(rows).primary || rows[0] || null

  if (!target) {
    const envConfig = envProviderConfig()
    const { data, error } = await supabase
      .from('ai_provider_settings')
      .insert({
        provider: envConfig.provider,
        model: envConfig.model,
        base_url: envConfig.base_url,
        enabled: true,
        priority: 1,
        is_active: true,
        generation_mode: generationMode,
      })
      .select(SELECT_SAFE_COLUMNS)
      .single()
    if (error) throw new Error(error.message)
    return { generationMode, setting: enrichSafeProvider(data, 'primary') }
  }

  const { data, error } = await supabase
    .from('ai_provider_settings')
    .update({ generation_mode: generationMode })
    .eq('id', target.id)
    .select(SELECT_SAFE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return { generationMode, setting: enrichSafeProvider(data, data?.is_active ? 'primary' : 'backup') }
}

export async function listAiProviderSettings() {
  const rows = await listSafeProviderRows()
  const { primary, backup } = selectProviderSlots(rows)
  return [primary, backup].filter(Boolean).map((row, index) => enrichSafeProvider(row, index === 0 ? 'primary' : 'backup'))
}

export async function getAiProviderRuntimeState() {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('submissions')
    .select('id, ai_feedback_at, ai_model, ai_evaluation')
    .eq('ai_status', 'ready')
    .not('ai_evaluation', 'is', null)
    .order('ai_feedback_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const provider = data?.ai_evaluation?.diagnostics?.ai_provider || null
  return {
    last_active_provider: provider?.final_provider_used || provider?.provider || null,
    last_active_provider_id: provider?.provider_id || null,
    last_active_model: data?.ai_model || null,
    last_fallback_used: Boolean(provider?.fallback_used),
    last_fallback_from: provider?.fallback_from || [],
    last_generated_at: data?.ai_feedback_at || null,
  }
}

export async function getAiProviderHealth() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('submissions')
    .select('ai_status, ai_feedback_at, ai_model, ai_evaluation')
    .in('ai_status', ['ready', 'failed'])
    .order('ai_feedback_at', { ascending: false })

  if (error) throw new Error(error.message)

  const providers = new Map()
  let unattributedFailures = 0

  for (const submission of data || []) {
    const diagnostics = submission?.ai_evaluation?.diagnostics?.ai_provider || null
    const provider = submission.ai_status === 'failed'
      ? diagnostics?.final_provider_attempted || null
      : diagnostics?.final_provider_used || diagnostics?.provider || null

    if (!provider) {
      if (submission.ai_status === 'failed') unattributedFailures += 1
      continue
    }

    const providerKey = canonicalProviderKey(provider)
    const model = sanitizeText(submission.ai_model || diagnostics?.model || 'Unknown model', 160)
    const key = `${providerKey}:${model}`
    const current = providers.get(key) || {
      provider: providerKey,
      provider_label: providerDisplayLabel(providerKey),
      model,
      generated: 0,
      failed: 0,
      fallback_used_count: 0,
      last_used_at: null,
      final_provider_name: providerDisplayLabel(providerKey),
    }

    if (submission.ai_status === 'ready') current.generated += 1
    if (submission.ai_status === 'failed') current.failed += 1
    if (diagnostics?.fallback_used) current.fallback_used_count += 1
    if (!current.last_used_at && submission.ai_feedback_at) current.last_used_at = submission.ai_feedback_at
    providers.set(key, current)
  }

  return {
    providers: [...providers.values()]
      .map(provider => {
        const total = provider.generated + provider.failed
        return {
          ...provider,
          success_percent: total ? Math.round((provider.generated / total) * 100) : 0,
        }
      })
      .sort((a, b) => b.success_percent - a.success_percent || b.generated - a.generated),
    unattributed_failures: unattributedFailures,
  }
}

export async function upsertAiProviderSetting(input) {
  const supabase = getSupabaseAdmin()
  const slot = input?.slot === 'backup' ? 'backup' : 'primary'
  const existingRows = await listSafeProviderRows()
  const { primary, backup } = selectProviderSlots(existingRows)
  const current = slot === 'primary' ? primary : backup
  const payload = sanitizeProviderConfig({
    ...(current || {}),
    ...input,
    enabled: true,
    priority: slot === 'primary' ? 1 : 2,
    is_active: slot === 'primary',
  })
  const dbPayload = toProviderDbPayload(payload)
  const apiKey = sanitizeApiKey(input?.api_key)

  if (apiKey) {
    dbPayload.encrypted_api_key = encryptSecret(apiKey)
    dbPayload.masked_key_preview = maskSecret(apiKey)
    dbPayload.last_test_success = false
    dbPayload.last_test_message = 'Retest required after API key update'
  }

  if (slot === 'primary') await clearActiveProviders(current?.id || input?.id || null)

  const id = input?.id || current?.id
  if (id) {
    const { data, error } = await supabase
      .from('ai_provider_settings')
      .update(dbPayload)
      .eq('id', id)
      .select(SELECT_SAFE_COLUMNS)
      .single()
    if (error) throw new Error(error.message)
    return enrichSafeProvider(data, slot)
  }

  const { data, error } = await supabase
    .from('ai_provider_settings')
    .insert(dbPayload)
    .select(SELECT_SAFE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return enrichSafeProvider(data, slot)
}

export async function setActiveAiProviderSetting(id) {
  if (!id) throw new Error('AI provider setting id is required')
  await clearActiveProviders(id)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .update({ is_active: true, enabled: true, priority: 1 })
    .eq('id', id)
    .select(SELECT_SAFE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return enrichSafeProvider(data, 'primary')
}

export async function deleteAiProviderSetting(id) {
  if (!id) throw new Error('AI provider setting id is required')
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('ai_provider_settings').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { id }
}

export async function getProviderApiKey(providerConfig) {
  if (providerConfig?.encrypted_api_key) {
    return {
      keyName: 'encrypted_api_key',
      apiKey: decryptSecret(providerConfig.encrypted_api_key),
      source: 'db',
    }
  }

  return getEnvProviderApiKey(providerConfig?.provider || providerConfig)
}

export function getEnvProviderApiKey(provider) {
  const keyName = providerKeyEnvName(provider)
  return {
    keyName,
    apiKey: keyName ? process.env[keyName] : '',
    source: 'env',
  }
}

export async function getSecretProviderSetting(id) {
  if (!id) return null
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .select(SELECT_SECRET_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

export async function recordProviderTestResult(id, result) {
  if (!id) return null
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_success: Boolean(result?.ok),
      last_test_message: sanitizeText(result?.message || result?.error || '', 300),
    })
    .eq('id', id)
    .select(SELECT_SAFE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return enrichSafeProvider(data, data?.is_active ? 'primary' : 'backup')
}

export function providerKeyEnvName(provider) {
  const normalized = canonicalProviderKey(provider)
  if (normalized === 'qwen') return 'QWEN_API_KEY'
  if (normalized === 'nemotron') return 'NEMOTRON_API_KEY'
  if (normalized === 'openrouter') return 'OPENROUTER_API_KEY'
  if (normalized === 'step') return 'STEP_API_KEY'
  return ''
}

export function sanitizeProviderConfig(input = {}) {
  const provider = canonicalProviderKey(input.provider || DEFAULT_AI_PROVIDER)
  const baseUrl = sanitizeBaseUrl(input.base_url || defaultBaseUrlForProvider(provider))
  return {
    id: input.id || null,
    provider,
    provider_label: providerDisplayLabel(provider),
    model: sanitizeText(input.model || DEFAULT_AI_MODEL, 160),
    base_url: baseUrl,
    generation_mode: sanitizeGenerationMode(input.generation_mode),
    infrastructure: resolveProviderInfrastructure({ provider, base_url: baseUrl }),
    enabled: input.enabled !== false,
    priority: clampInteger(input.priority ?? 1, 1, 2),
    is_active: Boolean(input.is_active),
  }
}

export function providerDisplayLabel(provider) {
  const key = canonicalProviderKey(provider)
  return PROVIDER_LABELS[key] || key
}

export function canonicalProviderKey(value) {
  const clean = sanitizeIdentifier(value || DEFAULT_AI_PROVIDER)
  return PROVIDER_ALIASES[clean] || clean
}

export function resolveProviderInfrastructure(config = {}) {
  const baseUrl = String(config.base_url || '').toLowerCase()
  const provider = canonicalProviderKey(config.provider)
  if (provider === 'openrouter' || baseUrl.includes('openrouter.ai')) return 'OpenRouter'
  if (provider === 'step' || baseUrl.includes('step') || baseUrl.includes('stepfun')) return 'Step official'
  if (baseUrl.includes('integrate.api.nvidia.com') || provider === 'qwen' || provider === 'nemotron') return 'NVIDIA'
  return 'OpenAI-compatible'
}

async function listSafeProviderRows() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .select(SELECT_SAFE_COLUMNS)
    .order('is_active', { ascending: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (isMissingGenerationModeColumn(error)) return listLegacySafeProviderRows(supabase)
  if (error) throw new Error(error.message)
  return data || []
}

async function listSecretProviderSettings() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .select(SELECT_SECRET_COLUMNS)
    .eq('enabled', true)
    .order('is_active', { ascending: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (isMissingGenerationModeColumn(error)) return listLegacySecretProviderRows(supabase)
  if (error) throw new Error(error.message)
  return data || []
}

async function listLegacySafeProviderRows(supabase) {
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .select(SELECT_SAFE_COLUMNS_LEGACY)
    .order('is_active', { ascending: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(row => ({ ...row, generation_mode: 'auto' }))
}

async function listLegacySecretProviderRows(supabase) {
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .select(SELECT_SECRET_COLUMNS_LEGACY)
    .eq('enabled', true)
    .order('is_active', { ascending: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(row => ({ ...row, generation_mode: 'auto' }))
}

function isMissingGenerationModeColumn(error) {
  const message = String(error?.message || '')
  return /generation_mode/i.test(message) && /does not exist|schema cache|could not find/i.test(message)
}

function selectProviderSlots(rows) {
  const activeRows = rows.filter(row => row.enabled !== false && row.is_active)
  const primary = activeRows[0] || rows.find(row => row.enabled !== false && Number(row.priority) === 1) || rows[0] || null
  const backup = rows.find(row => row.enabled !== false && row.id !== primary?.id && !row.is_active) || null
  return { primary, backup }
}

function isRuntimeUsable(row) {
  if (!row || row.enabled === false || !row.last_test_success) return false
  if (row.encrypted_api_key) return true
  return Boolean(getEnvProviderApiKey(row.provider).apiKey)
}

function secretFields(row) {
  return {
    id: row.id || null,
    encrypted_api_key: row.encrypted_api_key || null,
    masked_key_preview: row.masked_key_preview || null,
    last_test_success: Boolean(row.last_test_success),
  }
}

function enrichRuntimeProvider(provider) {
  const sanitized = sanitizeProviderConfig(provider)
  return {
    ...provider,
    ...sanitized,
    slot: provider.slot || (sanitized.is_active ? 'primary' : 'backup'),
    source: provider.source || 'db',
    resolution_source: provider.slot || (sanitized.is_active ? 'primary' : 'backup'),
  }
}

function enrichSafeProvider(row, slot) {
  const sanitized = sanitizeProviderConfig(row)
  return {
    ...row,
    provider: sanitized.provider,
    provider_label: sanitized.provider_label,
    infrastructure: sanitized.infrastructure,
    slot,
    role: slot === 'primary' ? 'Primary' : 'Backup',
    health_status: providerHealthStatus(row),
  }
}

function providerHealthStatus(setting) {
  if (!setting?.last_tested_at) return 'untested'
  if (setting?.last_test_success) return 'healthy'
  const message = String(setting?.last_test_message || '')
  if (/timeout/i.test(message)) return 'timeout'
  return 'failed'
}

function safeSlotSummary(row) {
  if (!row) return null
  return {
    provider: canonicalProviderKey(row.provider),
    provider_id: row.id || null,
    enabled: Boolean(row.enabled),
    last_test_success: Boolean(row.last_test_success),
    has_stored_key: Boolean(row.encrypted_api_key),
  }
}

function toProviderDbPayload(payload) {
  return {
    provider: payload.provider,
    model: payload.model,
    base_url: payload.base_url,
    enabled: true,
    priority: payload.priority,
    is_active: payload.is_active,
  }
}

async function clearActiveProviders(exceptId) {
  const supabase = getSupabaseAdmin()
  let query = supabase.from('ai_provider_settings').update({ is_active: false, priority: 2 })
  if (exceptId) query = query.neq('id', exceptId)
  const { error } = await query
  if (error) throw new Error(error.message)
}

function defaultBaseUrlForProvider(provider) {
  if (canonicalProviderKey(provider) === 'openrouter') return DEFAULT_OPENROUTER_BASE_URL
  return DEFAULT_AI_BASE_URL
}

function sanitizeIdentifier(value) {
  const clean = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return clean || DEFAULT_AI_PROVIDER
}

function sanitizeApiKey(value) {
  return String(value || '').trim()
}

function sanitizeText(value, limit) {
  return String(value || '').trim().slice(0, limit)
}

function sanitizeBaseUrl(value) {
  const text = sanitizeText(value, 300).replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(text)) return DEFAULT_AI_BASE_URL
  return text
}

function clampInteger(value, min, max) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function sanitizeGenerationMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase()
  return AI_GENERATION_MODES.has(mode) ? mode : 'auto'
}

function sanitizeLogMessage(message) {
  return String(message || '').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 300)
}
