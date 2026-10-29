import { debugLog } from '@/lib/logger'
import { getAiGenerationMode, getAiProviderCandidates } from './provider-settings'
import { isProviderCooling, providerHealthSummary } from './runtime-state'

export async function resolveProviderOrder() {
  const providers = await getAiProviderCandidates()
  const generationMode = await getAiGenerationMode()
  const orderedProviders = applyGenerationMode(providers, generationMode)

  debugLog('[ai-provider-manager] primary/backup order', {
    count: orderedProviders.length,
    generation_mode: generationMode,
    order: orderedProviders.map((provider, index) => ({
      slot: provider.slot || (index === 0 ? 'primary' : 'backup'),
      provider: provider.provider,
      provider_id: provider.id || null,
      base_url: provider.base_url,
      model: provider.model,
      source: provider.source || 'unknown',
      health: providerHealthSummary(provider.provider),
    })),
  })
  return orderedProviders
}

export function applyGenerationMode(providers, generationMode) {
  if (generationMode === 'primary') {
    const primary = providers.find(provider => provider.slot === 'primary') || providers[0]
    if (primary) return [primary]
    const backup = providers.find(provider => provider.slot === 'backup') || providers[0]
    if (backup) {
      console.warn('[ai-provider-manager] primary mode requested without a primary; using backup candidate', {
        provider: backup.provider,
        slot: backup.slot || 'backup',
      })
      return [backup]
    }
    return []
  }

  if (generationMode === 'backup') {
    const backup = providers.find(provider => provider.slot === 'backup')
    if (backup) return [backup]
    const primary = providers.find(provider => provider.slot === 'primary') || providers[0]
    if (primary) {
      console.warn('[ai-provider-manager] backup mode requested without a usable backup; using primary candidate', {
        provider: primary.provider,
        slot: primary.slot || 'primary',
      })
      return [primary]
    }
    return []
  }

  return [
    ...providers.filter(provider => !isProviderCooling(provider.provider)),
    ...providers.filter(provider => isProviderCooling(provider.provider)),
  ]
}

export function isFailoverEligibleError(err) {
  const message = err?.message || ''
  return (
    err?.status === 401 ||
    err?.status === 403 ||
    err?.status === 404 ||
    err?.status === 410 ||
    /authorization|authentication|forbidden|invalid api key|model .*?(?:not found|unavailable)|function .*?not found|end of life|account .*?(?:unavailable|not found)|deployment .*?(?:unavailable|not found)/i.test(message) ||
    /resourceexhausted/i.test(message) ||
    /rate limit/i.test(message) ||
    /overloaded/i.test(message) ||
    /connection|network|fetch failed|econnreset|enotfound|socket/i.test(message) ||
    /timeout/i.test(message) ||
    err?.status === 429 ||
    err?.status === 503 ||
    err?.status === 504 ||
    err?.code === 'ResourceExhausted'
  )
}

export function classifyProviderFailure(err) {
  if (!err) return 'unknown'
  if (err?.status === 401 || err?.status === 403 || /authorization|authentication|forbidden|invalid api key/i.test(err.message || '')) return 'auth_failure'
  if (err?.status === 404 || err?.status === 410 || /model .*?(?:not found|unavailable)|function .*?not found|end of life|account .*?(?:unavailable|not found)|deployment .*?(?:unavailable|not found)/i.test(err.message || '')) return 'model_unavailable'
  if (err?.status === 429 || /rate limit|quota/i.test(err.message || '')) return 'rate_limit'
  if (err?.status === 503 || /overloaded|unavailable/i.test(err.message || '')) return 'service_unavailable'
  if (err?.status === 504 || /timeout|aborted/i.test(err.message || '')) return 'timeout'
  if (err?.code === 'ResourceExhausted' || /resourceexhausted/i.test(err.message || '')) return 'resource_exhausted'
  if (err?.code === 'AI_STRUCTURED_OUTPUT_INVALID' || /structured output|json parse|malformed json/i.test(err.message || '')) return 'parse_failure'
  if (/connection|network|fetch failed|econnreset|enotfound|socket/i.test(err.message || '')) return 'network'
  if (err?.status) return `http_${err.status}`
  return 'non_failover'
}
