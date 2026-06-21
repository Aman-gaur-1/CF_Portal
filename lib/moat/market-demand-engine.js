import { getSupabaseAdmin } from '@/lib/supabase-server'
import { loadMoatOpportunities } from './opportunity-engine'
import { paginateMoatArray } from './response-limits'

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low']
const DEMAND_CATEGORIES = [
  'AI Content',
  'Projects',
  'Placements',
  'Mentorship',
  'Career Growth',
  'Community',
  'Curriculum',
  'Pricing',
  'Support',
  'Certifications',
  'Industry Tools',
]

const INSIGHT_TYPES = [
  'top_complaints',
  'competitor_weaknesses',
  'emerging_themes',
  'requested_improvements',
  'top_praises',
  'mentioned_strengths',
  'competitor_strengths',
]

const DEMAND_RULES = [
  {
    id: 'ai-content',
    title: 'AI content demand',
    category: 'AI Content',
    gapTitle: 'Advanced AI curriculum',
    keywords: [' ai ', 'artificial intelligence', 'machine learning', 'ml', 'gen ai', 'generative ai', 'agentic ai', 'agent'],
  },
  {
    id: 'projects',
    title: 'Project-based learning demand',
    category: 'Projects',
    gapTitle: 'More project-based learning',
    keywords: ['project', 'practical', 'hands-on', 'hands on', 'capstone', 'portfolio', 'real-world', 'real world', 'practice'],
  },
  {
    id: 'placements',
    title: 'Placement support demand',
    category: 'Placements',
    gapTitle: 'Placement readiness programs',
    keywords: ['placement', 'job', 'interview', 'resume', 'career support', 'mock interview', 'hiring'],
  },
  {
    id: 'mentorship',
    title: 'Mentorship demand',
    category: 'Mentorship',
    gapTitle: 'Dedicated mentor access',
    keywords: ['mentor', 'mentorship', 'guidance', 'doubt', 'instructor', 'teacher', 'office hour'],
  },
  {
    id: 'career-growth',
    title: 'Career growth demand',
    category: 'Career Growth',
    gapTitle: 'Career guidance visibility',
    keywords: ['career', 'growth', 'switch', 'upskill', 'outcome', 'promotion'],
  },
  {
    id: 'community',
    title: 'Community demand',
    category: 'Community',
    gapTitle: 'Stronger learner community',
    keywords: ['community', 'peer', 'network', 'cohort', 'group'],
  },
  {
    id: 'industry-tools',
    title: 'Industry tools demand',
    category: 'Industry Tools',
    gapTitle: 'Industry tool exposure',
    keywords: ['tool', 'tools', 'industry', 'real time', 'real-time', 'platform', 'software'],
  },
  {
    id: 'certifications',
    title: 'Certification demand',
    category: 'Certifications',
    gapTitle: 'Credible certification pathways',
    keywords: ['certificate', 'certification', 'credential'],
  },
  {
    id: 'pricing-flexibility',
    title: 'Pricing flexibility demand',
    category: 'Pricing',
    gapTitle: 'Flexible pricing options',
    keywords: ['price', 'pricing', 'fee', 'refund', 'emi', 'scholarship', 'affordable', 'money', 'value'],
  },
  {
    id: 'curriculum',
    title: 'Curriculum depth demand',
    category: 'Curriculum',
    gapTitle: 'Deeper updated curriculum',
    keywords: ['curriculum', 'content', 'module', 'advanced', 'updated', 'course'],
  },
  {
    id: 'support',
    title: 'Learner support demand',
    category: 'Support',
    gapTitle: 'Clearer support responsiveness',
    keywords: ['support', 'help', 'response', 'service', 'team'],
  },
]

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalize(value) {
  return String(value || '').trim()
}

function normalizeSearch(value) {
  return normalize(value).toLowerCase()
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  return [value]
}

function signalLabel(value) {
  if (typeof value === 'string') return value
  return normalize(value?.label || value?.title || value?.summary || value?.theme || value?.text)
}

