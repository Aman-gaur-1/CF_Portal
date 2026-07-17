import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getReviewAutoSyncStatus } from './jobs/bulk-review-collection'

async function countRows(supabase, table, configure = query => query) {
  const query = configure(supabase.from(table).select('id', { count: 'exact', head: true }))
  const { count, error } = await query
  if (error) throw error
  return count || 0
}

async function latestRow(supabase, table, columns, dateColumn, configure = query => query) {
  const query = configure(
    supabase
      .from(table)
      .select(columns)
      .order(dateColumn, { ascending: false, nullsFirst: false })
      .limit(1)
  )
  const { data, error } = await query
  if (error) throw error
  return data?.[0] || null
}

function healthStatus(ok, warning = false) {
  if (!ok) return 'Warning'
  return warning ? 'Pending' : 'Healthy'
}

export async function loadMoatKpis() {
  const supabase = getSupabaseAdmin()
  const [
    competitors,
    sources,
    sourceProfiles,
    collectedReviews,
    analyzedReviews,
    opportunities,
    alerts,
    demandSignals,
    marketGaps,
    providersReady,
    providersTotal,
    latestCollection,
    latestAnalysis,
    autoSync,
  ] = await Promise.all([
    countRows(supabase, 'competitors', query => query.eq('active', true)),
    countRows(supabase, 'review_sources', query => query.eq('active', true)),
    countRows(supabase, 'competitor_source_profiles', query => query.eq('active', true)),
    countRows(supabase, 'competitor_reviews'),
    countRows(supabase, 'review_analysis', query => query.eq('status', 'ready')),
    countRows(supabase, 'competitor_insights', query => query.eq('status', 'active')),
    countRows(supabase, 'alerts'),
    countRows(supabase, 'competitor_insights', query => query.eq('status', 'active').eq('insight_type', 'market_demand')),
    countRows(supabase, 'competitor_insights', query => query.eq('status', 'active').eq('insight_type', 'market_gap')),
    countRows(supabase, 'provider_configs', query => query.eq('enabled', true).eq('status', 'ready')),
    countRows(supabase, 'provider_configs'),
    latestRow(supabase, 'scrape_jobs', 'id, status, created_at, started_at, completed_at, reviews_collected', 'created_at', query => query.eq('job_type', 'review_sync')),
    latestRow(supabase, 'review_analysis', 'id, review_id, status, analyzed_at, created_at', 'analyzed_at', query => query.eq('status', 'ready')),
    getReviewAutoSyncStatus(),
  ])

  const pendingAnalysis = Math.max(collectedReviews - analyzedReviews, 0)
  const reviewCoverage = collectedReviews ? Math.round((analyzedReviews / collectedReviews) * 100) : 0
  const competitorCoverage = competitors ? Math.round((sourceProfiles / competitors) * 100) : 0

  return {
    generated_at: new Date().toISOString(),
    competitors,
    sources,
    source_profiles: sourceProfiles,
    collected_reviews: collectedReviews,
    analyzed_reviews: analyzedReviews,
    pending_analysis: pendingAnalysis,
    opportunities,
    alerts,
    demand_signals: demandSignals,
    market_gaps: marketGaps,
    auto_sync: autoSync,
    provider_health: {
      ready: providersReady,
      total: providersTotal,
      status: providersReady > 0 ? 'Ready' : 'Offline',
    },
    last_collection: latestCollection,
    last_analysis: latestAnalysis,
    next_auto_sync: autoSync?.next_scheduled_sync || null,
    health: {
      collection: healthStatus(collectedReviews > 0, sourceProfiles === 0),
      analysis: healthStatus(analyzedReviews > 0 || collectedReviews === 0, pendingAnalysis > 0),
      providers: providersReady > 0 ? 'Ready' : 'Offline',
      daily_sync: autoSync?.enabled ? 'Enabled' : 'Disabled',
      reviews_pending_analysis: pendingAnalysis,
      review_coverage: reviewCoverage,
      competitor_coverage: competitorCoverage,
    },
  }
}
