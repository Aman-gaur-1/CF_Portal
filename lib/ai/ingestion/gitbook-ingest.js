import { fetchText } from './gitbook-fetch.js'
import {
  parseIndexMarkdown,
  splitPageIntoSections,
  buildChunkRecords,
} from './gitbook-parse.js'
import { upsertChunks, pruneOrphanedGitBookChunks } from './curriculum-upsert.js'
import {
  DEFAULT_GITBOOK_PYTHON_INDEX_URL,
  GITBOOK_INGEST_UPDATED_BY,
  GITBOOK_DEFAULT_PHASE,
} from './constants.js'

/**
 * Ingest ConsoleFlare GitBook Python Documents into curriculum_chunks.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} [options]
 * @param {string} [options.indexUrl]
 * @param {string} [options.phase]
 * @param {string} [options.updatedBy]
 * @param {boolean} [options.pruneOrphans]
 */
export async function ingestGitBookPythonCurriculum(supabase, options = {}) {
  const indexUrl = options.indexUrl || DEFAULT_GITBOOK_PYTHON_INDEX_URL
  const phase = options.phase || GITBOOK_DEFAULT_PHASE
  const updatedBy = options.updatedBy || GITBOOK_INGEST_UPDATED_BY
  const pruneOrphans = options.pruneOrphans !== false

  const report = {
    indexUrl,
    phase,
    topicsDiscovered: 0,
    topicsFetched: 0,
    chunksBuilt: 0,
    upsert: { inserted: 0, updated: 0, skipped: 0, errors: [] },
    pruned: 0,
    topicErrors: [],
  }

  const indexMarkdown = await fetchText(indexUrl)
  const topics = parseIndexMarkdown(indexMarkdown)
  report.topicsDiscovered = topics.length

  if (!topics.length) {
    throw new Error('No topic links found in GitBook index — check index URL or format.')
  }

  const allChunks = []
  const activeSourceUrls = new Set()

  for (const topicEntry of topics) {
    try {
      const pageMarkdown = await fetchText(topicEntry.mdUrl)
      report.topicsFetched++

      const sections = splitPageIntoSections(pageMarkdown, topicEntry.topic)
      const records = buildChunkRecords({
        topicEntry,
        sections,
        phase,
        updatedBy,
      })

      for (const record of records) {
        allChunks.push(record)
        activeSourceUrls.add(record.source_url)
      }
    } catch (err) {
      report.topicErrors.push({
        topic: topicEntry.topic,
        mdUrl: topicEntry.mdUrl,
        message: err.message,
      })
    }
  }

  report.chunksBuilt = allChunks.length

  if (!allChunks.length) {
    throw new Error('No curriculum chunks built from GitBook pages.')
  }

  report.upsert = await upsertChunks(supabase, allChunks)

  if (pruneOrphans) {
    const pruneResult = await pruneOrphanedGitBookChunks(supabase, {
      phase,
      updatedBy,
      activeSourceUrls: [...activeSourceUrls],
    })
    report.pruned = pruneResult.deleted
  }

  return report
}
