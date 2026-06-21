import { getSupabaseAdmin } from '@/lib/supabase-server'
import { loadMoatOpportunities } from './opportunity-engine'
import { paginateMoatArray } from './response-limits'

const ALERT_TYPES = [
  'New Competitor Detected',
  'Review Volume Spike',
  'Negative Sentiment Spike',
  'New Weakness Detected',
  'New Opportunity Detected',
  'Emerging Theme',
  'Category Growth',
  'Competitor Activity Increase',
]
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low']
const CATEGORY_LABELS = {
  curriculum: 'Curriculum',
  placements: 'Placements',
  mentorship: 'Mentorship',
  pricing: 'Pricing',
  community: 'Community',
  projects: 'Projects',
  support: 'Support',
  career_growth: 'Career Growth',
  outcomes: 'Outcomes',
  other: 'Other',
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function severityFromScore(score) {
  if (score >= 90) return 'Critical'
  if (score >= 70) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase()
}

function latestDate(values) {
  const times = values
    .map(value => value ? new Date(value).getTime() : NaN)
    .filter(value => Number.isFinite(value))
  return times.length ? new Date(Math.max(...times)).toISOString() : new Date().toISOString()
}

function evidenceCount(item) {
  return Number(item?.count || item?.total || item?.evidence_count || 1) || 1
}

function buildAlert({
  key,
  title,
  description,
  alertType,
  competitor,
  competitorId,
  confidence,
  evidenceCount,
  severityScore,
  createdAt,
  supportingEvidence = [],
  sourceInsights = [],
  relatedOpportunities = [],
  categories = [],
}) {
  return {
    id: `${competitorId || 'global'}-${key}`.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase(),
    title,
    description,
    alert_type: alertType,
    severity: severityFromScore(severityScore),
    severity_score: Math.min(100, Math.max(0, Math.round(severityScore))),
    confidence: Number(Math.min(1, Math.max(0, confidence || 0)).toFixed(4)),
    competitor,
    competitor_id: competitorId,
    evidence_count: evidenceCount,
    created_at: createdAt || new Date().toISOString(),
    supporting_evidence: supportingEvidence,
    source_insights: sourceInsights,
    related_opportunities: relatedOpportunities,
    supporting_categories: unique(categories),
  }
}

function groupByCompetitor(reviews, analyses, insights, opportunities) {
  const map = new Map()
  function ensure(competitorId, competitorName) {
    if (!competitorId) return null
    if (!map.has(competitorId)) {
      map.set(competitorId, {
        competitor_id: competitorId,
        competitor: competitorName || 'Unknown competitor',
        reviews: [],
        analyses: [],
        insights: [],
        opportunities: [],
      })
    }
    const row = map.get(competitorId)
    if (competitorName && row.competitor === 'Unknown competitor') row.competitor = competitorName
    return row
  }

  reviews.forEach(review => ensure(review.competitor_id, review.competitors?.name)?.reviews.push(review))
  analyses.forEach(analysis => ensure(analysis.review?.competitor_id, analysis.review?.competitors?.name)?.analyses.push(analysis))
  insights.forEach(insight => ensure(insight.competitor_id, insight.competitors?.name)?.insights.push(insight))
  opportunities.forEach(opportunity => ensure(opportunity.competitor_id, opportunity.competitor)?.opportunities.push(opportunity))
  return [...map.values()]
}

function sourceInsightRef(insight) {
  return {
    insight_id: insight.id,
    insight_type: insight.insight_type,
    title: insight.title,
    summary: insight.summary,
    confidence: insight.confidence,
  }
}

function relatedOpportunityRef(opportunity) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    category: opportunity.category,
    priority: opportunity.priority,
    confidence_score: opportunity.confidence_score,
    evidence_count: opportunity.evidence_count,
  }
}

function reviewEvidence(review) {
  return {
    review_id: review.id,
    rating: review.rating,
    reviewed_at: review.reviewed_at,
    excerpt: String(review.review_text || '').slice(0, 180),
  }
}

