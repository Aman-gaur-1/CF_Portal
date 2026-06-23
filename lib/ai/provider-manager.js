import { getAiGenerationMode, getAiProviderCandidates } from './provider-settings'
import { isProviderCooling, providerHealthSummary } from './runtime-state'

export async function resolveProviderOrder() {
  const providers = await getAiProviderCandidates()
  const generationMode = await getAiGenerationMode()
  const orderedProviders = applyGenerationMode(providers, generationMode)

  console.info('[ai-provider-manager] primary/backup order', {
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

function applyGenerationMode(providers, generationMode) {
  if (generationMode === 'primary') {
    const primary = providers.find(provider => provider.slot === 'primary') || providers[0]
    return primary ? [primary] : []
  }

  if (generationMode === 'backup') {
    const backup = providers.find(provider => provider.slot === 'backup')
    return backup ? [backup] : []
  }

  return [
    ...providers.filter(provider => !isProviderCooling(provider.provider)),
    ...providers.filter(provider => isProviderCooling(provider.provider)),
  ]
}

export function isFailoverEligibleError(err) {
  const message = err?.message || ''
  return (
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
  if (err?.status === 429 || /rate limit|quota/i.test(err.message || '')) return 'rate_limit'
  if (err?.status === 503 || /overloaded|unavailable/i.test(err.message || '')) return 'service_unavailable'
  if (err?.status === 504 || /timeout|aborted/i.test(err.message || '')) return 'timeout'
  if (err?.code === 'ResourceExhausted' || /resourceexhausted/i.test(err.message || '')) return 'resource_exhausted'
  if (/connection|network|fetch failed|econnreset|enotfound|socket/i.test(err.message || '')) return 'network'
  if (err?.status) return `http_${err.status}`
  return 'non_failover'
}
