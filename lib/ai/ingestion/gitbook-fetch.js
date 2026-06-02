import { FETCH_TIMEOUT_MS, FETCH_USER_AGENT } from './constants.js'

/**
 * Fetch a URL as UTF-8 text with timeout and basic error handling.
 */
export async function fetchText(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/markdown, text/plain, text/html, */*',
        'User-Agent': FETCH_USER_AGENT,
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`)
    }

    return await response.text()
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout fetching ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Convert GitBook .md URL to canonical page URL (no .md suffix).
 */
export function mdUrlToPageUrl(mdUrl) {
  return String(mdUrl).replace(/\.md(\?.*)?$/i, '').split('?')[0]
}
