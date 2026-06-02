import { AI_EVALUATION_SCHEMA_VERSION } from './constants'

const LEGACY_EVALUATION_SCHEMA_VERSION = 1
const MAX_FEEDBACK_LINES = 8
const BANNED_HEADING_PATTERN = /^#{1,6}\s+|^\s*[-*\u2022]\s+|^(what you did well|gaps|suggestions|summary|rubric|topic alignment)/i
const GENERIC_PRAISE_PATTERN = /\b(great job|excellent work|overall|in conclusion|demonstrates understanding|well done)\b/gi
const REVIEW_PRIORITIES = new Set(['low', 'medium', 'high'])
const CONCEPT_MASTERY_LEVELS = new Set(['secure', 'developing', 'weak', 'not_observable'])
const LOGIC_QUALITY_LEVELS = new Set(['strong', 'adequate', 'fragile', 'missing'])
const CODE_QUALITY_LEVELS = new Set(['strong', 'adequate', 'needs_cleanup', 'not_observable'])
const VALID_FLAGS = new Set([
  'incomplete',
  'placeholder',
  'copied',
  'off_topic',
  'unsupported_file',
  'needs_manual_review',
  'low_confidence',
  'insufficient_evidence',
  'possible_placeholder_solution',
])

/**
 * Parse provider JSON evaluation and render concise trainer-style ai_feedback.
 * ai_evaluation may evolve over time; ai_feedback remains plain text for the
 * existing teacher review/edit/approval workflow.
 */
export function parseEvaluationResponse(rawText) {
  const trimmed = String(rawText || '').trim()
  if (!trimmed) {
    throw new Error('Empty AI response')
  }

  const jsonText = extractJsonPayload(trimmed)
  const evaluation = parseStrictEvaluationJson(jsonText)

  normalizeEvaluation(evaluation)
  validateEvaluationShape(evaluation)
  applyScoringSafeguards(evaluation)
  const draft = renderTrainerFeedback(evaluation)
  return { evaluation, draft }
}

function parseStrictEvaluationJson(jsonText) {
  if (!looksLikeJsonObject(jsonText)) {
    throw new Error('AI response did not contain a JSON object')
  }

  let evaluation
  try {
    evaluation = JSON.parse(jsonText)
  } catch {
    throw new Error('AI response was not valid JSON')
  }

  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    throw new Error('AI response JSON must be an object')
  }

  return evaluation
}

function normalizeEvaluation(evaluation) {
  evaluation.validation_notes = []
  evaluation.schema_version = normalizeSchemaVersion(evaluation.schema_version)
  evaluation.max_score = 10
  evaluation.rubric = normalizeRubric(evaluation.rubric)
  evaluation.confidence = clampNumber(evaluation.confidence ?? 0.5, 0, 1)
  evaluation.flags = normalizeFlags(evaluation.flags)
  evaluation.strengths = normalizeStringArray(evaluation.strengths, 2)
  evaluation.improvements = normalizeStringArray(
    evaluation.improvements?.length ? evaluation.improvements : evaluation.gaps || evaluation.suggestions,
    2
  )
  evaluation.evidence = normalizeStringArray(evaluation.evidence, 3)
  evaluation.topic_alignment = normalizeString(evaluation.topic_alignment)
  evaluation.trainer_feedback = normalizeString(evaluation.trainer_feedback)

  normalizeOptionalEvaluationFields(evaluation)
  normalizeConfidenceFlags(evaluation)
}

function normalizeSchemaVersion(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return LEGACY_EVALUATION_SCHEMA_VERSION
  }
  return Math.min(Math.trunc(parsed), AI_EVALUATION_SCHEMA_VERSION)
}

function normalizeRubric(value) {
  const rubric = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    correctness: clampNumber(rubric.correctness, 0, 4),
    style: clampNumber(rubric.style, 0, 3),
    concepts: clampNumber(rubric.concepts, 0, 3),
  }
}

