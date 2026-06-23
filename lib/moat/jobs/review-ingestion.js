import { getSupabaseAdmin } from '@/lib/supabase-server'
import { buildFallbackReviewHash, createApifyProvider, normalizeApifyReview, safeErrorMessage } from '@/lib/moat/providers/apify-provider'
import { enqueueIngestionJob, updateIngestionJobStatus } from './ingestion-queue'

const MAX_REVIEWS = 10
const MAX_BACKFILL_REVIEWS = 100
const COLLECTABLE_SOURCE_TYPES = ['google_maps']
const REVIEW_FILTERS = ['all', 'positive', 'negative', 'neutral', 'rating_gte_4', 'rating_lte_3', 'rating_lte_2']

export function isCollectableSourceProfile(sourceProfile) {
  return COLLECTABLE_SOURCE_TYPES.includes(sourceProfile?.source_type)
}

function assertScalerGoogleMaps(competitor, sourceProfile) {
  if (String(competitor?.slug || '').toLowerCase() !== 'scaler') {
    throw new Error('This POC only allows Scaler.')
  }
  if (sourceProfile?.source_type !== 'google_maps') {
    throw new Error('This POC only allows Google Maps.')
  }
}

async function getScalerGoogleMapsContext({ competitorId, sourceProfileId }) {
  const supabase = getSupabaseAdmin()

  const { data: competitor, error: competitorError } = await supabase
    .from('competitors')
    .select('id, name, slug, active')
    .eq('id', competitorId)
    .single()
  if (competitorError) throw competitorError

  const { data: sourceProfile, error: profileError } = await supabase
    .from('competitor_source_profiles')
    .select('id, competitor_id, source_type, profile_url, active')
    .eq('id', sourceProfileId)
    .eq('competitor_id', competitorId)
    .single()
  if (profileError) throw profileError

  assertScalerGoogleMaps(competitor, sourceProfile)
  if (competitor.active === false) throw new Error('Scaler competitor is inactive.')
  if (sourceProfile.active === false) throw new Error('Google Maps source profile is inactive.')
  if (!sourceProfile.profile_url) throw new Error('Google Maps source profile URL is required.')

  return { competitor, sourceProfile }
}

async function getSourceProfileContext({ sourceProfileId }) {
  const supabase = getSupabaseAdmin()

  const { data: sourceProfile, error: profileError } = await supabase
    .from('competitor_source_profiles')
    .select('id, competitor_id, source_type, profile_url, search_pattern, external_identifier, active, competitors(id, name, slug, active)')
    .eq('id', sourceProfileId)
    .single()
  if (profileError) throw profileError

  const competitor = sourceProfile?.competitors
  if (!competitor) throw new Error('Competitor source profile is missing competitor context.')
  if (competitor.active === false) throw new Error('Competitor is inactive.')
  if (sourceProfile.active === false) throw new Error('Source profile is inactive.')
  if (!isCollectableSourceProfile(sourceProfile)) {
    throw new Error(`Collection is not available for ${sourceProfile.source_type} source profiles yet.`)
  }
  if (!sourceProfile.profile_url) throw new Error('Source profile URL is required.')

  return { competitor, sourceProfile }
}

async function ensureReviewSource({ competitor, sourceProfile }) {
  const supabase = getSupabaseAdmin()
  const { data: existing, error: existingError } = await supabase
    .from('review_sources')
    .select('id, competitor_id, source_type, source_url, active')
    .eq('competitor_id', competitor.id)
    .eq('source_type', sourceProfile.source_type)
    .eq('source_url', sourceProfile.profile_url)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) return existing

  const { data, error } = await supabase
    .from('review_sources')
    .insert({
      competitor_id: competitor.id,
      source_type: sourceProfile.source_type,
      source_name: `${competitor.name} ${sourceProfile.source_type.replaceAll('_', ' ')}`,
      source_url: sourceProfile.profile_url,
      active: true,
      status: 'active',
      source_config: { source_profile_id: sourceProfile.id, seeded_by: 'moat_review_collection' },
    })
    .select('id, competitor_id, source_type, source_url, active')
    .single()
  if (error) throw error
  return data
}

