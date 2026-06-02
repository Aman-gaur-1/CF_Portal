import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import {
  loadGeneralCurriculumText,
  syncGeneralCurriculumFromText,
} from '@/lib/ai/sync-curriculum'

const legacyFilePath = path.join(process.cwd(), 'lib', 'rag-source.json')

/**
 * One-time import from lib/rag-source.json when Supabase has no chunks yet.
 * Keeps trainer UI working without manual migration steps.
 */
async function loadLegacyFileIfEmpty(supabase, { persist = false } = {}) {
  const existing = await loadGeneralCurriculumText(supabase)
  if (existing.trim()) return existing

  try {
    const raw = await fs.readFile(legacyFilePath, 'utf8')
    const parsed = JSON.parse(raw)
    const text = String(parsed.text || parsed.content || '').trim()
    if (text && persist) {
      await syncGeneralCurriculumFromText(supabase, text, { updatedBy: 'legacy-import' })
    }
    return text
  } catch {
    // no legacy file
  }

  return ''
}

export async function GET(request) {
  try {
    const supabase = getSupabaseAdmin()
    let text = await loadGeneralCurriculumText(supabase)
    if (!text.trim()) {
      text = await loadLegacyFileIfEmpty(supabase, {
        persist: Boolean(getAdminFromRequest(request)),
      })
    }
    return NextResponse.json({ text })
  } catch (error) {
    return NextResponse.json({ error: error.message, text: '' }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    if (!getAdminFromRequest(request)) {
      return NextResponse.json({ error: 'Admin authorization required' }, { status: 401 })
    }

    const body = await request.json()
    const text = String(body.text || '').slice(0, 500_000)
    const supabase = getSupabaseAdmin()

    await syncGeneralCurriculumFromText(supabase, text, { updatedBy: 'admin' })

    return NextResponse.json({ text: text.trim() })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
