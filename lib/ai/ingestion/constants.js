import { DEFAULT_PHASE } from '../constants.js'

/** ConsoleFlare PDA GitBook — Python Documents index (.md) */
export const DEFAULT_GITBOOK_PYTHON_INDEX_URL =
  'https://pda-assignments.consoleflare.com/python-for-data-analytics/1.python/1.python-documents.md'

/** ConsoleFlare PDA GitBook Data Analytics / Pandas index (.md) */
export const DEFAULT_GITBOOK_DATA_ANALYTICS_INDEX_URL =
  'https://consoleflare-1.gitbook.io/data-analytics-and-data-science-assignments/python-for-data-analytics/2.-data-analytics.md'

export const DEFAULT_GITBOOK_INDEX_URLS = [
  DEFAULT_GITBOOK_PYTHON_INDEX_URL,
  DEFAULT_GITBOOK_DATA_ANALYTICS_INDEX_URL,
]

export const GITBOOK_INGEST_UPDATED_BY = 'gitbook-ingest'
export const GITBOOK_DEFAULT_PHASE = DEFAULT_PHASE
export const FETCH_TIMEOUT_MS = 30_000
export const FETCH_USER_AGENT = 'ConsoleFlare-Portal/1.0 (curriculum-ingest)'

/** Minimum content length for a chunk to be stored */
export const MIN_CHUNK_CONTENT_LENGTH = 40