async function findReviewSourceForProfile({ competitorId, sourceProfile }) {
  if (!sourceProfile?.profile_url) return null
  const { data, error } = await getSupabaseAdmin()
    .from('review_sources')
    .select('id, competitor_id, source_type, source_url, active')
    .eq('competitor_id', competitorId)
    .eq('source_type', sourceProfile.source_type)
    .eq('source_url', sourceProfile.profile_url)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function listExistingReviewKeys({ competitorId, sourceId }) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('competitor_reviews')
    .select('id, external_review_id, review_text, reviewed_at')
    .eq('competitor_id', competitorId)
    .eq('source_id', sourceId)
    .limit(5000)
  if (error) throw error

  return {
    externalIds: new Set((data || []).map(row => row.external_review_id).filter(Boolean)),
    fallbackHashes: new Set(
      (data || [])
        .map(row => buildFallbackReviewHash(row.review_text, row.reviewed_at))
        .filter(Boolean)
    ),
  }
}

async function insertReviews({ competitorId, sourceId, reviews }) {
  const supabase = getSupabaseAdmin()
  const existing = await listExistingReviewKeys({ competitorId, sourceId })
  const rows = []
  let duplicateCount = 0
  let failedCount = 0

  reviews.forEach(review => {
    const normalized = normalizeApifyReview(review)
    if (!normalized) {
      failedCount += 1
      return
    }

    const duplicateByExternalId = normalized.external_review_id && existing.externalIds.has(normalized.external_review_id)
    const duplicateByFallback = !normalized.external_review_id && existing.fallbackHashes.has(normalized.fallback_hash)
    if (duplicateByExternalId || duplicateByFallback) {
      duplicateCount += 1
      return
    }

    if (normalized.external_review_id) existing.externalIds.add(normalized.external_review_id)
    existing.fallbackHashes.add(normalized.fallback_hash)
    rows.push({
      competitor_id: competitorId,
      source_id: sourceId,
      external_review_id: normalized.external_review_id,
      rating: normalized.rating,
      review_text: normalized.review_text,
      review_url: normalized.review_url,
      reviewed_at: normalized.reviewed_at,
      collected_at: new Date().toISOString(),
      raw_payload: normalized.raw_payload,
    })
  })

  if (rows.length === 0) return { insertedCount: 0, duplicateCount, failedCount, sampleReview: null }

  const { data, error } = await supabase
    .from('competitor_reviews')
    .insert(rows)
    .select('id, external_review_id, rating, review_text, review_url, reviewed_at, collected_at')

  if (error) throw error
  return { insertedCount: data?.length || 0, duplicateCount, failedCount, sampleReview: data?.[0] || null }
}

function normalizeDateBound(value, boundary) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  if (boundary === 'end' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    date.setUTCHours(23, 59, 59, 999)
  }
  return date
}

function reviewMatchesFilter(normalized, { reviewFilter = 'all', startDate, endDate } = {}) {
  const rating = Number(normalized?.rating)
  const filter = REVIEW_FILTERS.includes(reviewFilter) ? reviewFilter : 'all'

  if (filter === 'positive' && !(rating >= 4)) return false
  if (filter === 'negative' && !(rating <= 2)) return false
  if (filter === 'neutral' && rating !== 3) return false
  if (filter === 'rating_gte_4' && !(rating >= 4)) return false
  if (filter === 'rating_lte_3' && !(rating <= 3)) return false
  if (filter === 'rating_lte_2' && !(rating <= 2)) return false

  const reviewedAt = normalized?.reviewed_at ? new Date(normalized.reviewed_at) : null
  const from = normalizeDateBound(startDate, 'start')
  const to = normalizeDateBound(endDate, 'end')
  if (from && (!reviewedAt || reviewedAt < from)) return false
  if (to && (!reviewedAt || reviewedAt > to)) return false

  return true
}

