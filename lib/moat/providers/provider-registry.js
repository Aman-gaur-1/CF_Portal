const SUPPORTED_PROVIDERS = new Set(['apify', 'outscraper', 'custom'])

export class ProviderRegistry {
  constructor(initialProviders = []) {
    this.providers = new Map()
    initialProviders.forEach(provider => this.registerProvider(provider))
  }

  registerProvider(provider) {
    const providerName = String(provider?.provider_name || provider?.name || '').trim()
    if (!SUPPORTED_PROVIDERS.has(providerName)) {
      throw new Error('Unsupported provider')
    }

    const normalized = {
      provider_name: providerName,
      enabled: provider?.enabled === true,
      status: provider?.status || 'not_configured',
      last_tested_at: provider?.last_tested_at || null,
    }
    this.providers.set(providerName, normalized)
    return normalized
  }

  getProvider(providerName) {
    return this.providers.get(providerName) || null
  }

  validateProvider(providerName) {
    const provider = this.getProvider(providerName)
    if (!provider) return { ok: false, status: 'missing', message: 'Provider is not registered.' }
    if (provider.status === 'error') return { ok: false, status: 'error', message: 'Provider connection test failed.' }
    if (provider.status === 'not_configured') return { ok: false, status: 'not_configured', message: 'Provider is not configured.' }
    if (!provider.enabled) return { ok: true, status: 'disabled', message: 'Provider is registered but disabled.' }
    return { ok: true, status: provider.status || 'ready', message: 'Provider is registered for future collection.' }
  }

  getStatus() {
    return [...this.providers.values()].map(provider => ({
      ...provider,
      health: this.validateProvider(provider.provider_name),
    }))
  }
}

export const SUPPORTED_PROVIDER_NAMES = [...SUPPORTED_PROVIDERS]

export function buildProviderRegistry(providers = []) {
  return new ProviderRegistry(providers)
}
