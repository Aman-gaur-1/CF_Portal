import { DEFAULT_PHASE, RETRIEVAL_CHUNK_LIMIT, RETRIEVAL_MIN_CHUNKS } from './constants'

function normalizeTopic(topic) {
  if (!topic || typeof topic !== 'string') return ''
  return topic.trim()
}

function topicMatchesChunk(submissionTopic, chunkTopic) {
  if (!chunkTopic) return true
  if (!submissionTopic) return false
  const a = submissionTopic.toLowerCase()
  const b = chunkTopic.toLowerCase()
  return a === b || a.includes(b) || b.includes(a)
}

function rankChunks(chunks, submissionTopic) {
  return [...chunks].sort((a, b) => {
    const aTopic = topicMatchesChunk(submissionTopic, a.topic) ? 0 : 1
    const bTopic = topicMatchesChunk(submissionTopic, b.topic) ? 0 : 1
    if (aTopic !== bTopic) return aTopic - bTopic
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
        topic: submissionTopic || null,
        total_phase_chunks: 0,
        topic_specific_chunks: 0,
        general_chunks: 0,
        selected_chunks: 0,
        used_fallback: false,
        chunk_titles: [],
      },
    }
  }

  const topicSpecific = submissionTopic
    ? all.filter(c => c.topic && topicMatchesChunk(submissionTopic, c.topic))
    : []

  const general = all.filter(c => !c.topic)

  let selected = rankChunks(
    [...new Map([...topicSpecific, ...general].map(c => [c.id, c])).values()],
    submissionTopic
  ).slice(0, limit)

  let usedFallback = false
  if (selected.length < RETRIEVAL_MIN_CHUNKS) {
    selected = rankChunks(all, submissionTopic).slice(0, limit)
    usedFallback = true
  }

  const latest = selected.reduce((max, c) => {
    const t = c.updated_at ? new Date(c.updated_at).getTime() : 0
    return t > max ? t : max
  }, 0)

  const ragVersion = latest ? new Date(latest).toISOString() : null

  return {
    chunks: selected,
    ragVersion,
    diagnostics: {
      phase: resolvedPhase,
      topic: submissionTopic || null,
      total_phase_chunks: all.length,
      topic_specific_chunks: topicSpecific.length,
      general_chunks: general.length,
      selected_chunks: selected.length,
      used_fallback: usedFallback,
      chunk_titles: selected.map(c => c.title).filter(Boolean).slice(0, limit),
      rag_version: ragVersion,
    },
  }
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
