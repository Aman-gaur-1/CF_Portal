import { getSupabaseAdmin } from '@/lib/supabase-server'
import { loadMoatAlerts } from './alert-engine'
import { loadMoatInsights } from './review-intelligence'
import { loadMoatMarketDemand } from './market-demand-engine'
import { loadMoatOpportunities } from './opportunity-engine'

const REPORT_SECTIONS = ['Marketing', 'Curriculum', 'Mentorship', 'Placements', 'Growth']

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function topByCount(items, limit = 5) {
  return [...items].sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.label || a.title).localeCompare(String(b.label || b.title))).slice(0, limit)
}

function evidenceCount(item) {
  return Number(item?.count || item?.total || item?.evidence_count || 1) || 1
}

function summarizeInsightEvidence(insights, types) {
  const map = new Map()
  insights
    .filter(insight => types.includes(insight.insight_type))
    .forEach(insight => {
      const evidence = Array.isArray(insight.evidence) && insight.evidence.length ? insight.evidence : [{ label: insight.summary, count: 1 }]
      evidence.forEach(item => {
        const label = String(item?.label || item?.title || item?.summary || '').trim()
        if (!label || label === 'No strong signal yet') return
        if (!map.has(label)) map.set(label, { label, count: 0, insights: [] })
        const row = map.get(label)
        row.count += evidenceCount(item)
        if (row.insights.length < 4) {
          row.insights.push({
            insight_id: insight.id,
            title: insight.title,
            summary: insight.summary,
            confidence: insight.confidence,
          })
        }
      })
    })
  return topByCount([...map.values()], 6)
}

function buildExecutiveSummary({ summary, demand, opportunities }) {
  const cleanSignal = value => String(value || '').toLowerCase().replace(/\s+demand$/, '').trim()
  const demandTitles = (demand.demand_signals || []).slice(0, 4).map(item => cleanSignal(item.title))
  const opportunityTitles = (opportunities.opportunities || []).slice(0, 3).map(item => cleanSignal(item.title))
  const signals = unique([...demandTitles, ...opportunityTitles]).slice(0, 5)

  if (signals.length === 0) {
    return 'Moat has collected intelligence, but there are not enough repeated signals yet to generate a strong executive summary.'
  }

  return `Review analysis across ${summary.competitors_tracked} tracked competitor${summary.competitors_tracked === 1 ? '' : 's'} indicates strong demand for ${signals.join(', ')}. The clearest strategic direction is to turn recurring learner demand into product proof, sharper positioning, and founder-level action priorities.`
}

function buildCompetitorOverview(competitors, reviews, analyses, insights, opportunities, demandSignals) {
  const reviewById = new Map(reviews.map(review => [review.id, review]))
  const groups = new Map()

  competitors.forEach(competitor => {
    groups.set(competitor.id, {
      competitor_id: competitor.id,
      competitor: competitor.name,
      review_count: 0,
      sentiment_distribution: { positive: 0, neutral: 0, negative: 0 },
      top_strengths: [],
      top_weaknesses: [],
      opportunities: [],
      demand_signals: [],
    })
  })

  reviews.forEach(review => {
    if (!groups.has(review.competitor_id)) return
    groups.get(review.competitor_id).review_count += 1
  })

  analyses.forEach(analysis => {
    const review = reviewById.get(analysis.review_id)
    if (!review || !groups.has(review.competitor_id)) return
    const distribution = groups.get(review.competitor_id).sentiment_distribution
    distribution[analysis.sentiment] = (distribution[analysis.sentiment] || 0) + 1
  })

  groups.forEach(group => {
    const competitorInsights = insights.filter(insight => insight.competitor_id === group.competitor_id)
    group.top_strengths = summarizeInsightEvidence(competitorInsights, ['top_praises', 'mentioned_strengths', 'competitor_strengths']).slice(0, 4)
    group.top_weaknesses = summarizeInsightEvidence(competitorInsights, ['top_complaints', 'competitor_weaknesses']).slice(0, 4)
    group.opportunities = opportunities.filter(item => item.competitor_id === group.competitor_id).slice(0, 5)
    group.demand_signals = demandSignals.filter(item => item.competitor_id === group.competitor_id).slice(0, 5)
  })

  const ranked = [...groups.values()].sort((a, b) => b.review_count - a.review_count || a.competitor.localeCompare(b.competitor))
  return {
    ranked_competitors: ranked,
    top_by_review_volume: ranked.slice(0, 5),
  }
}

function buildOpportunityReport(opportunities) {
  const categoryCounts = new Map()
  opportunities.forEach(item => categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1))
  const sectioned = {}
  REPORT_SECTIONS.forEach(section => {
    sectioned[section] = opportunities
      .filter(item => item.category === section || (section === 'Growth' && ['Growth', 'Career Growth', 'Support'].includes(item.category)))
      .slice(0, 6)
  })

  return {
    total_opportunities: opportunities.length,
    high_priority_opportunities: opportunities.filter(item => item.priority === 'High').length,
    top_categories: topByCount([...categoryCounts.entries()].map(([label, count]) => ({ label, count })), 6),
    top_recommended_actions: opportunities.slice(0, 8),
    sections: sectioned,
  }
}