function filterFetchedReviews(reviews, options = {}) {
  let invalidCount = 0
  const filtered = []

  ;(reviews || []).forEach(review => {
    const normalized = normalizeApifyReview(review)
    if (!normalized) {
      invalidCount += 1
      return
    }
    if (reviewMatchesFilter(normalized, options)) filtered.push(review)
  })

  return {
    reviews: filtered,
    filteredOutCount: Math.max((reviews || []).length - filtered.length - invalidCount, 0),
    invalidCount,
  }
}

async function createAuditRow({ jobId, sourceId, fetchedCount, insertedCount, duplicateCount, failedCount }) {
  const { data, error } = await getSupabaseAdmin()
    .from('review_ingestion_audit')
    .insert({
      job_id: jobId,
      source_id: sourceId,
      fetched_count: fetchedCount,
      inserted_count: insertedCount,
      duplicate_count: duplicateCount,
      failed_count: failedCount,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function runScalerGoogleMapsSync({ competitorId, sourceProfileId, requestedBy }) {
  const { competitor, sourceProfile } = await getScalerGoogleMapsContext({ competitorId, sourceProfileId })
  const reviewSource = await ensureReviewSource({ competitor, sourceProfile })
  const provider = createApifyProvider()
  const providerStatus = provider.getStatus()
  if (!providerStatus.configured) throw new Error(providerStatus.message)

  const job = await enqueueIngestionJob({
    competitorId: competitor.id,
    sourceId: reviewSource.id,
    requestedBy,
    provider: 'apify',
  })

  try {
    await updateIngestionJobStatus({ jobId: job.id, createdAt: job.created_at, status: 'running' })
    const providerJob = provider.createJob({ sourceProfile, maxReviews: MAX_REVIEWS })
    const fetchedReviews = await provider.runJob(providerJob)
    const limitedReviews = fetchedReviews.slice(0, MAX_REVIEWS)
    const { insertedCount, duplicateCount, failedCount, sampleReview } = await insertReviews({
      competitorId: competitor.id,
      sourceId: reviewSource.id,
      reviews: limitedReviews,
    })

    const audit = await createAuditRow({
      jobId: job.id,
      sourceId: reviewSource.id,
      fetchedCount: limitedReviews.length,
      insertedCount,
      duplicateCount,
      failedCount,
    })

    const updatedJob = await updateIngestionJobStatus({
      jobId: job.id,
      createdAt: job.created_at,
      status: 'succeeded',
      reviewsCollected: insertedCount,
      errorMessage: null,
    })

    return {
      job: updatedJob,
      audit,
      sampleReview,
      fetchedCount: limitedReviews.length,
      insertedCount,
      duplicateCount,
      failedCount,
    }
  } catch (error) {
    const message = safeErrorMessage(error)
    await updateIngestionJobStatus({
      jobId: job.id,
      createdAt: job.created_at,
      status: 'failed',
      reviewsCollected: 0,
      errorMessage: message,
    }).catch(() => null)
    throw new Error(message)
  }
}

export async function runSourceProfileReviewSync({
  sourceProfileId,
  requestedBy,
  maxReviews = MAX_REVIEWS,
  collectionMode = 'incremental',
  reviewFilter = 'all',
  competitorScope = 'all',
  sourceScope = ['google_maps'],
  startDate = null,
  endDate = null,
} = {}) {
  const { competitor, sourceProfile } = await getSourceProfileContext({ sourceProfileId })
  const reviewSource = await ensureReviewSource({ competitor, sourceProfile })
  const provider = createApifyProvider()

  const job = await enqueueIngestionJob({
    competitorId: competitor.id,
    sourceId: reviewSource.id,
    requestedBy,
    provider: 'apify',
    metadata: {
      collection_mode: collectionMode,
      review_filter: reviewFilter,
      source_scope: sourceScope,
      competitor_scope: competitorScope,
      start_date: startDate,
      end_date: endDate,
      source_profile_id: sourceProfile.id,
      max_reviews: maxReviews,
    },
  })

  try {
    await updateIngestionJobStatus({ jobId: job.id, createdAt: job.created_at, status: 'running' })
    const providerStatus = provider.getStatus()
    if (!providerStatus.configured) throw new Error(providerStatus.message)
    const safeMaxReviews = Math.min(Number(maxReviews) || MAX_REVIEWS, MAX_BACKFILL_REVIEWS)
    const providerJob = provider.createJob({ sourceProfile, maxReviews: safeMaxReviews })
    const fetchedReviews = await provider.runJob(providerJob)
    const limitedReviews = fetchedReviews.slice(0, safeMaxReviews)
    const filtered = filterFetchedReviews(limitedReviews, { reviewFilter, startDate, endDate })
    const { insertedCount, duplicateCount, failedCount, sampleReview } = await insertReviews({
      competitorId: competitor.id,
      sourceId: reviewSource.id,
      reviews: filtered.reviews,
    })

    const audit = await createAuditRow({
      jobId: job.id,
      sourceId: reviewSource.id,
      fetchedCount: limitedReviews.length,
      insertedCount,
      duplicateCount,
      failedCount: failedCount + filtered.invalidCount,
    })

    const updatedJob = await updateIngestionJobStatus({
      jobId: job.id,
      createdAt: job.created_at,
      status: 'succeeded',
      reviewsCollected: insertedCount,
      errorMessage: null,
      resultSummary: {
        fetched_count: limitedReviews.length,
        filtered_out_count: filtered.filteredOutCount,
        inserted_count: insertedCount,
        duplicate_count: duplicateCount,
        failed_count: failedCount + filtered.invalidCount,
        collection_mode: collectionMode,
        review_filter: reviewFilter,
        start_date: startDate,
        end_date: endDate,
      },
    })

    return {
      competitor,
      sourceProfile,
      reviewSource,
      job: updatedJob,
      audit,
      sampleReview,
      fetchedCount: limitedReviews.length,
      filteredOutCount: filtered.filteredOutCount,
      insertedCount,
      duplicateCount,
      failedCount: failedCount + filtered.invalidCount,
    }
  } catch (error) {
    const message = safeErrorMessage(error)
    await updateIngestionJobStatus({
      jobId: job.id,
      createdAt: job.created_at,
      status: 'failed',
      reviewsCollected: 0,
      errorMessage: message,
    }).catch(() => null)
    const wrappedError = new Error(message)
    wrappedError.job = job
    throw wrappedError
  }
}

export async function hasSuccessfulCollectionForProfile({ competitorId, sourceProfile }) {
  if (!isCollectableSourceProfile(sourceProfile)) return false
  const reviewSource = await findReviewSourceForProfile({ competitorId, sourceProfile })
  if (!reviewSource?.id) return false

  const { data, error } = await getSupabaseAdmin()
    .from('scrape_jobs')
    .select('id')
    .eq('competitor_id', competitorId)
    .eq('source_id', reviewSource.id)
    .eq('status', 'succeeded')
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

export async function getScalerGoogleMapsSyncOptions() {
  const supabase = getSupabaseAdmin()
  const { data: competitors, error: competitorsError } = await supabase
    .from('competitors')
    .select('id, name, slug, active')
    .eq('slug', 'scaler')
    .limit(1)
  if (competitorsError) throw competitorsError

  const competitor = competitors?.[0] || null
  if (!competitor) return { competitor: null, sourceProfiles: [] }

  const { data: sourceProfiles, error: profilesError } = await supabase
    .from('competitor_source_profiles')
    .select('id, competitor_id, source_type, profile_url, active')
    .eq('competitor_id', competitor.id)
    .eq('source_type', 'google_maps')
    .order('created_at', { ascending: false })
  if (profilesError) throw profilesError

  return { competitor, sourceProfiles: sourceProfiles || [] }
}
