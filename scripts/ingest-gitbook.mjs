/**
 * CLI: node scripts/ingest-gitbook.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in env (.env.local).
 */
import { createClient } from '@supabase/supabase-js'
import { ingestGitBookPythonCurriculum } from '../lib/ai/ingestion/gitbook-ingest.js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const report = await ingestGitBookPythonCurriculum(supabase, {
  indexUrl: process.env.GITBOOK_PYTHON_INDEX_URL,
  phase: process.env.GITBOOK_INGEST_PHASE || 'Python',
})

console.log(JSON.stringify(report, null, 2))
process.exit(report.topicErrors.length ? 1 : 0)