function buildAlertsReport(alerts) {
  const byConfidence = [...alerts].sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
  const bySeverity = [...alerts].sort((a, b) => Number(b.severity_score || 0) - Number(a.severity_score || 0))
  const byDate = [...alerts].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  return {
    total_alerts: alerts.length,
    critical_alerts: alerts.filter(item => item.severity === 'Critical').length,
    high_severity_alerts: alerts.filter(item => item.severity === 'High').length,
    emerging_signals: alerts.filter(item => ['Emerging Theme', 'Category Growth', 'New Opportunity Detected'].includes(item.alert_type)).slice(0, 8),
    strongest_alerts: bySeverity.slice(0, 6),
    newest_alerts: byDate.slice(0, 6),
    highest_confidence_alerts: byConfidence.slice(0, 6),
  }
}

function buildDemandReport(demand) {
  const signals = demand.demand_signals || []
  return {
    demand_signals: signals.length,
    high_demand_areas: signals.filter(item => ['Critical', 'High'].includes(item.priority)).slice(0, 8),
    market_gaps: demand.trends?.market_gaps || [],
    growth_areas: demand.trends?.high_growth_areas || [],
    strongest_demand: [...signals].sort((a, b) => b.demand_score - a.demand_score).slice(0, 8),
    fastest_growing_themes: demand.trends?.emerging_demand || [],
    opportunity_alignment: demand.trends?.opportunity_alignment || [],
  }
}

function recommendationFromSignal(signal) {
  const title = String(signal?.title || '').toLowerCase()
  if (title.includes('project') || title.includes('practical')) return 'Increase project-based learning and make proof of practical work more visible.'
  if (title.includes('placement')) return 'Improve placement readiness with clearer interview, resume, and hiring support.'
  if (title.includes('mentor')) return 'Expand mentorship touchpoints and make mentor access easier to understand.'
  if (title.includes('career')) return 'Promote learner outcomes and career growth paths more explicitly.'
  if (title.includes('support')) return 'Improve support visibility with clearer response expectations and escalation paths.'
  if (title.includes('curriculum') || title.includes('ai')) return 'Package updated curriculum depth into sharper acquisition messaging.'
  return `Prioritize ${signal?.title || 'the strongest repeated demand signal'}.`
}

function buildStrategicRecommendations(demandSignals, opportunities) {
  const fromDemand = demandSignals.slice(0, 8).map(recommendationFromSignal)
  const fromOpportunities = opportunities.slice(0, 5).map(item => item.description)
  return unique([...fromDemand, ...fromOpportunities]).slice(0, 8)
}

export async function loadMoatExecutiveReport() {
  const supabase = getSupabaseAdmin()
  const [competitorsResult, sourcesResult, reviewsResult, analysesResult, insightsResult, opportunities, alerts, demand, insightsDashboard] = await Promise.all([
    supabase.from('competitors').select('id, name, category, city, active').limit(1000),
    supabase.from('review_sources').select('id, competitor_id, source_type, active').limit(5000),
    supabase.from('competitor_reviews').select('id, competitor_id, rating, review_text, reviewed_at, collected_at').limit(10000),
    supabase.from('review_analysis').select('review_id, sentiment, sentiment_score, status').eq('status', 'ready').limit(10000),
    supabase.from('competitor_insights').select('id, competitor_id, insight_type, title, summary, evidence, confidence, status, created_at, competitors(id, name)').eq('status', 'active').limit(500),
    loadMoatOpportunities({ limit: 100 }),
    loadMoatAlerts({ limit: 100 }),
    loadMoatMarketDemand({ limit: 100 }),
    loadMoatInsights(),
  ])

  if (competitorsResult.error) throw competitorsResult.error
  if (sourcesResult.error) throw sourcesResult.error
  if (reviewsResult.error) throw reviewsResult.error
  if (analysesResult.error) throw analysesResult.error
  if (insightsResult.error) throw insightsResult.error

  const competitors = competitorsResult.data || []
  const sources = sourcesResult.data || []
  const reviews = reviewsResult.data || []
  const analyses = analysesResult.data || []
  const insights = insightsResult.data || []
  const opportunityRows = opportunities.opportunities || []
  const alertRows = alerts.alerts || []
  const demandSignals = demand.demand_signals || []
  const marketGaps = demand.trends?.market_gaps || []

  const summary = {
    competitors_tracked: competitors.length,
    sources_tracked: sources.length,
    reviews_collected: reviews.length,
    reviews_analyzed: analyses.length,
    opportunities_generated: opportunities.kpis?.total_opportunities ?? opportunityRows.length,
    alerts_generated: alerts.kpis?.total_alerts ?? alertRows.length,
    demand_signals: demand.kpis?.demand_signals ?? demandSignals.length,
    market_gaps: demand.kpis?.market_gaps ?? marketGaps.length,
  }

  return {
    summary: {
      ...summary,
      executive_summary: buildExecutiveSummary({ summary, demand, opportunities }),
    },
    competitor_overview: buildCompetitorOverview(competitors, reviews, analyses, insights, opportunityRows, demandSignals),
    intelligence: {
      metrics: insightsDashboard.metrics,
      top_complaints: insightsDashboard.sections?.top_complaints || [],
      top_praises: insightsDashboard.sections?.top_praises || [],
      emerging_themes: insightsDashboard.sections?.emerging_themes || [],
      competitor_strengths: insightsDashboard.sections?.competitor_strengths || [],
      competitor_weaknesses: insightsDashboard.sections?.competitor_weaknesses || [],
    },
    opportunities: buildOpportunityReport(opportunityRows),
    alerts: buildAlertsReport(alertRows),
    demand: buildDemandReport(demand),
    strategic_recommendations: buildStrategicRecommendations(demandSignals, opportunityRows),
    generated_at: new Date().toISOString(),
  }
}
