import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { loadMoatKpis } from '@/lib/moat/kpi-service'
import { moatJson, moatUnauthorized, requireMoatAdmin } from '@/lib/moat-api'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25
const MAX_METRIC_ROWS = 10000
const SORTS = new Set(['newest', 'oldest', 'highest_rating', 'lowest_rating', 'longest_review', 'shortest_review'])

function asTrimmed(value) {
  return String(value || '').trim()
}

function parsePage(value) {
  const page = Number.parseInt(value || '1', 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function parseRating(value) {
  const rating = Number.parseInt(value || '', 10)
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null
}

function parseSort(value) {
  const sort = asTrimmed(value)
  return SORTS.has(sort) ? sort : 'newest'
}

function normalizeDate(value, endOfDay = false) {
  const raw = asTrimmed(value)
  if (!raw) return null
  const date = new Date(endOfDay ? `${raw}T23:59:59.999Z` : `${raw}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function applyReviewFilters(query, filters) {
  let nextQuery = query
  if (filters.competitorId) nextQuery = nextQuery.eq('competitor_id', filters.competitorId)
  if (filters.sourceId) nextQuery = nextQuery.eq('source_id', filters.sourceId)
  if (filters.rating) nextQuery = nextQuery.eq('rating', filters.rating)
  if (filters.startDate) nextQuery = nextQuery.gte('reviewed_at', filters.startDate)
  if (filters.endDate) nextQuery = nextQuery.lte('reviewed_at', filters.endDate)
  if (filters.search) nextQuery = nextQuery.ilike('review_text', `%${filters.search}%`)
  return nextQuery
}

function sourceLabel(source) {
  return String(source?.source_name || source?.source_type || 'Unknown source').replace(/_/g, ' ')
}

function serializeReview(row) {
  return {
    id: row.id,
    competitor_id: row.competitor_id,
    source_id: row.source_id,
    external_review_id: row.external_review_id,
    rating: row.rating,
    review_text: row.review_text,
    review_url: row.review_url,
    reviewed_at: row.reviewed_at,
    collected_at: row.collected_at,
    raw_payload: row.raw_payload || {},
    competitor: row.competitors ? {
      id: row.competitors.id,
      name: row.competitors.name,
    } : null,
    source: row.review_sources ? {
      id: row.review_sources.id,
      type: row.review_sources.source_type,
      name: sourceLabel(row.review_sources),
      url: row.review_sources.source_url,
    } : null,
  }
}

function calculateMetrics(rows, totalReviews) {
  const ratings = rows
    .map(row => Number(row.rating))
    .filter(value => Number.isFinite(value))
  const averageRating = ratings.length
    ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2))
    : null

  return {
    total_reviews: totalReviews,
    average_rating: averageRating,
    competitors_covered: new Set(rows.map(row => row.competitor_id).filter(Boolean)).size,
    sources_covered: new Set(rows.map(row => row.source_id).filter(Boolean)).size,
  }
}

async function loadFilterOptions(supabase) {
  const [competitorsResult, sourcesResult] = await Promise.all([
    supabase
      .from('competitors')
      .select('id, name')
      .order('name', { ascending: true }),
    supabase
      .from('review_sources')
      .select('id, competitor_id, source_type, source_name, source_url, competitors(id, name)')
      .order('source_type', { ascending: true }),
  ])

  if (competitorsResult.error) throw competitorsResult.error
  if (sourcesResult.error) throw sourcesResult.error

  return {
    competitors: competitorsResult.data || [],
    sources: (sourcesResult.data || []).map(source => ({
      id: source.id,
      competitor_id: source.competitor_id,
      source_type: source.source_type,
      source_name: source.source_name,
      source_url: source.source_url,
      label: `${source.competitors?.name || 'Unknown competitor'} - ${sourceLabel(source)}`,
    })),
    ratings: [5, 4, 3, 2, 1],
  }
}

export async function GET(request) {
  noStore()
  if (!requireMoatAdmin(request)) return moatUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const page = parsePage(searchParams.get('page'))
    const sort = parseSort(searchParams.get('sort'))
    const filters = {
      competitorId: asTrimmed(searchParams.get('competitor_id')),
      sourceId: asTrimmed(searchParams.get('source_id')),
      rating: parseRating(searchParams.get('rating')),
      startDate: normalizeDate(searchParams.get('start_date')),
      endDate: normalizeDate(searchParams.get('end_date'), true),
      search: asTrimmed(searchParams.get('search')),
    }

    const supabase = getSupabaseAdmin()
    const metricQuery = applyReviewFilters(
      supabase
        .from('competitor_reviews')
        .select('id, competitor_id, source_id, rating')
        .limit(MAX_METRIC_ROWS),
      filters
    )
    const listQuery = applyReviewFilters(
      supabase
        .from('competitor_reviews')
        .select(`
          id,
          competitor_id,
          source_id,
          external_review_id,
          rating,
          review_text,
          review_url,
          reviewed_at,
          collected_at,
          raw_payload,
          competitors(id, name),
          review_sources(id, source_type, source_name, source_url)
        `, { count: 'exact' }),
      filters
    )

    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    let sortedListQuery = listQuery
    if (sort === 'oldest') {
      sortedListQuery = sortedListQuery.order('reviewed_at', { ascending: true, nullsFirst: false }).order('collected_at', { ascending: true, nullsFirst: false })
    } else if (sort === 'highest_rating') {
      sortedListQuery = sortedListQuery.order('rating', { ascending: false, nullsFirst: false }).order('reviewed_at', { ascending: false, nullsFirst: false })
    } else if (sort === 'lowest_rating') {
      sortedListQuery = sortedListQuery.order('rating', { ascending: true, nullsFirst: false }).order('reviewed_at', { ascending: false, nullsFirst: false })
    } else {
      sortedListQuery = sortedListQuery.order('reviewed_at', { ascending: false, nullsFirst: false }).order('collected_at', { ascending: false, nullsFirst: false })
    }

    const [filtersResult, metricsResult, reviewsResult, globalKpis] = await Promise.all([
      loadFilterOptions(supabase),
      metricQuery,
      sortedListQuery.range(from, to),
      loadMoatKpis(),
    ])

    if (metricsResult.error) throw metricsResult.error
    if (reviewsResult.error) throw reviewsResult.error

    const total = reviewsResult.count || 0
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    let reviews = (reviewsResult.data || []).map(serializeReview)
    if (sort === 'longest_review' || sort === 'shortest_review') {
      reviews = reviews.sort((a, b) => {
        const delta = String(b.review_text || '').length - String(a.review_text || '').length
        return sort === 'longest_review' ? delta : -delta
      })
    }

    return moatJson({
      metrics: calculateMetrics(metricsResult.data || [], total),
      global_kpis: globalKpis,
      filters: filtersResult,
      reviews,
      pagination: {
        page,
        page_size: PAGE_SIZE,
        total,
        total_pages: totalPages,
        has_previous: page > 1,
        has_next: page < totalPages,
      },
    })
  } catch (err) {
    console.error('[moat-reviews] load failed', err?.message)
    return moatJson({ error: err?.message || 'Could not load reviews' }, { status: 500 })
  }
}
