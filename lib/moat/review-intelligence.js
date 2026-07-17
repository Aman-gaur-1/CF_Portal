import { getSupabaseAdmin } from '@/lib/supabase-server'
import { selectRowsByIds } from './supabase-query'

export const REVIEW_CATEGORIES = [
  { category_key: 'curriculum', label: 'Curriculum', description: 'Course content, syllabus, pacing, and learning depth.', sort_order: 10 },
  { category_key: 'placements', label: 'Placements', description: 'Jobs, hiring support, placement claims, and outcomes.', sort_order: 20 },
  { category_key: 'mentorship', label: 'Mentorship', description: 'Mentors, instructors, doubt support, and guidance.', sort_order: 30 },
  { category_key: 'pricing', label: 'Pricing', description: 'Fees, affordability, value for money, and refunds.', sort_order: 40 },
  { category_key: 'community', label: 'Community', description: 'Peer network, alumni, groups, and community support.', sort_order: 50 },
  { category_key: 'projects', label: 'Projects', description: 'Hands-on work, portfolio, capstones, and assignments.', sort_order: 60 },
  { category_key: 'support', label: 'Support', description: 'Operations, response time, student support, and service quality.', sort_order: 70 },
  { category_key: 'career_growth', label: 'Career Growth', description: 'Upskilling, transitions, promotions, and career confidence.', sort_order: 80 },
  { category_key: 'outcomes', label: 'Outcomes', description: 'Results, ROI, skill gains, offers, and overall success.', sort_order: 90 },
  { category_key: 'other', label: 'Other', description: 'Relevant review signals that do not fit the primary taxonomy.', sort_order: 100 },
]

const CATEGORY_RULES = {
  curriculum: ['curriculum', 'course', 'content', 'module', 'syllabus', 'lecture', 'lesson', 'teaching', 'concept', 'dsa', 'system design', 'data science'],
  placements: ['placement', 'placed', 'job', 'jobs', 'hiring', 'interview', 'company', 'companies', 'career support', 'offer', 'recruiter'],
  mentorship: ['mentor', 'mentorship', 'teacher', 'instructor', 'trainer', 'faculty', 'doubt', 'doubts', 'guidance', 'coach'],
  pricing: ['price', 'pricing', 'fee', 'fees', 'cost', 'expensive', 'refund', 'emi', 'payment', 'money', 'worth'],
  community: ['community', 'peer', 'peers', 'alumni', 'network', 'group', 'batchmates', 'discord', 'whatsapp'],
  projects: ['project', 'projects', 'assignment', 'assignments', 'capstone', 'portfolio', 'hands-on', 'practical', 'case study'],
  support: ['support', 'response', 'responsive', 'help', 'helpful', 'team', 'counsellor', 'counselor', 'service', 'resolve'],
  career_growth: ['career', 'growth', 'transition', 'switch', 'upskill', 'confidence', 'promotion', 'professional'],
  outcomes: ['outcome', 'result', 'results', 'success', 'improved', 'improvement', 'salary', 'package', 'roi', 'value'],
}

