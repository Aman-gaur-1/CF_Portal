import { debugLog } from '@/lib/logger'
import { DEFAULT_PHASE, RETRIEVAL_CHUNK_LIMIT, RETRIEVAL_MIN_CHUNKS } from './constants'

const TOPIC_ALIASES = [
  {
    canonical: 'Pandas',
    terms: [
      'pandas',
      'dataframe',
      'dataframes',
      'series',
      'csv',
      'excel',
      'loading excel',
      'loading csv',
      'loading excel csv data',
      'loading excel and csv data',
      'data analysis with pandas',
    ],
  },
  {
    canonical: 'Numerical Computing with Python and Numpy',
    terms: ['numpy', 'np array', 'ndarray', 'numerical computing'],
  },
  {
    canonical: 'Data Types',
    terms: ['data types', 'datatype', 'datatypes', 'standard data types'],
  },
  {
    canonical: 'Variables In Python',
    terms: ['variables', 'variable'],
  },
  {
    canonical: 'Operators In Python',
    terms: ['operators', 'operator'],
  },
  {
    canonical: 'User Input In Python',
    terms: ['user input', 'input function', 'input'],
  },
  {
    canonical: 'TypeCasting In Python',
    terms: ['typecasting', 'type casting', 'casting'],
  },
  {
    canonical: 'Strings In Python',
    terms: ['strings', 'string'],
  },
  {
    canonical: 'Conditional Statements In Python',
    terms: ['conditional statements', 'conditionals', 'if else', 'if elif'],
  },
  {
    canonical: 'Branching using Conditional Statements and Loops in Python',
    terms: ['loops', 'looping', 'branching', 'for loop', 'while loop'],
  },
  {
    canonical: 'Lists In Python',
    terms: ['lists', 'list'],
  },
  {
    canonical: 'Sets In Python',
    terms: ['sets', 'set'],
  },
  {
    canonical: 'Tuples In Python',
    terms: ['tuples', 'tuple'],
  },
  {
    canonical: 'Dictionary In Python',
    terms: ['dictionary', 'dictionaries', 'dict'],
  },
  {
    canonical: 'Functions In Python',
    terms: ['functions', 'function', 'def'],
  },
  {
    canonical: 'File Handling In Python',
    terms: ['file handling', 'files', 'file io', 'read file', 'write file'],
  },
]

const GENERIC_TOPIC_WORDS = new Set([
  'assignment',
  'assignments',
  'task',
  'tasks',
  'project',
  'python',
  'phase',
  'topic',
  'class',
  'module',
  'lesson',
  'first',
  'second',
  'third',
  'data',
  'loading',
  'and',
  'with',
  'using',
  'intro',
  'introduction',
])

export function normalizeTopic(topic) {
  if (!topic || typeof topic !== 'string') {
    return {
      raw: topic || '',
      normalized: '',
      canonical: '',
      tokens: [],
    }
  }

  const raw = topic.trim()
  const normalized = normalizeTopicText(raw)
  const canonical = canonicalTopicFor(normalized)
  return {
    raw,
    normalized,
    canonical,
    tokens: topicTokens(normalized),
  }
}