function signalCount(value) {
  return Number(value?.count || value?.total || value?.evidence_count || 1) || 1
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

function reviewRef(analysis, review) {
  return {
    review_id: analysis.review_id,
    sentiment: analysis.sentiment,
    score: analysis.sentiment_score,
    excerpt: normalize(review?.review_text).slice(0, 180),
  }
}

function opportunityRef(opportunity) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    category: opportunity.category,
    priority: opportunity.priority,
    confidence_score: opportunity.confidence_score,
    evidence_count: opportunity.evidence_count,
  }
}

function textMatchesRule(text, rule) {
  const haystack = ` ${normalizeSearch(text)} `
  return rule.keywords.some(keyword => haystack.includes(keyword))
}

function ruleForText(text) {
  return DEMAND_RULES.find(rule => textMatchesRule(text, rule))
}

function priorityFromScore(score) {
  if (score >= 88) return 'Critical'
  if (score >= 68) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}

function sourceWeight(source) {
  if (source === 'insight') return 2
  if (source === 'opportunity') return 2
  return 1
}

function createBucket(rule, competitorId, competitor) {
  return {
    rule,
    competitor_id: competitorId,
    competitor,
    evidence_count: 0,
    weighted_frequency: 0,
    review_count: 0,
    insight_count: 0,
    opportunity_count: 0,
    confidence_values: [],
    supporting_evidence: [],
    related_insights: [],
    related_opportunities: [],
    supporting_categories: [],
    raw_signals: [],
  }
}

function addDemandSignal(map, { rule, competitorId, competitor, label, source, count = 1, confidence = 0.35, evidence, insight, opportunity, category }) {
  if (!rule || !competitorId) return
  const key = `${competitorId}:${rule.id}`
  if (!map.has(key)) map.set(key, createBucket(rule, competitorId, competitor || 'Unknown competitor'))

  const bucket = map.get(key)
  const safeCount = Math.max(1, Number(count || 1))
  bucket.evidence_count += safeCount
  bucket.weighted_frequency += safeCount * sourceWeight(source)
  bucket.confidence_values.push(Number(confidence || 0.35))
  bucket.raw_signals.push(label)
  if (category) bucket.supporting_categories.push(category)
  if (source === 'review') bucket.review_count += safeCount
  if (source === 'insight') bucket.insight_count += 1
  if (source === 'opportunity') bucket.opportunity_count += 1
  if (evidence) bucket.supporting_evidence.push(evidence)
  if (insight) bucket.related_insights.push(sourceInsightRef(insight))
  if (opportunity) bucket.related_opportunities.push(opportunityRef(opportunity))
}

function addAnalysisSignals(map, analyses, reviewsById) {
  analyses.forEach(analysis => {
    const review = reviewsById.get(analysis.review_id)
    if (!review) return
    const output = analysis.raw_output || {}
    const signalGroups = [
      output.feature_requests,
      output.buying_signals,
      output.praise_themes,
      output.complaint_themes,
      output.pricing_concerns,
      output.mentor_concerns,
      output.placement_concerns,
      output.curriculum_concerns,
    ]
    const labels = unique(signalGroups.flatMap(asArray).map(signalLabel))
    labels.forEach(label => {
      const rule = ruleForText(label)
      if (!rule) return
      addDemandSignal(map, {
        rule,
        competitorId: review.competitor_id,
        competitor: review.competitors?.name,
        label,
        source: 'review',
        count: 1,
        confidence: Math.max(0.3, Math.abs(Number(analysis.sentiment_score || 0))),
        evidence: reviewRef(analysis, review),
      })
    })

    Object.keys(analysis.category_scores || {}).forEach(categoryKey => {
      const label = categoryKey.replace(/_/g, ' ')
      const rule = ruleForText(label)
      if (!rule) return
      addDemandSignal(map, {
        rule,
        competitorId: review.competitor_id,
        competitor: review.competitors?.name,
        label,
        source: 'review',
        count: 1,
        confidence: Math.max(0.3, Number(analysis.category_scores?.[categoryKey] || 0.4)),
        evidence: reviewRef(analysis, review),
      })
    })
  })
}

