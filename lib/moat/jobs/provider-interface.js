export const SCRAPER_PROVIDER_TYPES = ['apify', 'outscraper', 'custom']

export function createProviderDescriptor(type, label, capabilities = []) {
  if (!SCRAPER_PROVIDER_TYPES.includes(type)) {
    throw new Error(`Unsupported scraper provider: ${type}`)
  }

  return {
    type,
    label,
    capabilities,
    configured: false,
  }
}

export function getPluggableProviderCatalog() {
  return [
    createProviderDescriptor('apify', 'Apify', ['review_collection', 'place_lookup']),
    createProviderDescriptor('outscraper', 'Outscraper', ['review_collection', 'business_lookup']),
    createProviderDescriptor('custom', 'Custom Scraper', ['review_collection']),
  ]
}