function normalizeOptionalEvaluationFields(evaluation) {
  // Optional v2 fields are normalized into safe shapes so old rows, partial
  // model output, and malformed additions can coexist in the same JSONB column.
  evaluation.concept_mastery = normalizeConceptMastery(evaluation.concept_mastery)
  evaluation.logic_quality = normalizeLogicQuality(evaluation.logic_quality)
  evaluation.code_quality = normalizeCodeQuality(evaluation.code_quality)
  evaluation.mistake_patterns = normalizeStringArray(evaluation.mistake_patterns, 4)
  evaluation.learning_gaps = normalizeStringArray(evaluation.learning_gaps, 4)
  evaluation.review_priority = normalizeEnum(evaluation.review_priority, REVIEW_PRIORITIES, 'medium')
  evaluation.confidence_reasoning = normalizeString(evaluation.confidence_reasoning)
}

function normalizeConceptMastery(value) {
  const input = objectOrEmpty(value)
  return {
    level: normalizeEnum(input.level, CONCEPT_MASTERY_LEVELS, 'not_observable'),
    concepts_understood: normalizeStringArray(input.concepts_understood, 4),
    concepts_to_revisit: normalizeStringArray(input.concepts_to_revisit, 4),
  }
}

function normalizeLogicQuality(value) {
  const input = objectOrEmpty(value)
  return {
    level: normalizeEnum(input.level, LOGIC_QUALITY_LEVELS, 'missing'),
    reasoning: normalizeString(input.reasoning),
  }
}

function normalizeCodeQuality(value) {
  const input = objectOrEmpty(value)
  return {
    level: normalizeEnum(input.level, CODE_QUALITY_LEVELS, 'not_observable'),
    observations: normalizeStringArray(input.observations, 4),
  }
}

function normalizeConfidenceFlags(evaluation) {
  const flags = new Set(evaluation.flags)

  if (evaluation.confidence <= 0.35) {
    flags.add('low_confidence')
  }

  if (!evaluation.evidence.length) {
    flags.add('insufficient_evidence')
  }

  if (flags.has('unsupported_file')) {
    flags.add('needs_manual_review')
  }

  evaluation.flags = [...flags].filter(flag => VALID_FLAGS.has(flag))
}

function validateEvaluationShape(evaluation) {
  evaluation.score = clampNumber(evaluation.score, 0, 10)
  evaluation.max_score = 10

  const rubricScore = clampNumber(
    evaluation.rubric.correctness + evaluation.rubric.style + evaluation.rubric.concepts,
    0,
    10
  )
  const delta = Math.abs(evaluation.score - rubricScore)
  if (delta > 0.5) {
    evaluation.validation_notes.push(
      `Score adjusted from ${evaluation.score}/10 to rubric total ${rubricScore}/10.`
    )
  }
  evaluation.score = rubricScore
}

function applyScoringSafeguards(evaluation) {
  // These are the existing visible grading protections, kept separate from
  // normalization so new internal diagnostics do not unexpectedly rewrite flow.
  const flags = new Set(evaluation.flags)

  if (flags.has('unsupported_file') || flags.has('needs_manual_review')) {
    capScore(evaluation, 2, 'Manual review/unsupported file cap applied.')
    evaluation.confidence = Math.min(evaluation.confidence, 0.35)
  }

  if (flags.has('placeholder') || flags.has('copied')) {
    capScore(evaluation, 3, 'Placeholder/copied submission cap applied.')
    evaluation.confidence = Math.min(evaluation.confidence, 0.55)
  }

  if (flags.has('incomplete')) {
    evaluation.rubric.correctness = Math.min(evaluation.rubric.correctness, 1)
    capScore(
      evaluation,
      Math.min(5, evaluation.rubric.correctness + evaluation.rubric.style + evaluation.rubric.concepts),
      'Incomplete solution cap applied.'
    )
  }

  if (!evaluation.evidence.length && evaluation.score > 6) {
    capScore(evaluation, 6, 'High score capped because evidence is missing.')
    evaluation.confidence = Math.min(evaluation.confidence, 0.6)
  }

  normalizeConfidenceFlags(evaluation)
}

