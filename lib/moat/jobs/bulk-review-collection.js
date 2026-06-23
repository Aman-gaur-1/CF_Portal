import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  hasSuccessfulCollectionForProfile,
  isCollectableSourceProfile,
  runSourceProfileReviewSync,
} from './review-ingestion'

export const DAILY_SYNC_SCHEDULE = '0 2 * * *'

const DEFAULT_MAX_PROFILES_PER_RUN = 100
const MAX_PROFILES_PER_RUN = 100
const MAX_REVIEWS_PER_PROFILE = 10
const BACKFILL_MAX_REVIEWS_PER_PROFILE = 100
const DETAIL_LIMIT = 25
export const SUPPORTED_SOURCE_TYPES = ['google_maps', 'trustpilot', 'reddit', 'youtube', 'quora', 'website']

function nowIso() {
  return new Date().toISOString()
}

function safeLimit(value, fallback = DEFAULT_MAX_PROFILES_PER_RUN) {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, MAX_PROFILES_PER_RUN)
}

function normalizeIdList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  return String(value).split(',').map(item => item.trim()).filter(Boolean)
}

function normalizeSourceTypes(value) {
  const items = normalizeIdList(value)
  if (items.length === 0 || items.includes('all')) return SUPPORTED_SOURCE_TYPES
  return items.filter(item => SUPPORTED_SOURCE_TYPES.includes(item))
}

export function normalizeCollectionOptions(options = {}) {
  const collectionMode = ['incremental', 'historical_backfill', 'date_range'].includes(options.collectionMode)
    ? options.collectionMode
    : 'incremental'
  const competitorIds = normalizeIdList(options.competitorIds)
  const sourceTypes = normalizeSourceTypes(options.sourceTypes)
  return {
    collectionMode,
    reviewFilter: options.reviewFilter || 'all',
    competitorScope: competitorIds.length === 0 ? 'all' : competitorIds.length === 1 ? 'selected' : 'multiple',
    competitorIds,
    sourceTypes,
    startDate: collectionMode === 'date_range' ? options.startDate || null : null,
    endDate: collectionMode === 'date_range' ? options.endDate || null : null,
  }
}

function summarizeProfile(profile) {
  return {
    id: profile.id,
    source_type: profile.source_type,
    profile_url: profile.profile_url,
    competitor: profile.competitors ? {
      id: profile.competitors.id,
      name: profile.competitors.name,
      slug: profile.competitors.slug,
    } : null,
  }
}

async function listActiveSourceProfiles({ limit, competitorIds = [], sourceTypes = SUPPORTED_SOURCE_TYPES }) {
  let query = getSupabaseAdmin()
    .from('competitor_source_profiles')
    .select('id, competitor_id, source_type, profile_url, search_pattern, external_identifier, active, competitors(id, name, slug, active)')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(Math.max(limit * 2, MAX_PROFILES_PER_RUN))

  if (competitorIds.length > 0) query = query.in('competitor_id', competitorIds)
  if (sourceTypes.length > 0 && sourceTypes.length < SUPPORTED_SOURCE_TYPES.length) query = query.in('source_type', sourceTypes)

  const { data, error } = await query
  if (error) throw error
  return (data || []).filter(profile => profile.competitors?.active !== false)
}