function alertsForCompetitor(group) {
  const alerts = []
  const reviewCount = group.reviews.length
  const readyAnalyses = group.analyses.filter(row => row.status === 'ready')
  const negativeAnalyses = readyAnalyses.filter(row => row.sentiment === 'negative')
  const activeInsights = group.insights.filter(row => row.status === 'active')
  const latestActivity = latestDate([
    ...group.reviews.map(row => row.collected_at || row.reviewed_at),
    ...activeInsights.map(row => row.created_at),
  ])

  if (reviewCount > 0) {
    alerts.push(buildAlert({
      key: 'new-competitor-detected',
      title: `${group.competitor} is active in Moat`,
      description: `${group.competitor} has collected reviews and intelligence signals available for monitoring.`,
      alertType: 'New Competitor Detected',
      competitor: group.competitor,
      competitorId: group.competitor_id,
      confidence: Math.min(1, reviewCount / 5),
      evidenceCount: reviewCount,
      severityScore: 30 + Math.min(reviewCount, 10) * 4,
      createdAt: latestActivity,
      supportingEvidence: group.reviews.slice(0, 5).map(reviewEvidence),
    }))
  }

  if (reviewCount >= 5) {
    alerts.push(buildAlert({
      key: 'review-volume-spike',
      title: `${group.competitor} review volume spike`,
      description: `${reviewCount} reviews are available for ${group.competitor}, enough to surface current competitor movement.`,
      alertType: 'Review Volume Spike',
      competitor: group.competitor,
      competitorId: group.competitor_id,
      confidence: Math.min(1, reviewCount / 10),
      evidenceCount: reviewCount,
      severityScore: 45 + Math.min(reviewCount, 12) * 4,
      createdAt: latestActivity,
      supportingEvidence: group.reviews.slice(0, 5).map(reviewEvidence),
    }))
  }

  if (negativeAnalyses.length > 0) {
    const ratio = negativeAnalyses.length / Math.max(readyAnalyses.length, 1)
    alerts.push(buildAlert({
      key: 'negative-sentiment-spike',
      title: `${group.competitor} negative sentiment spike`,
      description: `${negativeAnalyses.length} analyzed reviews are negative, indicating a competitor weakness window.`,
      alertType: 'Negative Sentiment Spike',
      competitor: group.competitor,
      competitorId: group.competitor_id,
      confidence: Math.min(1, ratio + 0.35),
      evidenceCount: negativeAnalyses.length,
      severityScore: 50 + ratio * 45 + Math.min(negativeAnalyses.length, 6) * 4,
      createdAt: latestActivity,
      supportingEvidence: negativeAnalyses.slice(0, 5).map(row => ({
        review_id: row.review_id,
        sentiment: row.sentiment,
        score: row.sentiment_score,
        themes: row.raw_output?.complaint_themes || [],
      })),
    }))
  }

  activeInsights
    .filter(insight => insight.insight_type === 'competitor_weaknesses' && insight.summary && insight.summary !== 'No strong signal yet')
    .forEach(insight => {
      const count = Array.isArray(insight.evidence) ? insight.evidence.reduce((sum, item) => sum + evidenceCount(item), 0) : 1
      alerts.push(buildAlert({
        key: `new-weakness-${insight.id}`,
        title: `${group.competitor} weakness detected`,
        description: insight.summary,
        alertType: 'New Weakness Detected',
        competitor: group.competitor,
        competitorId: group.competitor_id,
        confidence: Number(insight.confidence || 0.35),
        evidenceCount: count,
        severityScore: 42 + Number(insight.confidence || 0) * 35 + Math.min(count, 6) * 5,
        createdAt: insight.created_at,
        supportingEvidence: insight.evidence || [],
        sourceInsights: [sourceInsightRef(insight)],
        relatedOpportunities: group.opportunities.filter(item => item.priority === 'High').slice(0, 4).map(relatedOpportunityRef),
      }))
    })

  activeInsights
    .filter(insight => insight.insight_type === 'emerging_themes' && insight.summary && insight.summary !== 'No strong signal yet')
    .forEach(insight => {
      const evidence = insight.evidence || []
      alerts.push(buildAlert({
        key: `emerging-theme-${insight.id}`,
        title: `${group.competitor} emerging theme`,
        description: insight.summary,
        alertType: 'Emerging Theme',
        competitor: group.competitor,
        competitorId: group.competitor_id,
        confidence: Number(insight.confidence || 0.3),
        evidenceCount: evidence.reduce((sum, item) => sum + evidenceCount(item), 0) || evidence.length || 1,
        severityScore: 40 + Number(insight.confidence || 0) * 30 + Math.min(evidence.length, 5) * 6,
        createdAt: insight.created_at,
        supportingEvidence: evidence,
        sourceInsights: [sourceInsightRef(insight)],
        relatedOpportunities: group.opportunities.slice(0, 4).map(relatedOpportunityRef),
      }))
    })

  group.opportunities
    .filter(opportunity => opportunity.priority === 'High')
    .slice(0, 8)
    .forEach(opportunity => {
      alerts.push(buildAlert({
        key: `new-opportunity-${opportunity.id}`,
        title: `${opportunity.title} detected`,
        description: opportunity.description,
        alertType: 'New Opportunity Detected',
        competitor: group.competitor,
        competitorId: group.competitor_id,
        confidence: opportunity.confidence_score,
        evidenceCount: opportunity.evidence_count,
        severityScore: 45 + Number(opportunity.confidence_score || 0) * 35 + Math.min(opportunity.evidence_count || 0, 8) * 4,
        createdAt: latestActivity,
        supportingEvidence: opportunity.supporting_signals || [],
        sourceInsights: opportunity.source_insight_references || [],
        relatedOpportunities: [relatedOpportunityRef(opportunity)],
        categories: [opportunity.category],
      }))
    })

  const categoryCounts = new Map()
  readyAnalyses.forEach(analysis => {
    Object.keys(analysis.category_scores || {}).forEach(category => {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
    })
  })
  ;[...categoryCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .forEach(([category, count]) => {
      const label = CATEGORY_LABELS[category] || category
      alerts.push(buildAlert({
        key: `category-growth-${category}`,
        title: `${label} category growth`,
        description: `${count} analyzed reviews mention ${label}, showing a growing competitor signal.`,
        alertType: 'Category Growth',
        competitor: group.competitor,
        competitorId: group.competitor_id,
        confidence: Math.min(1, count / Math.max(readyAnalyses.length, 1) + 0.25),
        evidenceCount: count,
        severityScore: 35 + Math.min(count, 8) * 7,
        createdAt: latestActivity,
        supportingEvidence: readyAnalyses
          .filter(analysis => analysis.category_scores?.[category])
          .slice(0, 5)
          .map(analysis => ({ review_id: analysis.review_id, category: label, score: analysis.category_scores?.[category] })),
        categories: [label],
      }))
    })

  if (activeInsights.length >= 5 || reviewCount >= 8) {
    alerts.push(buildAlert({
      key: 'competitor-activity-increase',
      title: `${group.competitor} activity increase`,
      description: `${group.competitor} has ${reviewCount} reviews and ${activeInsights.length} active intelligence snapshots.`,
      alertType: 'Competitor Activity Increase',
      competitor: group.competitor,
      competitorId: group.competitor_id,
      confidence: Math.min(1, (reviewCount + activeInsights.length) / 18),
      evidenceCount: reviewCount + activeInsights.length,
      severityScore: 38 + Math.min(reviewCount + activeInsights.length, 18) * 3,
      createdAt: latestActivity,
      sourceInsights: activeInsights.slice(0, 5).map(sourceInsightRef),
      supportingEvidence: group.reviews.slice(0, 3).map(reviewEvidence),
    }))
  }

  return alerts
}

function applyFilters(alerts, filters) {
  const search = normalizeSearch(filters.search)
  return alerts.filter(alert => {
    if (filters.competitorId && alert.competitor_id !== filters.competitorId) return false
    if (filters.alertType && alert.alert_type !== filters.alertType) return false
    if (filters.severity && alert.severity !== filters.severity) return false
    if (search) {
      const haystack = [
        alert.title,
        alert.description,
        alert.alert_type,
        alert.severity,
        alert.competitor,
        ...(alert.supporting_categories || []),
      ].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

function buildKpis(alerts) {
  return {
    total_alerts: alerts.length,
    critical_alerts: alerts.filter(alert => alert.severity === 'Critical').length,
    high_severity_alerts: alerts.filter(alert => alert.severity === 'High').length,
    competitors_impacted: new Set(alerts.map(alert => alert.competitor_id).filter(Boolean)).size,
  }
}

function buildFilterOptions(alerts) {
  const competitors = new Map()
  alerts.forEach(alert => {
    if (alert.competitor_id) competitors.set(alert.competitor_id, alert.competitor)
  })
  return {
    competitors: [...competitors.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    alert_types: ALERT_TYPES.filter(type => alerts.some(alert => alert.alert_type === type)),
    severities: SEVERITIES.filter(severity => alerts.some(alert => alert.severity === severity)),
  }
}

export async function loadMoatAlerts({ competitorId = '', alertType = '', severity = '', search = '', page = 1, limit = 50 } = {}) {
  const supabase = getSupabaseAdmin()
  const [reviewsResult, analysesResult, insightsResult, opportunitiesResult] = await Promise.all([
    supabase
      .from('competitor_reviews')
      .select('id, competitor_id, rating, review_text, reviewed_at, collected_at, competitors(id, name)')
      .limit(10000),
    supabase
      .from('review_analysis')
      .select('review_id, sentiment, sentiment_score, category_scores, raw_output, status, analyzed_at')
      .eq('status', 'ready')
      .limit(10000),
    supabase
      .from('competitor_insights')
      .select('id, competitor_id, insight_type, title, summary, evidence, confidence, status, created_at, competitors(id, name)')
      .eq('status', 'active')
      .limit(500),
    loadMoatOpportunities({ limit: 100 }),
  ])

  if (reviewsResult.error) throw reviewsResult.error
  if (analysesResult.error) throw analysesResult.error
  if (insightsResult.error) throw insightsResult.error

  const reviews = reviewsResult.data || []
  const reviewById = new Map(reviews.map(review => [review.id, review]))
  const analyses = (analysesResult.data || []).map(analysis => ({
    ...analysis,
    review: reviewById.get(analysis.review_id),
  }))
  const groups = groupByCompetitor(
    reviews,
    analyses,
    insightsResult.data || [],
    opportunitiesResult.opportunities || []
  )
  const generated = groups
    .flatMap(alertsForCompetitor)
    .sort((a, b) => b.severity_score - a.severity_score || b.evidence_count - a.evidence_count || a.title.localeCompare(b.title))
  const filters = buildFilterOptions(generated)
  const filtered = applyFilters(generated, {
    competitorId: String(competitorId || '').trim(),
    alertType: String(alertType || '').trim(),
    severity: String(severity || '').trim(),
    search: String(search || '').trim(),
  })
  const paginated = paginateMoatArray(filtered, { page, limit })

  return {
    alerts: paginated.rows,
    kpis: buildKpis(filtered),
    filters,
    pagination: paginated.pagination,
  }
}