const SIGNAL_RULES = {
  complaintThemes: {
    'Poor support response': ['no response', 'slow response', 'not responding', 'unresponsive', 'delay', 'delayed', 'ignored'],
    'Weak placement support': ['placement issue', 'no placement', 'fake placement', 'job guarantee', 'not placed', 'placement support'],
    'Curriculum gaps': ['outdated', 'basic content', 'not deep', 'curriculum issue', 'poor content', 'course content'],
    'Mentor quality concerns': ['bad mentor', 'mentor issue', 'trainer issue', 'poor teaching', 'doubts not solved'],
    'Pricing or refund friction': ['expensive', 'refund', 'not worth', 'high fee', 'money waste', 'payment issue'],
  },
  praiseThemes: {
    'Strong teaching quality': ['good teaching', 'great teaching', 'excellent teaching', 'teacher', 'instructor', 'trainer', 'mentor'],
    'Helpful placement support': ['placement', 'placed', 'job', 'offer', 'interview', 'career support'],
    'Practical learning': ['project', 'hands-on', 'practical', 'assignment', 'real world', 'portfolio'],
    'Supportive team': ['support', 'helpful', 'responsive', 'guidance', 'doubt'],
    'Good value': ['worth', 'value', 'affordable', 'best investment', 'roi'],
  },
  featureRequests: {
    'More live projects': ['more project', 'more projects', 'hands-on', 'practical', 'capstone'],
    'Better placement transparency': ['placement transparency', 'more companies', 'job support', 'interview support'],
    'Faster doubt resolution': ['doubt', 'faster response', 'quick response', 'support response'],
    'Updated curriculum': ['updated curriculum', 'latest', 'advanced content', 'new module'],
  },
  pricingConcerns: {
    'High fees': ['expensive', 'high fee', 'costly', 'overpriced'],
    'Refund concern': ['refund', 'money back', 'payment issue'],
    'Value concern': ['not worth', 'money waste', 'waste of money'],
  },
  mentorConcerns: {
    'Doubts not resolved': ['doubt not', 'doubts not', 'not solved', 'unresolved doubt'],
    'Instructor quality': ['bad mentor', 'poor mentor', 'poor teaching', 'trainer issue', 'faculty issue'],
  },
  placementConcerns: {
    'Placement support gap': ['no placement', 'not placed', 'placement support', 'job support'],
    'Interview support gap': ['interview', 'mock interview', 'resume', 'recruiter'],
  },
  curriculumConcerns: {
    'Outdated curriculum': ['outdated', 'old content', 'latest'],
    'Insufficient depth': ['basic', 'not deep', 'advanced', 'depth'],
  },
  buyingSignals: {
    'Strong recommendation': ['recommend', 'highly recommend', 'must join', 'best platform'],
    'Positive career intent': ['career switch', 'career growth', 'job', 'placement', 'upskill'],
    'Value validation': ['worth', 'value for money', 'good investment'],
  },
}

const POSITIVE_WORDS = ['good', 'great', 'excellent', 'best', 'helpful', 'amazing', 'recommend', 'supportive', 'valuable', 'worth', 'improved', 'clear', 'practical', 'placed']
const NEGATIVE_WORDS = ['bad', 'poor', 'worst', 'fake', 'waste', 'expensive', 'refund', 'delay', 'ignored', 'unresponsive', 'issue', 'problem', 'not worth']
const GENERATED_INSIGHT_TYPES = [
  'top_complaints',
  'top_praises',
  'requested_improvements',
  'mentioned_strengths',
  'sentiment_distribution',
  'review_volume',
  'emerging_themes',
  'competitor_strengths',
  'competitor_weaknesses',
]

function includesAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword))
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function scoreSentiment(review) {
  const rating = Number(review.rating)
  const text = String(review.review_text || '').toLowerCase()
  let score = 0

  if (Number.isFinite(rating)) score += (rating - 3) / 2
  POSITIVE_WORDS.forEach(word => { if (text.includes(word)) score += 0.12 })
  NEGATIVE_WORDS.forEach(word => { if (text.includes(word)) score -= 0.16 })

  const normalized = Math.max(-1, Math.min(1, score))
  const sentiment = normalized >= 0.25 ? 'positive' : normalized <= -0.25 ? 'negative' : 'neutral'
  return { sentiment, sentimentScore: Number(normalized.toFixed(4)) }
}

function matchSignalGroup(text, group) {
  return Object.entries(group)
    .filter(([, keywords]) => includesAny(text, keywords))
    .map(([label]) => label)
}

export function analyzeReviewText(review) {
  const text = String(review.review_text || '').toLowerCase()
  const { sentiment, sentimentScore } = scoreSentiment(review)
  const categoryScores = {}

  Object.entries(CATEGORY_RULES).forEach(([key, keywords]) => {
    const matches = keywords.filter(keyword => text.includes(keyword)).length
    if (matches > 0) categoryScores[key] = Math.min(1, Number((0.35 + matches * 0.15).toFixed(2)))
  })
  if (Object.keys(categoryScores).length === 0) categoryScores.other = 0.35

  const complaintThemes = unique(matchSignalGroup(text, SIGNAL_RULES.complaintThemes))
  const praiseThemes = unique(matchSignalGroup(text, SIGNAL_RULES.praiseThemes))
  const featureRequests = unique(matchSignalGroup(text, SIGNAL_RULES.featureRequests))
  const pricingConcerns = unique(matchSignalGroup(text, SIGNAL_RULES.pricingConcerns))
  const mentorConcerns = unique(matchSignalGroup(text, SIGNAL_RULES.mentorConcerns))
  const placementConcerns = unique(matchSignalGroup(text, SIGNAL_RULES.placementConcerns))
  const curriculumConcerns = unique(matchSignalGroup(text, SIGNAL_RULES.curriculumConcerns))
  const buyingSignals = unique(matchSignalGroup(text, SIGNAL_RULES.buyingSignals))

  const painPoints = unique([
    ...complaintThemes,
    ...pricingConcerns,
    ...mentorConcerns,
    ...placementConcerns,
    ...curriculumConcerns,
  ])
  const opportunities = unique([...featureRequests, ...buyingSignals])

  return {
    sentiment,
    sentimentScore,
    categoryScores,
    extractedClaims: praiseThemes.map(theme => ({ theme, source: 'review_text' })),
    painPoints,
    opportunities,
    rawOutput: {
      analyzer: 'moat_rule_based_v1',
      complaint_themes: complaintThemes,
      praise_themes: praiseThemes,
      feature_requests: featureRequests,
      pricing_concerns: pricingConcerns,
      mentor_concerns: mentorConcerns,
      placement_concerns: placementConcerns,
      curriculum_concerns: curriculumConcerns,
      buying_signals: buyingSignals,
      categories: Object.keys(categoryScores),
    },
  }
}

