import { DEFAULT_PHASE } from './constants'

/**
 * Split trainer reference document into chunks (## headings or paragraphs).
 */
export function splitTextIntoChunks(text) {
  const normalized = String(text || '').trim()
  if (!normalized) return []

  const sections = normalized.split(/\n(?=##\s+)/)
  const chunks = []

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('##')) {
      const lines = trimmed.split('\n')
      const title = lines[0].replace(/^##\s*/, '').trim() || 'Section'
      const content = lines.slice(1).join('\n').trim() || title
      chunks.push({ title, content })
    } else {
      const parts = trimmed.split(/\n\n+/).filter(Boolean)
      if (parts.length <= 1) {
        chunks.push({ title: 'Section', content: trimmed })
      } else {
        parts.forEach((part, i) => {
          chunks.push({ title: `Section ${i + 1}`, content: part.trim() })
        })
      }
    }
  }

  return chunks.length ? chunks : [{ title: 'General curriculum', content: normalized }]
}

/**
 * Replace phase-wide general chunks (topic IS NULL) from a single reference document.
 */
export async function syncGeneralCurriculumFromText(supabase, text, { phase = DEFAULT_PHASE, updatedBy = 'trainer' } = {}) {
  const parts = splitTextIntoChunks(text)

  const { error: deleteError } = await supabase
    .from('curriculum_chunks')
    .delete()
    .eq('phase', phase)
    .is('topic', null)

  if (deleteError) {
    throw new Error(`Failed to clear curriculum chunks: ${deleteError.message}`)
  }

  if (!parts.length) return []

  const rows = parts.map((part, index) => ({
    phase,
    topic: null,
    title: part.title,
    content: part.content,
    keywords: [],
    sort_order: index,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  }))

  const { data, error: insertError } = await supabase.from('curriculum_chunks').insert(rows).select('id')

  if (insertError) {
    throw new Error(`Failed to save curriculum chunks: ${insertError.message}`)
  }

  return data || []
}

/**
 * Aggregate general chunks into the legacy { text } shape for the trainer UI.
 */
export async function loadGeneralCurriculumText(supabase, { phase = DEFAULT_PHASE } = {}) {
  const { data, error } = await supabase
    .from('curriculum_chunks')
    .select('title, content, sort_order')
    .eq('phase', phase)
    .is('topic', null)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(`Failed to load curriculum: ${error.message}`)
  }

  if (!data?.length) return ''

  return data
    .map(row => (row.title && row.title !== 'Section' ? `## ${row.title}\n\n${row.content}` : row.content))
    .join('\n\n')
    .trim()
}
