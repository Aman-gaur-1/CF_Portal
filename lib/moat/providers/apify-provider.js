import crypto from 'crypto'

const DEFAULT_ACTOR_ID = 'compass~google-maps-reviews-scraper'
const DEFAULT_MAX_REVIEWS = 10
const PROVIDER_MAX_REVIEWS = 100
const APIFY_BASE_URL = 'https://api.apify.com/v2'

function resolveApifyToken() {
  return String(process.env.APIFY_TOKEN || '').trim()
}

function safeErrorMessage(error) {
  return String(error?.message || 'Apify request failed').replace(resolveApifyToken(), '[redacted]')
}

function pickReviewText(item) {
  return String(item?.text || item?.textTranslated || item?.review_text || '').trim()
}

function parseReviewedAt(item) {
  const value = item?.publishedAtDate || item?.reviewedAt || item?.date
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeRating(item) {
  const value = item?.stars ?? item?.rating
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sanitizeRawPayload(item) {
  return {
    reviewId: item?.reviewId || null,
    rating: normalizeRating(item),
    text: pickReviewText(item),
    publishedAtDate: item?.publishedAtDate || null,
    reviewUrl: item?.reviewUrl || null,
    reviewOrigin: item?.reviewOrigin || null,
    originalLanguage: item?.originalLanguage || null,
    translatedLanguage: item?.translatedLanguage || null,
    scrapedAt: item?.scrapedAt || null,
  }
}

export function buildFallbackReviewHash(reviewText, reviewedAt) {
  return crypto
    .createHash('sha256')
    .update(`${String(reviewText || '').trim()}|${String(reviewedAt || '')}`)
    .digest('hex')
}

export function normalizeApifyReview(item) {
  const reviewText = pickReviewText(item)
  const reviewedAt = parseReviewedAt(item)
  if (!reviewText) return null

  return {
    external_review_id: item?.reviewId ? String(item.reviewId) : null,
    rating: normalizeRating(item),
    review_text: reviewText,
    review_url: item?.reviewUrl ? String(item.reviewUrl) : null,
    reviewed_at: reviewedAt,
    raw_payload: sanitizeRawPayload(item),
    fallback_hash: buildFallbackReviewHash(reviewText, reviewedAt),
  }
}

export class ApifyProvider {
  constructor({ actorId = DEFAULT_ACTOR_ID, token = resolveApifyToken(), fetchImpl = fetch } = {}) {
    this.actorId = actorId
    this.token = token
    this.fetchImpl = fetchImpl
  }

  validateConfig() {
    if (!this.token) return { ok: false, status: 'missing_token', message: 'APIFY_TOKEN is not configured.' }
    return { ok: true, status: 'ready', message: 'Apify provider is configured.' }
  }

  async testConnection() {
    const config = this.validateConfig()
    if (!config.ok) return config

    try {
      const res = await this.fetchImpl(`${APIFY_BASE_URL}/users/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
      })
      const payload = await res.json().catch(() => ({}))

      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: 'invalid_token', message: 'Apify token is invalid.' }
      }
      if (!res.ok) {
        return { ok: false, status: 'error', message: payload?.error?.message || `Apify API returned ${res.status}.` }
      }

      return {
        ok: true,
        status: 'ready',
        message: 'Apify API is reachable.',
        providerStatus: {
          id: payload?.data?.id || null,
          username: payload?.data?.username || null,
        },
      }
    } catch (error) {
      return { ok: false, status: 'error', message: safeErrorMessage(error) }
    }
  }

  createJob({ sourceProfile, maxReviews = DEFAULT_MAX_REVIEWS }) {
    if (!sourceProfile?.profile_url) throw new Error('Google Maps source profile URL is required')
    if (sourceProfile.source_type !== 'google_maps') throw new Error('Apify POC only supports Google Maps source profiles')
    const safeMaxReviews = Math.min(Number(maxReviews) || DEFAULT_MAX_REVIEWS, PROVIDER_MAX_REVIEWS)

    return {
      actorId: this.actorId,
      maxReviews: safeMaxReviews,
      input: {
        startUrls: [{ url: sourceProfile.profile_url }],
        maxReviews: safeMaxReviews,
        reviewsSort: 'newest',
        reviewsOrigin: 'google',
        language: 'en',
        personalData: false,
      },
    }
  }

  async runJob(job) {
    const config = this.validateConfig()
    if (!config.ok) throw new Error(config.message)

    const url = new URL(`${APIFY_BASE_URL}/actors/${encodeURIComponent(job.actorId)}/run-sync-get-dataset-items`)
    url.searchParams.set('token', this.token)
    url.searchParams.set('timeout', '240')
    url.searchParams.set('maxItems', String(job.maxReviews || DEFAULT_MAX_REVIEWS))
    url.searchParams.set('format', 'json')

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job.input),
    })

    const text = await res.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : []
    } catch {
      payload = text
    }

    if (!res.ok) {
      throw new Error(`Apify actor failed with ${res.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`)
    }

    return Array.isArray(payload) ? payload : []
  }

  getStatus() {
    const validation = this.validateConfig()
    return {
      provider_name: 'apify',
      actor_id: this.actorId,
      configured: validation.ok,
      status: validation.status,
      message: validation.message,
    }
  }
}

export function createApifyProvider(options = {}) {
  return new ApifyProvider(options)
}

export { safeErrorMessage }