function increment(map, key, evidence) {
  if (!key) return
  if (!map.has(key)) map.set(key, { label: key, count: 0, evidence: [] })
  const item = map.get(key)
  item.count += 1
  if (evidence && item.evidence.length < 5) item.evidence.push(evidence)
}

function topItems(map, limit = 5) {
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit)
}

function titleList(items) {
  return items.map(item => item.label).join(', ') || 'No strong signal yet'
}

function buildInsight({ competitorId, type, title, summary, evidence, confidence }) {
  return {
    competitor_id: competitorId,
    insight_type: type,
    title,
    summary,
    evidence: evidence || [],
    confidence,
    status: 'active',
    valid_from: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function aggregateCompetitorInsights(competitorId, rows) {
  const complaints = new Map()
  const praises = new Map()
  const improvements = new Map()
  const strengths = new Map()
  const weaknesses = new Map()
  const emerging = new Map()
  const sentiment = { positive: 0, neutral: 0, negative: 0 }

  rows.forEach(row => {
    const output = row.raw_output || {}
    const evidence = {
      review_id: row.review_id,
      sentiment: row.sentiment,
      reviewed_at: row.review?.reviewed_at || null,
      excerpt: String(row.review?.review_text || '').slice(0, 220),
    }
    sentiment[row.sentiment] = (sentiment[row.sentiment] || 0) + 1
    ;(output.complaint_themes || []).forEach(theme => increment(complaints, theme, evidence))
    ;(output.praise_themes || []).forEach(theme => {
      increment(praises, theme, evidence)
      increment(strengths, theme, evidence)
    })
    ;(output.feature_requests || []).forEach(theme => {
      increment(improvements, theme, evidence)
      increment(emerging, theme, evidence)
    })
    ;(output.buying_signals || []).forEach(theme => increment(strengths, theme, evidence))
    ;(output.pricing_concerns || []).forEach(theme => increment(weaknesses, theme, evidence))
    ;(output.mentor_concerns || []).forEach(theme => increment(weaknesses, theme, evidence))
    ;(output.placement_concerns || []).forEach(theme => increment(weaknesses, theme, evidence))
    ;(output.curriculum_concerns || []).forEach(theme => increment(weaknesses, theme, evidence))
  })

  const topComplaints = topItems(complaints)
  const topPraises = topItems(praises)
  const topImprovements = topItems(improvements)
  const topStrengths = topItems(strengths)
  const topWeaknesses = topItems(weaknesses)
  const topEmerging = topItems(emerging)
  const total = rows.length

  return [
    buildInsight({
      competitorId,
      type: 'top_complaints',
      title: 'Top complaints',
      summary: titleList(topComplaints),
      evidence: topComplaints,
      confidence: total ? Math.min(1, topComplaints.length / Math.max(3, total)) : 0,
    }),
    buildInsight({
      competitorId,
      type: 'top_praises',
      title: 'Top praises',
      summary: titleList(topPraises),
      evidence: topPraises,
      confidence: total ? Math.min(1, topPraises.length / Math.max(3, total)) : 0,
    }),
    buildInsight({
      competitorId,
      type: 'requested_improvements',
      title: 'Most requested improvements',
      summary: titleList(topImprovements),
      evidence: topImprovements,
      confidence: total ? Math.min(1, topImprovements.length / Math.max(3, total)) : 0,
    }),
    buildInsight({
      competitorId,
      type: 'mentioned_strengths',
      title: 'Most mentioned strengths',
      summary: titleList(topStrengths),
      evidence: topStrengths,
      confidence: total ? Math.min(1, topStrengths.length / Math.max(3, total)) : 0,
    }),
    buildInsight({
      competitorId,
      type: 'sentiment_distribution',
      title: 'Sentiment distribution',
      summary: `${sentiment.positive} positive, ${sentiment.neutral} neutral, ${sentiment.negative} negative`,
      evidence: [{ ...sentiment, total }],
      confidence: total ? 0.9 : 0,
    }),
    buildInsight({
      competitorId,
      type: 'review_volume',
      title: 'Review volume',
      summary: `${total} analyzed reviews in the current Moat dataset`,
      evidence: [{ total_reviews: total }],
      confidence: total ? 0.95 : 0,
    }),
    buildInsight({
      competitorId,
      type: 'emerging_themes',
      title: 'Emerging themes',
      summary: titleList(topEmerging),
      evidence: topEmerging,
      confidence: total ? Math.min(1, topEmerging.length / Math.max(3, total)) : 0,
    }),
    buildInsight({
      competitorId,
      type: 'competitor_strengths',
      title: 'Competitor strengths',
      summary: titleList(topStrengths),
      evidence: topStrengths,
      confidence: total ? Math.min(1, topStrengths.length / Math.max(3, total)) : 0,
    }),
    buildInsight({
      competitorId,
      type: 'competitor_weaknesses',
      title: 'Competitor weaknesses',
      summary: titleList(topWeaknesses.length ? topWeaknesses : topComplaints),
      evidence: topWeaknesses.length ? topWeaknesses : topComplaints,
      confidence: total ? Math.min(1, (topWeaknesses.length || topComplaints.length) / Math.max(3, total)) : 0,
    }),
  ]
}

export async function seedReviewCategories() {
  const { data, error } = await getSupabaseAdmin()
    .from('review_categories')
    .upsert(REVIEW_CATEGORIES.map(category => ({ ...category, is_active: true, updated_at: new Date().toISOString() })), {
      onConflict: 'category_key',
    })
    .select('id, category_key, label, sort_order, is_active')

  if (error) throw error
  return data || []
}

async function fetchReviewBatch(batchSize) {
  const supabase = getSupabaseAdmin()
  const { data: existing, error: existingError } = await supabase
    .from('review_analysis')
    .select('review_id')
    .in('status', ['pending', 'processing', 'ready', 'failed'])
    .limit(10000)
  if (existingError) throw existingError

  const analyzedIds = new Set((existing || []).map(row => row.review_id))
  const { data: reviews, error } = await supabase
    .from('competitor_reviews')
    .select('id, competitor_id, source_id, rating, review_text, reviewed_at, collected_at, competitors(id, name), review_sources(id, source_type, source_name)')
    .order('collected_at', { ascending: true })
    .limit(500)
  if (error) throw error

  const allReviews = reviews || []
  return {
    reviews: allReviews.filter(review => !analyzedIds.has(review.id)).slice(0, batchSize),
    skipped: allReviews.filter(review => analyzedIds.has(review.id)).length,
  }
}

async function insertReviewAnalyses(reviews) {
  if (reviews.length === 0) return []

  const rows = reviews.map(review => {
    const analysis = analyzeReviewText(review)
    return {
      review_id: review.id,
      review_collected_at: review.collected_at,
      prompt_version_id: null,
      sentiment: analysis.sentiment,
      sentiment_score: analysis.sentimentScore,
      category_scores: analysis.categoryScores,
      extracted_claims: analysis.extractedClaims,
      pain_points: analysis.painPoints,
      opportunities: analysis.opportunities,
      raw_output: analysis.rawOutput,
      status: 'ready',
      error_message: null,
      analyzed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
  })

  const { data, error } = await getSupabaseAdmin()
    .from('review_analysis')
    .insert(rows)
    .select('id, review_id, review_collected_at, sentiment, sentiment_score, category_scores, raw_output, status, analyzed_at')
  if (error) throw error
  return data || []
}

async function loadReadyAnalysesWithReviews() {
  const supabase = getSupabaseAdmin()
  const { data: analyses, error: analysisError } = await supabase
    .from('review_analysis')
    .select('id, review_id, review_collected_at, sentiment, sentiment_score, category_scores, raw_output, status, analyzed_at')
    .eq('status', 'ready')
    .limit(10000)
  if (analysisError) throw analysisError

  const reviewIds = unique((analyses || []).map(row => row.review_id))
  if (reviewIds.length === 0) return []

  const reviews = await selectRowsByIds(
    supabase,
    'competitor_reviews',
    'id, competitor_id, source_id, rating, review_text, reviewed_at, collected_at, competitors(id, name)',
    reviewIds
  )

  const reviewById = new Map((reviews || []).map(review => [review.id, review]))
  return (analyses || []).map(analysis => ({ ...analysis, review: reviewById.get(analysis.review_id) })).filter(row => row.review)
}

export async function generateCompetitorInsightSnapshots() {
  const supabase = getSupabaseAdmin()
  const rows = await loadReadyAnalysesWithReviews()
  const byCompetitor = new Map()

  rows.forEach(row => {
    const competitorId = row.review?.competitor_id
    if (!competitorId) return
    if (!byCompetitor.has(competitorId)) byCompetitor.set(competitorId, [])
    byCompetitor.get(competitorId).push(row)
  })

  const insights = []
  for (const [competitorId, competitorRows] of byCompetitor.entries()) {
    await supabase
      .from('competitor_insights')
      .update({ status: 'archived', valid_until: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('competitor_id', competitorId)
      .eq('status', 'active')
      .in('insight_type', GENERATED_INSIGHT_TYPES)

    insights.push(...aggregateCompetitorInsights(competitorId, competitorRows))
  }

  if (insights.length === 0) return []
  const { data, error } = await supabase
    .from('competitor_insights')
    .insert(insights)
    .select('id, competitor_id, insight_type, title, summary, evidence, confidence, status, created_at')
  if (error) throw error
  return data || []
}

export async function analyzeMoatReviews({ batchSize = 25 } = {}) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 25, 50))
  await seedReviewCategories()
  const { reviews, skipped } = await fetchReviewBatch(safeBatchSize)
  const analyses = await insertReviewAnalyses(reviews)
  const insights = await generateCompetitorInsightSnapshots()

  return {
    processed: analyses.length,
    skipped,
    failed: 0,
    insights_created: insights.length,
    sample_analysis: analyses[0] || null,
    sample_insight: insights[0] || null,
  }
}

export async function loadMoatInsights() {
  const supabase = getSupabaseAdmin()
  const [analysisResult, insightsResult, categoriesResult] = await Promise.all([
    supabase
      .from('review_analysis')
      .select('review_id, sentiment, status')
      .eq('status', 'ready')
      .limit(10000),
    supabase
      .from('competitor_insights')
      .select('id, competitor_id, insight_type, title, summary, evidence, confidence, status, created_at, competitors(id, name)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('review_categories')
      .select('id, category_key, label, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (analysisResult.error) throw analysisResult.error
  if (insightsResult.error) throw insightsResult.error
  if (categoriesResult.error) throw categoriesResult.error

  const analyses = analysisResult.data || []
  const reviewIds = unique(analyses.map(row => row.review_id))
  let competitorsAnalyzed = 0
  if (reviewIds.length > 0) {
    const reviews = await selectRowsByIds(supabase, 'competitor_reviews', 'id, competitor_id', reviewIds)
    competitorsAnalyzed = new Set((reviews || []).map(row => row.competitor_id).filter(Boolean)).size
  }

  const metrics = {
    reviews_analyzed: analyses.length,
    positive_reviews: analyses.filter(row => row.sentiment === 'positive').length,
    negative_reviews: analyses.filter(row => row.sentiment === 'negative').length,
    competitors_analyzed: competitorsAnalyzed,
  }

  const sections = {
    top_complaints: [],
    top_praises: [],
    emerging_themes: [],
    competitor_strengths: [],
    competitor_weaknesses: [],
  }

  ;(insightsResult.data || []).forEach(row => {
    if (!sections[row.insight_type]) return
    const evidence = row.evidence || []
    const evidenceCount = Array.isArray(evidence)
      ? evidence.reduce((sum, item) => sum + (Number(item?.count || item?.total || item?.evidence_count || 1) || 1), 0)
      : 0
    sections[row.insight_type].push({
      id: row.id,
      competitor: row.competitors?.name || 'Unknown competitor',
      title: row.title,
      summary: row.summary,
      evidence,
      evidence_count: evidenceCount,
      trend: evidenceCount >= 5 ? 'Rising' : evidenceCount > 0 ? 'Stable' : 'New',
      confidence: row.confidence,
      last_updated: row.created_at,
      created_at: row.created_at,
    })
  })

  return {
    metrics,
    sections,
    categories: categoriesResult.data || [],
    insights: insightsResult.data || [],
  }
}