function capScore(evaluation, maxScore, note) {
  if (evaluation.score <= maxScore) return
  evaluation.score = maxScore
  const overflow = evaluation.rubric.correctness + evaluation.rubric.style + evaluation.rubric.concepts - maxScore
  if (overflow > 0) {
    evaluation.rubric.correctness = Math.max(0, evaluation.rubric.correctness - overflow)
  }
  evaluation.validation_notes.push(note)
}

/**
 * Visible feedback: natural trainer voice only. Rubric, evidence, confidence,
 * and schema metadata stay inside ai_evaluation for future trainer tooling.
 */
export function renderTrainerFeedback(evaluation) {
  const fromModel = sanitizeFeedbackText(evaluation.trainer_feedback)
  if (fromModel) {
    return trimToMaxLines(alignFeedbackScore(fromModel, evaluation), MAX_FEEDBACK_LINES)
  }
  return trimToMaxLines(composeFallbackFeedback(evaluation), MAX_FEEDBACK_LINES)
}

function composeFallbackFeedback(evaluation) {
  const score = evaluation.score
  const max = evaluation.max_score ?? 10
  const lines = [`${score}/${max} - ${openingByScore(score, evaluation.flags)}`]

  if (evaluation.evidence[0]) {
    lines.push(evaluation.evidence[0])
  } else if (evaluation.strengths[0] && score >= 4) {
    lines.push(evaluation.strengths[0])
  }

  const improvements = evaluation.improvements.filter(Boolean)
  if (improvements.length === 2) {
    lines.push(`${improvements[0].trim()} Also, ${lowerFirst(improvements[1].trim())}`)
  } else if (improvements.length === 1) {
    lines.push(improvements[0].trim())
  }

  if (lines.length < 3 && evaluation.topic_alignment?.trim()) {
    lines.push(evaluation.topic_alignment.trim())
  }

  return lines.join('\n')
}

function openingByScore(score, flags) {
  if (flags.includes('needs_manual_review') || flags.includes('unsupported_file')) {
    return 'Your code is not clearly visible in the uploaded file, so the logic could not be reviewed properly.'
  }
  if (flags.includes('placeholder') || flags.includes('copied')) {
    return 'This submission looks too incomplete or template-like to award many marks yet.'
  }
  if (score <= 3) return 'The solution needs more work before it meets the assignment requirements.'
  if (score <= 6) return 'The submission has some usable parts, but important gaps still need fixing.'
  return 'The submission is mostly on track, with a few specific fixes needed.'
}

function sanitizeFeedbackText(text) {
  if (!text?.trim()) return ''

  const lines = text
    .replace(GENERIC_PRAISE_PATTERN, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !BANNED_HEADING_PATTERN.test(line))
    .map(line => line.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, ''))

  return lines.join('\n').trim()
}

function alignFeedbackScore(text, evaluation) {
  const scorePrefix = `${evaluation.score}/${evaluation.max_score ?? 10} -`
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  if (!lines.length) return text

  if (/^\d+(?:\.\d+)?\s*\/\s*10\s*[-\u2014]/.test(lines[0])) {
    lines[0] = lines[0].replace(/^\d+(?:\.\d+)?\s*\/\s*10\s*[-\u2014]\s*/, scorePrefix + ' ')
  } else {
    lines[0] = `${scorePrefix} ${lines[0]}`
  }

  return lines.join('\n')
}

function trimToMaxLines(text, maxLines) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.slice(0, maxLines).join('\n')
}

/** Pull JSON object from raw model text (fenced, wrapped, or plain). */
function extractJsonPayload(text) {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

function looksLikeJsonObject(text) {
  const trimmed = String(text || '').trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

function clampNumber(value, min, max) {
  const n = Number(value)
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, Number(n.toFixed(2))))
}

function normalizeStringArray(value, limit) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, limit)
    : []
}

function normalizeFlags(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(flag => String(flag || '').trim()).filter(flag => VALID_FLAGS.has(flag)))]
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeString(value).toLowerCase()
  return allowed.has(normalized) ? normalized : fallback
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function lowerFirst(text) {
  return text.replace(/^[A-Z]/, c => c.toLowerCase())
}