function normalizeTopicText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\d+(st|nd|rd|th)?\b/gi, ' ')
    .replace(/\b(assignments?|tasks?|projects?)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function canonicalTopicFor(normalizedTopic) {
  if (!normalizedTopic) return ''

  for (const alias of TOPIC_ALIASES) {
    const canonicalNormalized = normalizeTopicText(alias.canonical)
    if (normalizedTopic === canonicalNormalized) return alias.canonical
    if (alias.terms.some(term => topicPhraseMatches(normalizedTopic, normalizeTopicText(term)))) {
      return alias.canonical
    }
  }

  return titleCaseTopic(normalizedTopic)
}

function topicPhraseMatches(normalizedTopic, normalizedTerm) {
  if (!normalizedTerm) return false
  return normalizedTopic === normalizedTerm || normalizedTopic.includes(normalizedTerm)
}

function titleCaseTopic(normalizedTopic) {
  return normalizedTopic
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function topicTokens(normalizedTopic) {
  return normalizedTopic
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 2 && !GENERIC_TOPIC_WORDS.has(token))
}

function chunkTopicProfile(chunkTopic) {
  return normalizeTopic(chunkTopic || '')
}

function topicMatchesChunk(submissionProfile, chunkTopic) {
  if (!chunkTopic || !submissionProfile?.normalized) return false
  const chunkProfile = chunkTopicProfile(chunkTopic)
  if (!chunkProfile.normalized) return false

  if (submissionProfile.canonical && chunkProfile.canonical && submissionProfile.canonical === chunkProfile.canonical) {
    return true
  }

  return submissionProfile.normalized === chunkProfile.normalized
}

function scoreChunkForTopic(chunk, submissionProfile) {
  if (!submissionProfile?.tokens?.length) return 0
  const haystack = normalizeTopicText([
    chunk.topic,
    chunk.title,
    Array.isArray(chunk.keywords) ? chunk.keywords.join(' ') : '',
    chunk.content?.slice(0, 1200),
  ].filter(Boolean).join(' '))
  if (!haystack) return 0

  let score = 0
  for (const token of submissionProfile.tokens) {
    if (haystack.includes(token)) score += token === 'pandas' ? 5 : 2
  }
  if (submissionProfile.canonical && haystack.includes(normalizeTopicText(submissionProfile.canonical))) score += 4
  return score
}

function rankChunks(chunks, submissionProfile) {
  return [...chunks].sort((a, b) => {
    const aTopic = topicMatchesChunk(submissionProfile, a.topic) ? 0 : 1
    const bTopic = topicMatchesChunk(submissionProfile, b.topic) ? 0 : 1
    if (aTopic !== bTopic) return aTopic - bTopic
    const scoreDiff = scoreChunkForTopic(b, submissionProfile) - scoreChunkForTopic(a, submissionProfile)
    if (scoreDiff !== 0) return scoreDiff
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
}

/**
 * Phase/topic-based retrieval only (no embeddings).
 */
export async function retrieveContext(supabase, { phase, topic, limit = RETRIEVAL_CHUNK_LIMIT }) {
  const resolvedPhase = phase || DEFAULT_PHASE
  const submissionTopic = normalizeTopic(topic)

  const { data: phaseRows, error } = await supabase
    .from('curriculum_chunks')
    .select('id, phase, topic, title, content, keywords, sort_order, updated_at')
    .eq('phase', resolvedPhase)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(`Curriculum retrieval failed: ${error.message}`)
  }

  const all = phaseRows || []
  if (!all.length) {
    return {
      chunks: [],
      ragVersion: null,
      diagnostics: {
        phase: resolvedPhase,
        topic: submissionTopic.raw || null,
        normalized_topic: submissionTopic.normalized || null,
        canonical_topic: submissionTopic.canonical || null,
        matched_curriculum_topic: null,
        fallback_reason: 'no_phase_chunks',
        total_phase_chunks: 0,
        topic_specific_chunks: 0,
        general_chunks: 0,
        selected_chunks: 0,
        used_fallback: false,
        chunk_titles: [],
      },
    }
  }

  const topicSpecific = submissionTopic.normalized
    ? all.filter(c => c.topic && topicMatchesChunk(submissionTopic, c.topic))
    : []

  const general = all.filter(c => !c.topic)
  const scoredFallback = topicSpecific.length
    ? []
    : rankChunks(
        all
          .filter(c => c.topic)
          .map(chunk => ({ chunk, score: scoreChunkForTopic(chunk, submissionTopic) }))
          .filter(item => item.score >= 4)
          .map(item => item.chunk),
        submissionTopic
      )

  let fallbackReason = null

  let selected = []
  if (topicSpecific.length) {
    selected = rankChunks(topicSpecific, submissionTopic).slice(0, limit)
    if (selected.length < RETRIEVAL_MIN_CHUNKS && general.length) {
      selected = uniqueChunks([...selected, ...general]).slice(0, limit)
      fallbackReason = 'topic_match_topped_up_with_general_context'
    }
  } else if (scoredFallback.length) {
    selected = scoredFallback.slice(0, limit)
    fallbackReason = 'semantic_topic_keyword_match'
  } else if (general.length) {
    selected = general.slice(0, Math.min(limit, RETRIEVAL_MIN_CHUNKS))
    fallbackReason = submissionTopic.normalized
      ? 'no_topic_match_general_context_only'
      : 'missing_submission_topic_general_context_only'
  }

  if (!selected.length && !submissionTopic.normalized) {
    selected = all.filter(c => !c.topic).slice(0, Math.min(limit, RETRIEVAL_MIN_CHUNKS))
    fallbackReason = 'missing_submission_topic_no_general_context'
  }

  const usedFallback = Boolean(fallbackReason)
  const matchedCurriculumTopics = [...new Set(selected.map(c => c.topic).filter(Boolean))]
  const matchedCurriculumTopic = topicSpecific.length
    ? matchedCurriculumTopics[0] || null
    : null

  const latest = selected.reduce((max, c) => {
    const t = c.updated_at ? new Date(c.updated_at).getTime() : 0
    return t > max ? t : max
  }, 0)

  const ragVersion = latest ? new Date(latest).toISOString() : null

  debugLog('[retrieval] curriculum grounding', {
    phase: resolvedPhase,
    extractedTopic: submissionTopic.raw || null,
    normalizedTopic: submissionTopic.normalized || null,
    canonicalTopic: submissionTopic.canonical || null,
    matchedCurriculumTopic,
    fallbackReason,
    selectedChunks: selected.map(chunk => ({
      id: chunk.id,
      topic: chunk.topic || null,
      title: chunk.title || null,
      score: scoreChunkForTopic(chunk, submissionTopic),
    })),
  })

  return {
    chunks: selected,
    ragVersion,
    diagnostics: {
      phase: resolvedPhase,
      topic: submissionTopic.raw || null,
      normalized_topic: submissionTopic.normalized || null,
      canonical_topic: submissionTopic.canonical || null,
      matched_curriculum_topic: matchedCurriculumTopic,
      matched_curriculum_topics: matchedCurriculumTopics,
      fallback_reason: fallbackReason,
      total_phase_chunks: all.length,
      topic_specific_chunks: topicSpecific.length,
      general_chunks: general.length,
      semantic_fallback_chunks: scoredFallback.length,
      selected_chunks: selected.length,
      used_fallback: usedFallback,
      chunk_titles: selected.map(c => c.title).filter(Boolean).slice(0, limit),
      selected_chunk_topics: selected.map(c => c.topic || null).slice(0, limit),
      rag_version: ragVersion,
    },
  }
}

function uniqueChunks(chunks) {
  return [...new Map(chunks.map(chunk => [chunk.id, chunk])).values()]
}

export function formatChunksForPrompt(chunks) {
  if (!chunks?.length) {
    return 'No reference curriculum chunks matched this phase/topic.'
  }

  return chunks
    .map((chunk, i) => {
      const label = chunk.topic ? `${chunk.title} (${chunk.topic})` : chunk.title
      return `### Chunk ${i + 1}: ${label}\n${chunk.content}`
    })
    .join('\n\n')
}
