import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { ingestGitBookPythonCurriculum } from '@/lib/ai/ingestion'

/**
 * Server-only GitBook curriculum ingestion (no frontend dependency).
 * Production: set INGEST_SECRET and pass header x-ingest-secret.
 */
export async function POST(req) {
  try {
    const secret = process.env.INGEST_SECRET
    if (secret) {
      const provided =
        req.headers.get('x-ingest-secret') ||
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      if (provided !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'INGEST_SECRET is required in production' },
        { status: 503 }
      )
    }

    let body = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const supabase = getSupabaseAdmin()
    const report = await ingestGitBookPythonCurriculum(supabase, {
      indexUrl: body.indexUrl || process.env.GITBOOK_PYTHON_INDEX_URL,
      phase: body.phase,
      pruneOrphans: body.pruneOrphans !== false,
    })

    const status = report.topicErrors.length ? 207 : 200
    return NextResponse.json({ ok: true, report }, { status })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to run GitBook ingestion',
    defaultIndex: process.env.GITBOOK_PYTHON_INDEX_URL || 'see lib/ai/ingestion/constants.js',
  })
}
