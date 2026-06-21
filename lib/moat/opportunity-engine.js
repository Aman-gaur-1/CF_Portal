import { getSupabaseAdmin } from '@/lib/supabase-server'
import { paginateMoatArray } from './response-limits'

const PRIORITIES = ['High', 'Medium', 'Low']
const OPPORTUNITY_CATEGORIES = [
  'Pricing',
  'Curriculum',
  'Mentorship',
  'Placements',
  'Community',
  'Projects',
  'Career Growth',
  'Support',
  'Growth',
  'Marketing',
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

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function labelIncludes(label, keywords) {
  const normalized = normalizeKey(label)
  return keywords.some(keyword => normalized.includes(keyword))
}

function opportunityForSignal(signal, sourceType) {
  const label = String(signal?.label || signal || '').trim()
  const lower = normalizeKey(label)
  if (!label || lower === 'no strong signal yet') return null
  const isStrength = ['top_praises', 'mentioned_strengths', 'competitor_strengths'].includes(sourceType)

  if (labelIncludes(lower, ['placement', 'job', 'interview', 'career support'])) {
    return isStrength
      ? {
          title: 'Highlight placement outcomes',
          category: 'Marketing',
          description: 'Use praised placement and career outcome signals in positioning, proof points, and comparison messaging.',
        }
      : {
          title: 'Strengthen placement readiness',
          category: 'Placements',
          description: 'Create sharper placement readiness assets such as mock interviews, resume reviews, and interview support.',
        }
  }

  if (labelIncludes(lower, ['mentor', 'teaching', 'guidance', 'doubt', 'instructor'])) {
    return isStrength
      ? {
          title: 'Promote mentorship quality',
          category: 'Mentorship',
          description: 'Turn positive mentorship and teaching signals into clearer public proof of learner support.',
        }
      : {
          title: 'Expand mentorship touchpoints',
          category: 'Mentorship',
          description: 'Add more visible mentor access, office hours, and faster doubt-resolution promises.',
        }
  }

  if (labelIncludes(lower, ['project', 'practical', 'hands-on', 'capstone', 'portfolio'])) {
    return isStrength
      ? {
          title: 'Promote practical learning',
          category: 'Marketing',
          description: 'Make practical learning, projects, and portfolio outcomes more prominent in acquisition messaging.',
        }
      : {
          title: 'Increase project-based learning',
          category: 'Projects',
          description: 'Add or emphasize hands-on projects, capstones, and portfolio-building work where learners ask for more practice.',
        }
  }

  if (labelIncludes(lower, ['curriculum', 'content', 'module', 'advanced', 'updated', 'ai'])) {
    return {
      title: 'Expand advanced curriculum modules',
      category: 'Curriculum',
      description: 'Use curriculum signals to add or market deeper, newer, and more advanced modules, including AI-oriented content where relevant.',
    }
  }

  if (labelIncludes(lower, ['price', 'fee', 'pricing', 'refund', 'value', 'worth', 'emi', 'money'])) {
    return isStrength
      ? {
          title: 'Package value-for-money messaging',
          category: 'Pricing',
          description: 'Convert value praise into pricing proof, scholarship positioning, and ROI messaging.',
        }
      : {
          title: 'Affordable plan opportunity',
          category: 'Pricing',
          description: 'Explore lower-friction pricing, EMI, scholarship, or refund clarity where price sensitivity appears.',
        }
  }

  if (labelIncludes(lower, ['support', 'response', 'helpful', 'team', 'service'])) {
    return isStrength
      ? {
          title: 'Showcase support responsiveness',
          category: 'Support',
          description: 'Use praised support experiences to make service quality more visible during consideration.',
        }
      : {
          title: 'Improve support SLA visibility',
          category: 'Support',
          description: 'Clarify support response commitments and escalation channels where support concerns appear.',
        }
  }

  if (labelIncludes(lower, ['recommend', 'best platform', 'buying', 'positive career intent'])) {
    return {
      title: 'Use recommendation-led campaigns',
      category: 'Marketing',
      description: 'Turn strong recommendations and buying signals into testimonial-led campaigns and competitor comparison proof.',
    }
  }

  if (labelIncludes(lower, ['career', 'growth', 'switch', 'upskill'])) {
    return {
      title: 'Improve career guidance visibility',
      category: 'Career Growth',
      description: 'Make career growth pathways, transitions, and guidance more concrete in product and marketing surfaces.',
    }
  }

  return {
    title: isStrength ? 'Promote praised strengths' : 'Investigate competitive gap',
    category: isStrength ? 'Marketing' : 'Growth',
    description: isStrength
      ? 'Convert repeated praise patterns into clearer positioning and proof points.'
      : 'Review repeated signals for a possible competitor gap worth product or marketing follow-up.',
  }
}

function priorityFromScore(score) {
  if (score >= 70) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}

function evidenceCountForSignal(signal) {
  return Number(signal?.count || signal?.total || 1) || 1
}

function addOpportunity(map, item) {
  const key = `${item.competitor_id}:${item.title}:${item.category}`
  if (!map.has(key)) {
    map.set(key, {
      ...item,
      supporting_signals: [],
      source_insight_references: [],
      supporting_categories: [],
      evidence_count: 0,
      supporting_insights_count: 0,
      confidence_values: [],
    })
  }

  const current = map.get(key)
  current.evidence_count += item.evidence_count
  current.supporting_insights_count += 1
  current.supporting_signals.push(...item.supporting_signals)
  current.source_insight_references.push(...item.source_insight_references)
  current.supporting_categories.push(item.category)
  current.confidence_values.push(item.confidence_score)
}

function finalizeOpportunity(row, index) {
  const avgConfidence = row.confidence_values.length
    ? row.confidence_values.reduce((sum, value) => sum + value, 0) / row.confidence_values.length
    : 0
  const priorityScore = Math.min(100, Math.round(
    Math.min(row.evidence_count, 8) * 10
    + Math.min(row.supporting_insights_count, 5) * 8
    + avgConfidence * 38
  ))

  return {
    id: `${row.competitor_id}-${index}-${normalizeKey(row.title).replace(/[^a-z0-9]+/g, '-')}`,
    title: row.title,
    description: row.description,
    category: row.category,
    competitor: row.competitor,
    competitor_id: row.competitor_id,
    confidence_score: Number(Math.min(1, avgConfidence || priorityScore / 100).toFixed(4)),
    evidence_count: row.evidence_count,
    priority: priorityFromScore(priorityScore),
    priority_score: priorityScore,
    supporting_signals: unique(row.supporting_signals).slice(0, 8),
    source_insight_references: row.source_insight_references.slice(0, 8),
    supporting_categories: unique(row.supporting_categories),
  }
}

function opportunitiesFromInsights(insights) {
  const map = new Map()

  insights.forEach(insight => {
    const evidence = Array.isArray(insight.evidence) ? insight.evidence : []
    const signals = evidence.length > 0 ? evidence : [{ label: insight.summary, count: 1 }]

    signals.forEach(signal => {
      const base = opportunityForSignal(signal, insight.insight_type)
      if (!base) return
      addOpportunity(map, {
        ...base,
        competitor: insight.competitors?.name || 'Unknown competitor',
        competitor_id: insight.competitor_id,
        confidence_score: Number(insight.confidence || 0),
        evidence_count: evidenceCountForSignal(signal),
        supporting_signals: [signal.label || insight.summary],
        source_insight_references: [{
          insight_id: insight.id,
          insight_type: insight.insight_type,
          title: insight.title,
          summary: insight.summary,
          confidence: insight.confidence,
        }],
      })
    })
  })

  return [...map.values()]
    .map(finalizeOpportunity)
    .sort((a, b) => b.priority_score - a.priority_score || b.evidence_count - a.evidence_count || a.title.localeCompare(b.title))
}

function opportunitiesFromAnalysis(analyses, reviewsById) {
  const map = new Map()

  analyses.forEach(analysis => {
    const review = reviewsById.get(analysis.review_id)
    if (!review) return
    const output = analysis.raw_output || {}
    const signalGroups = [
      { sourceType: 'requested_improvements', signals: output.feature_requests || [] },
      { sourceType: 'top_praises', signals: output.buying_signals || [] },
      { sourceType: 'top_praises', signals: output.praise_themes || [] },
      { sourceType: 'top_complaints', signals: output.complaint_themes || [] },
      { sourceType: 'competitor_weaknesses', signals: output.pricing_concerns || [] },
      { sourceType: 'competitor_weaknesses', signals: output.mentor_concerns || [] },
      { sourceType: 'competitor_weaknesses', signals: output.placement_concerns || [] },
      { sourceType: 'competitor_weaknesses', signals: output.curriculum_concerns || [] },
    ]

    signalGroups.forEach(group => unique(group.signals).forEach(signal => {
      const base = opportunityForSignal({ label: signal, count: 1 }, group.sourceType)
      if (!base) return
      addOpportunity(map, {
        ...base,
        competitor: review.competitors?.name || 'Unknown competitor',
        competitor_id: review.competitor_id,
        confidence_score: Math.max(0.25, Math.abs(Number(analysis.sentiment_score || 0))),
        evidence_count: 1,
        supporting_signals: [signal],
        source_insight_references: [{
          review_id: analysis.review_id,
          analysis_status: analysis.status,
          sentiment: analysis.sentiment,
          excerpt: String(review.review_text || '').slice(0, 180),
        }],
      })
    }))
  })

  return [...map.values()].map(finalizeOpportunity)
}

function mergeOpportunities(primary, secondary) {
  const map = new Map()
  ;[...primary, ...secondary].forEach(item => {
    const key = `${item.competitor_id}:${item.title}:${item.category}`
    if (!map.has(key)) {
      map.set(key, { ...item })
      return
    }
    const existing = map.get(key)
    existing.evidence_count += item.evidence_count
    existing.priority_score = Math.min(100, Math.max(existing.priority_score, item.priority_score) + 5)
    existing.priority = priorityFromScore(existing.priority_score)
    existing.confidence_score = Number(Math.max(existing.confidence_score, item.confidence_score).toFixed(4))
    existing.supporting_signals = unique([...existing.supporting_signals, ...item.supporting_signals]).slice(0, 10)
    existing.source_insight_references = [...existing.source_insight_references, ...item.source_insight_references].slice(0, 10)
    existing.supporting_categories = unique([...existing.supporting_categories, ...item.supporting_categories])
  })

  return [...map.values()].sort((a, b) => b.priority_score - a.priority_score || b.evidence_count - a.evidence_count || a.title.localeCompare(b.title))
}

function applyFilters(opportunities, filters) {
  return opportunities.filter(item => {
    if (filters.competitorId && item.competitor_id !== filters.competitorId) return false
    if (filters.category && item.category !== filters.category) return false
    if (filters.priority && item.priority !== filters.priority) return false
    if (filters.search) {
      const haystack = [
        item.title,
        item.description,
        item.category,
        item.competitor,
        ...(item.supporting_signals || []),
      ].join(' ').toLowerCase()
      if (!haystack.includes(filters.search.toLowerCase())) return false
    }
    return true
  })
}

function buildKpis(opportunities) {
  return {
    total_opportunities: opportunities.length,
    high_priority: opportunities.filter(item => item.priority === 'High').length,
    competitors_covered: new Set(opportunities.map(item => item.competitor_id).filter(Boolean)).size,
    categories_covered: new Set(opportunities.map(item => item.category).filter(Boolean)).size,
  }
}

function buildFilterOptions(opportunities) {
  const competitorMap = new Map()
  opportunities.forEach(item => {
    if (item.competitor_id) competitorMap.set(item.competitor_id, item.competitor)
  })

  return {
    competitors: [...competitorMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    categories: OPPORTUNITY_CATEGORIES.filter(category => opportunities.some(item => item.category === category)),
    priorities: PRIORITIES,
  }
}

export async function loadMoatOpportunities({ competitorId = '', category = '', priority = '', search = '', page = 1, limit = 50 } = {}) {
  const supabase = getSupabaseAdmin()
  const [insightsResult, analysisResult] = await Promise.all([
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

  const generated = mergeOpportunities(
    opportunitiesFromInsights(insightsResult.data || []),
    opportunitiesFromAnalysis(analyses, reviewsById)
  )
  const filters = buildFilterOptions(generated)
  const filtered = applyFilters(generated, {
    competitorId: String(competitorId || '').trim(),
    category: String(category || '').trim(),
    priority: String(priority || '').trim(),
    search: String(search || '').trim(),
  })
  const paginated = paginateMoatArray(filtered, { page, limit })

  return {
    opportunities: paginated.rows,
    kpis: buildKpis(filtered),
    filters,
    pagination: paginated.pagination,
  }
}