export async function collectReviewsForProfiles({
  mode = 'all',
  requestedBy = 'admin',
  limit,
  collectionMode,
  reviewFilter,
  competitorIds,
  sourceTypes,
  startDate,
  endDate,
} = {}) {
  const startedAt = Date.now()
  const maxProfiles = safeLimit(limit)
  const options = normalizeCollectionOptions({
    collectionMode: mode === 'daily' ? 'incremental' : collectionMode,
    reviewFilter: mode === 'daily' ? 'all' : reviewFilter,
    competitorIds: mode === 'daily' ? [] : competitorIds,
    sourceTypes,
    startDate,
    endDate,
  })
  const maxReviewsPerProfile = options.collectionMode === 'historical_backfill' || options.collectionMode === 'date_range'
    ? BACKFILL_MAX_REVIEWS_PER_PROFILE
    : MAX_REVIEWS_PER_PROFILE
  const profiles = await listActiveSourceProfiles({
    limit: maxProfiles,
    competitorIds: options.competitorIds,
    sourceTypes: options.sourceTypes,
  })
  const summary = {
    mode,
    collection_mode: options.collectionMode,
    review_filter: options.reviewFilter,
    competitor_scope: options.competitorScope,
    source_scope: options.sourceTypes,
    start_date: options.startDate,
    end_date: options.endDate,
    processed_profiles: 0,
    jobs_created: 0,
    reviews_fetched: 0,
    reviews_inserted: 0,
    filtered_out: 0,
    duplicates: 0,
    failed: 0,
    skipped: 0,
    started_at: nowIso(),
    completed_at: null,
    duration_ms: 0,
    details: [],
  }

  for (const profile of profiles) {
    if (summary.processed_profiles >= maxProfiles) break

    if (!isCollectableSourceProfile(profile)) {
      summary.skipped += 1
      if (summary.details.length < DETAIL_LIMIT) {
        summary.details.push({
          ...summarizeProfile(profile),
          status: 'skipped',
          reason: `No review collector is available for ${profile.source_type} yet.`,
          provider_status: 'Configured but provider not available.',
        })
      }
      continue
    }

    if (mode === 'missing') {
      const hasSuccessfulCollection = await hasSuccessfulCollectionForProfile({
        competitorId: profile.competitor_id,
        sourceProfile: profile,
      })
      if (hasSuccessfulCollection) {
        summary.skipped += 1
        if (summary.details.length < DETAIL_LIMIT) {
          summary.details.push({
            ...summarizeProfile(profile),
            status: 'skipped',
            reason: 'A successful collection already exists for this source profile.',
          })
        }
        continue
      }
    }

    summary.processed_profiles += 1

    try {
      const result = await runSourceProfileReviewSync({
        sourceProfileId: profile.id,
        requestedBy,
        maxReviews: maxReviewsPerProfile,
        collectionMode: options.collectionMode,
        reviewFilter: options.reviewFilter,
        competitorScope: options.competitorScope,
        sourceScope: options.sourceTypes,
        startDate: options.startDate,
        endDate: options.endDate,
      })
      summary.jobs_created += 1
      summary.reviews_fetched += result.fetchedCount || 0
      summary.reviews_inserted += result.insertedCount || 0
      summary.filtered_out += result.filteredOutCount || 0
      summary.duplicates += result.duplicateCount || 0
      if (summary.details.length < DETAIL_LIMIT) {
        summary.details.push({
          ...summarizeProfile(profile),
          status: 'succeeded',
          job_id: result.job?.id || null,
          fetched_count: result.fetchedCount || 0,
          filtered_out_count: result.filteredOutCount || 0,
          inserted_count: result.insertedCount || 0,
          duplicate_count: result.duplicateCount || 0,
        })
      }
    } catch (error) {
      if (error?.job?.id) summary.jobs_created += 1
      summary.failed += 1
      if (summary.details.length < DETAIL_LIMIT) {
        summary.details.push({
          ...summarizeProfile(profile),
          status: 'failed',
          error: error?.message || 'Collection failed for this source profile.',
        })
      }
    }
  }

  summary.completed_at = nowIso()
  summary.duration_ms = Date.now() - startedAt
  return summary
}

function nextDailySyncIso(now = new Date()) {
  const next = new Date(now)
  next.setUTCHours(2, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString()
}

export async function getReviewAutoSyncStatus() {
  const { data, error } = await getSupabaseAdmin()
    .from('scrape_jobs')
    .select('id, status, created_at, completed_at, reviews_collected, job_type')
    .eq('job_type', 'review_sync')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error

  const jobs = data || []
  const latestFinished = jobs.find(job => job.completed_at)
  const lastSyncTime = latestFinished?.completed_at || jobs[0]?.created_at || null
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const recentJobs = jobs.filter(job => {
    const value = job.completed_at || job.created_at
    const time = value ? new Date(value).getTime() : 0
    return Number.isFinite(time) && time >= cutoff
  })

  return {
    enabled: true,
    cadence: 'daily',
    schedule: DAILY_SYNC_SCHEDULE,
    last_sync_time: lastSyncTime,
    next_scheduled_sync: nextDailySyncIso(),
    profiles_processed: recentJobs.length,
    reviews_collected: recentJobs.reduce((sum, job) => sum + (Number(job.reviews_collected) || 0), 0),
  }
}