function addInsightSignals(map, insights) {
  insights.forEach(insight => {
    const evidence = Array.isArray(insight.evidence) ? insight.evidence : []
    const signals = evidence.length ? evidence : [{ label: insight.summary, count: 1 }]
    signals.forEach(signal => {
      const label = signalLabel(signal)
      const combined = `${label} ${insight.title || ''} ${insight.summary || ''}`
      const rule = ruleForText(combined)
      if (!rule || normalizeSearch(label) === 'no strong signal yet') return
      addDemandSignal(map, {
        rule,
        competitorId: insight.competitor_id,
        competitor: insight.competitors?.name,
        label,
        source: 'insight',
        count: signalCount(signal),
        confidence: Number(insight.confidence || 0.35),
        insight,
        evidence: {
          label,
          count: signalCount(signal),
          insight_type: insight.insight_type,
          summary: insight.summary,
        },
      })
    })
  })
}

function addOpportunitySignals(map, opportunities) {
  opportunities.forEach(opportunity => {
    const combined = [
      opportunity.title,
      opportunity.description,
      opportunity.category,
      ...(opportunity.supporting_signals || []),
    ].join(' ')
    const rule = ruleForText(combined)
    if (!rule) return
    addDemandSignal(map, {
      rule,
      competitorId: opportunity.competitor_id,
      competitor: opportunity.competitor,
      label: opportunity.title,
      source: 'opportunity',
      count: Math.max(1, Number(opportunity.evidence_count || 1)),
      confidence: Number(opportunity.confidence_score || 0.45),
      opportunity,
      category: opportunity.category,
      evidence: {
        title: opportunity.title,
        category: opportunity.category,
        priority: opportunity.priority,
        evidence_count: opportunity.evidence_count,
      },
    })
  })
}

function marketGapForSignal(bucket) {
  const evidence = bucket.evidence_count
  return {
    id: `${bucket.competitor_id}-${bucket.rule.id}-gap`,
    title: bucket.rule.gapTitle,
    category: bucket.rule.category,
    competitor: bucket.competitor,
    competitor_id: bucket.competitor_id,
    description: `${bucket.competitor} intelligence shows repeated demand around ${bucket.rule.category.toLowerCase()}, creating a visible market gap: ${bucket.rule.gapTitle}.`,
    evidence_count: evidence,
    confidence_score: 0,
  }
}

function finalizeSignal(bucket, index) {
  const avgConfidence = bucket.confidence_values.length
    ? bucket.confidence_values.reduce((sum, value) => sum + value, 0) / bucket.confidence_values.length
    : 0.35
  const demandScore = Math.min(100, Math.round(
    Math.min(bucket.weighted_frequency, 18) * 4.5
    + Math.min(bucket.insight_count, 5) * 5
    + Math.min(bucket.opportunity_count, 5) * 5
    + avgConfidence * 24
  ))
  const priority = priorityFromScore(demandScore)
  const gap = marketGapForSignal(bucket)
  gap.confidence_score = Number(Math.min(1, avgConfidence).toFixed(4))

  return {
    id: `${bucket.competitor_id}-${index}-${bucket.rule.id}`,
    title: bucket.rule.title,
    category: bucket.rule.category,
    competitor: bucket.competitor,
    competitor_id: bucket.competitor_id,
    description: `${bucket.rule.title} is supported by ${bucket.evidence_count} evidence point${bucket.evidence_count === 1 ? '' : 's'} across reviews, insight snapshots, and opportunities for ${bucket.competitor}.`,
    demand_score: demandScore,
    confidence_score: Number(Math.min(1, avgConfidence).toFixed(4)),
    evidence_count: bucket.evidence_count,
    priority,
    supporting_evidence: bucket.supporting_evidence.slice(0, 10),
    related_insights: bucket.related_insights.slice(0, 10),
    related_opportunities: bucket.related_opportunities.slice(0, 10),
    supporting_categories: unique([bucket.rule.category, ...bucket.supporting_categories]).slice(0, 8),
    supporting_signals: unique(bucket.raw_signals).slice(0, 10),
    market_gap: gap,
    source_mix: {
      reviews: bucket.review_count,
      insights: bucket.insight_count,
      opportunities: bucket.opportunity_count,
    },
  }
}

