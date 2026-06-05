import { fetchText } from './gitbook-fetch.js'
import {
  parseIndexMarkdown,
  splitPageIntoSections,
  buildChunkRecords,
} from './gitbook-parse.js'
import { upsertChunks, pruneOrphanedGitBookChunks } from './curriculum-upsert.js'
import {
  DEFAULT_GITBOOK_INDEX_URLS,
  GITBOOK_INGEST_UPDATED_BY,
  GITBOOK_DEFAULT_PHASE,
} from './constants.js'

/**
 * Ingest ConsoleFlare GitBook curriculum into curriculum_chunks.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} [options]
 * @param {string} [options.indexUrl]
 * @param {string[]|string} [options.indexUrls]
 * @param {string} [options.phase]
 * @param {string} [options.updatedBy]
 * @param {boolean} [options.pruneOrphans]
 */
export async function ingestGitBookPythonCurriculum(supabase, options = {}) {
  const indexUrls = resolveIndexUrls(options)
  const phase = options.phase || GITBOOK_DEFAULT_PHASE
  const updatedBy = options.updatedBy || GITBOOK_INGEST_UPDATED_BY
  const pruneOrphans = options.pruneOrphans !== false

  const report = {
    indexUrl: indexUrls[0] || null,
    indexUrls,
    phase,
    topicsDiscovered: 0,
    topicsFetched: 0,
    chunksBuilt: 0,
    upsert: { inserted: 0, updated: 0, skipped: 0, errors: [] },
    pruned: 0,
    topicErrors: [],
    indexes: [],
  }

  const allChunks = []
  const activeSourceUrls = new Set()

  for (const [indexPosition, indexUrl] of indexUrls.entries()) {
    const indexReport = {
      indexUrl,
      topicsDiscovered: 0,
      topicsFetched: 0,
      chunksBuilt: 0,
      topicErrors: [],
    }

    const indexMarkdown = await fetchText(indexUrl)
    const topics = parseIndexMarkdown(indexMarkdown)
    indexReport.topicsDiscovered = topics.length
    report.topicsDiscovered += topics.length

    if (!topics.length) {
      throw new Error(`No topic links found in GitBook index: ${indexUrl}`)
    }

    for (const topicEntry of topics) {
      try {
        const pageMarkdown = await fetchText(topicEntry.mdUrl)
        report.topicsFetched++
        indexReport.topicsFetched++

        const sections = splitPageIntoSections(pageMarkdown, topicEntry.topic)
        const records = buildChunkRecords({
          topicEntry,
          sections,
          phase,
          updatedBy,
        }).map(record => ({
          ...record,
          sort_order: record.sort_order + indexPosition * 10_000,
        }))

        indexReport.chunksBuilt += records.length
        for (const record of records) {
          allChunks.push(record)
          activeSourceUrls.add(record.source_url)
        }
      } catch (err) {
        const topicError = {
          indexUrl,
          topic: topicEntry.topic,
          mdUrl: topicEntry.mdUrl,
          message: err.message,
        }
        report.topicErrors.push(topicError)
        indexReport.topicErrors.push(topicError)
      }
    }

    report.indexes.push(indexReport)
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

function resolveIndexUrls(options) {
  const input = Array.isArray(options.indexUrls)
    ? options.indexUrls
    : typeof options.indexUrls === 'string'
      ? splitIndexUrls(options.indexUrls)
      : options.indexUrl
        ? [options.indexUrl]
        : DEFAULT_GITBOOK_INDEX_URLS

  const cleaned = input
    .map(normalizeIndexUrl)
    .filter(Boolean)

  return [...new Set(cleaned)]
}

function splitIndexUrls(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
}

function normalizeIndexUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  return /\.md(?:[?#].*)?$/i.test(url) ? url : `${url.replace(/\/$/, '')}.md`
}
