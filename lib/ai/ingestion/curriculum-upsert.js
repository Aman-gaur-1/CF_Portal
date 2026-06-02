/**
 * Idempotent curriculum chunk persistence (no duplicate source_url + title).
 */

export async function findExistingChunk(supabase, { source_url, title }) {
  const { data, error } = await supabase
    .from('curriculum_chunks')
    .select('id, content')
    .eq('source_url', source_url)
    .eq('title', title)
    .maybeSingle()

  if (error) {
    throw new Error(`Lookup failed for ${source_url}: ${error.message}`)
  }

  return data
}

/**
 * Upsert one chunk: skip if unchanged, update if content differs, insert if new.
 */
export async function upsertChunk(supabase, row) {
  const existing = await findExistingChunk(supabase, {
    source_url: row.source_url,
    title: row.title,
  })

  if (existing) {
    if (existing.content === row.content) {
      return { action: 'skipped', id: existing.id }
    }

    const { data, error } = await supabase
      .from('curriculum_chunks')
      .update({
        content: row.content,
        phase: row.phase,
        topic: row.topic,
        keywords: row.keywords,
        sort_order: row.sort_order,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      })
      .eq('id', existing.id)
      .select('id')
      .single()

    if (error) throw new Error(`Update failed: ${error.message}`)
    return { action: 'updated', id: data.id }
  }

  const { data, error } = await supabase.from('curriculum_chunks').insert(row).select('id').single()

  if (error) {
    if (error.code === '23505') {
      return upsertChunk(supabase, row)
    }
    throw new Error(`Insert failed: ${error.message}`)
  }

  return { action: 'inserted', id: data.id }
}

/**
 * Batch upsert with per-chunk deduplication.
 */
export async function upsertChunks(supabase, rows) {
  const summary = { inserted: 0, updated: 0, skipped: 0, errors: [] }

  for (const row of rows) {
    try {
      const result = await upsertChunk(supabase, row)
      summary[result.action === 'inserted' ? 'inserted' : result.action === 'updated' ? 'updated' : 'skipped']++
    } catch (err) {
      summary.errors.push({ source_url: row.source_url, title: row.title, message: err.message })
    }
  }

  return summary
}

/**
 * Remove GitBook-ingested chunks for a phase that are no longer in the latest crawl.
 */
export async function pruneOrphanedGitBookChunks(supabase, { phase, updatedBy, activeSourceUrls }) {
  const { data: existing, error } = await supabase
    .from('curriculum_chunks')
    .select('id, source_url')
    .eq('phase', phase)
    .eq('updated_by', updatedBy)
    .not('source_url', 'is', null)

  if (error) {
    throw new Error(`Prune lookup failed: ${error.message}`)
  }

  const active = new Set(activeSourceUrls)
  const toDelete = (existing || []).filter(row => row.source_url && !active.has(row.source_url)).map(r => r.id)

  if (!toDelete.length) return { deleted: 0 }

  const { error: deleteError } = await supabase.from('curriculum_chunks').delete().in('id', toDelete)

  if (deleteError) {
    throw new Error(`Prune delete failed: ${deleteError.message}`)
  }

  return { deleted: toDelete.length }
}
