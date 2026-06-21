import { getPluggableProviderCatalog } from './provider-interface'

export function getIngestionProviderCatalog() {
  return getPluggableProviderCatalog()
}

export async function runIngestionJob() {
  throw new Error('Ingestion providers are not connected yet')
}
