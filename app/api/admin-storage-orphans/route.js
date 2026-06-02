import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { ASSIGNMENTS_BUCKET } from '@/lib/assignment-storage'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function GET(request) {
  if (!getAdminFromRequest(request)) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
  try {
    return jsonNoStore({ success: true, dryRun: true, ...(await loadOrphanReport()) })
  } catch (err) {
    console.error('[admin-storage-orphans] report failed', err?.message)
    return jsonNoStore({ error: 'Could not inspect assignment storage.' }, { status: 500 })
  }
}

export async function POST(request) {
  if (!getAdminFromRequest(request)) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body?.dryRun !== false
    const report = await loadOrphanReport()
    if (dryRun) return jsonNoStore({ success: true, dryRun: true, ...report })

    if (body?.confirmCleanup !== true) {
      return jsonNoStore({ error: 'confirmCleanup=true is required for orphan deletion.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const removed = []
    for (const names of chunks(report.orphans.map(orphan => orphan.name), 100)) {
      const { data, error } = await supabase.storage.from(ASSIGNMENTS_BUCKET).remove(names)
      if (error) throw new Error(error.message)
      removed.push(...(data || []).map(row => row.name))
    }

    return jsonNoStore({ success: true, dryRun: false, orphanCount: report.orphanCount, removedCount: removed.length })
  } catch (err) {
    console.error('[admin-storage-orphans] cleanup failed', err?.message)
    return jsonNoStore({ error: 'Could not clean assignment storage.' }, { status: 500 })
  }
}

async function loadOrphanReport() {
  const supabase = getSupabaseAdmin()
  const [objects, submissions] = await Promise.all([
    listAssignmentObjects(supabase),
    listSubmissionFileNames(supabase),
  ])
  const linkedNames = new Set(submissions)
  const orphans = objects
    .filter(object => !linkedNames.has(object.name))
    .map(object => ({
      name: object.name,
      createdAt: object.created_at || null,
      size: Number(object.metadata?.size || 0),
    }))

  return {
    objectCount: objects.length,
    linkedFileCount: linkedNames.size,
    orphanCount: orphans.length,
    orphanBytes: orphans.reduce((total, orphan) => total + orphan.size, 0),
    orphans,
  }
}

async function listAssignmentObjects(supabase) {
  const objects = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(ASSIGNMENTS_BUCKET).list('', {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(error.message)
    objects.push(...(data || []))
    if (!data || data.length < 1000) return objects
  }
}

async function listSubmissionFileNames(supabase) {
  const names = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('submissions')
      .select('file_name')
      .not('file_name', 'is', null)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    names.push(...(data || []).map(row => row.file_name).filter(Boolean))
    if (!data || data.length < 1000) return names
  }
}

function chunks(items, size) {
  const result = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