function applyFilters(signals, filters) {
  const search = normalizeSearch(filters.search)
  return signals.filter(signal => {
    if (filters.competitorId && signal.competitor_id !== filters.competitorId) return false
    if (filters.category && signal.category !== filters.category) return false
    if (filters.priority && signal.priority !== filters.priority) return false
    if (search) {
      const haystack = [
        signal.title,
        signal.description,
        signal.category,
        signal.competitor,
        ...(signal.supporting_signals || []),
      ].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

function buildKpis(signals) {
  return {
    demand_signals: signals.length,
    high_demand_signals: signals.filter(signal => ['Critical', 'High'].includes(signal.priority)).length,
    market_gaps: signals.filter(signal => signal.market_gap).length,
    competitors_covered: new Set(signals.map(signal => signal.competitor_id).filter(Boolean)).size,
  }
}

function buildFilterOptions(signals) {
  const competitors = new Map()
  signals.forEach(signal => {
    if (signal.competitor_id) competitors.set(signal.competitor_id, signal.competitor)
  })
  return {
    competitors: [...competitors.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    categories: DEMAND_CATEGORIES.filter(category => signals.some(signal => signal.category === category)),
    priorities: PRIORITIES.filter(priority => signals.some(signal => signal.priority === priority)),
  }
}

function buildTrends(signals) {
  const sorted = [...signals].sort((a, b) => b.demand_score - a.demand_score || b.evidence_count - a.evidence_count)
  return {
    top_demand_signals: sorted.slice(0, 6),
    emerging_demand: sorted.filter(signal => signal.source_mix?.reviews > 0 || signal.source_mix?.insights > 0).slice(0, 6),
    market_gaps: sorted.map(signal => signal.market_gap).filter(Boolean).slice(0, 8),
    high_growth_areas: sorted.filter(signal => ['Critical', 'High'].includes(signal.priority)).slice(0, 6),
    opportunity_alignment: sorted.filter(signal => (signal.related_opportunities || []).length > 0).slice(0, 6),
  }
}

export async function loadMoatMarketDemand({ competitorId = '', category = '', priority = '', search = '', page = 1, limit = 50 } = {}) {
  const supabase = getSupabaseAdmin()
  const [insightsResult, analysisResult, opportunitiesResult] = await Promise.all([
    supabase
      .from('competitor_insights')
      .select('id, competitor_id, insight_type, title, summary, evidence, confidence, status, created_at, competitors(id, name)')
      .eq('status', 'active')
      .in('insight_type', INSIGHT_TYPES)
      .limit(500),
    supabase
      .from('review_analysis')
      .select('review_id, sentiment, sentiment_score, category_scores, raw_output, status')
      .eq('status', 'ready')
      .limit(10000),
    loadMoatOpportunities({ limit: 100 }),
  ])

  if (insightsResult.error) throw insightsResult.error
  if (analysisResult.error) throw analysisResult.error

  const analyses = analysisResult.data || []
  const reviewIds = unique(analyses.map(row => row.review_id))
  let reviewsById = new Map()

  if (reviewIds.length > 0) {
    const { data, error } = await supabase
      .from('competitor_reviews')
      .select('id, competitor_id, review_text, competitors(id, name)')
      .in('id', reviewIds)
    if (error) throw error
    reviewsById = new Map((data || []).map(review => [review.id, review]))
  }

  const buckets = new Map()
  addAnalysisSignals(buckets, analyses, reviewsById)
  addInsightSignals(buckets, insightsResult.data || [])
  addOpportunitySignals(buckets, opportunitiesResult.opportunities || [])

  const generated = [...buckets.values()]
    .map(finalizeSignal)
    .sort((a, b) => b.demand_score - a.demand_score || b.evidence_count - a.evidence_count || a.title.localeCompare(b.title))
  const filters = buildFilterOptions(generated)
  const filtered = applyFilters(generated, {
    competitorId: normalize(competitorId),
    category: normalize(category),
    priority: normalize(priority),
    search: normalize(search),
  })
  const paginated = paginateMoatArray(filtered, { page, limit })

  return {
    demand_signals: paginated.rows,
    trends: buildTrends(filtered),
    kpis: buildKpis(filtered),
    filters,
    pagination: paginated.pagination,
  }
}
