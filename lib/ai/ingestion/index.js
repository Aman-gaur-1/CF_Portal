export {
  DEFAULT_GITBOOK_PYTHON_INDEX_URL,
  GITBOOK_INGEST_UPDATED_BY,
  GITBOOK_DEFAULT_PHASE,
} from './constants.js'

export { fetchText, mdUrlToPageUrl } from './gitbook-fetch.js'

export {
  parseIndexMarkdown,
  normalizeTopicLabel,
  stripGitBookBoilerplate,
  splitPageIntoSections,
  buildChunkRecords,
} from './gitbook-parse.js'

export { upsertChunk, upsertChunks, pruneOrphanedGitBookChunks } from './curriculum-upsert.js'

export { ingestGitBookPythonCurriculum } from './gitbook-ingest.js'
