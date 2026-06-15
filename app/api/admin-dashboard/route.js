import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 1000
const COUNT_CONCURRENCY = 8
const EMPTY_METRICS = {
  totalAssignments: 0,
  totalReviewed: 0,
  pendingReviews: 0,
  reviewCompletionRate: 0,
  aiReady: 0,
  aiFailed: 0,
  aiFinished: 0,
  successRate: null,
}

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function reviewedFilter(query) {
  return query.or('feedback.not.is.null,feedback_at.not.is.null')
}

async function fetchAllRows(supabase, table, select, orderColumn) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1)
    if (orderColumn) query = query.order(orderColumn, { ascending: false })
    const { data, error } = await query
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

async function countRows(query) {
  const { count, error } = await query
  if (error) throw error
  return count || 0
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function loadMetrics(supabase) {
  const [totalAssignments, totalReviewed, aiReady, aiFailed] = await Promise.all([
    countRows(supabase.from('submissions').select('id', { count: 'exact', head: true })),
    countRows(reviewedFilter(supabase.from('submissions').select('id', { count: 'exact', head: true }))),
    countRows(supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('ai_status', 'ready')),
    countRows(supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('ai_status', 'failed')),
  ])

  const pendingReviews = Math.max(totalAssignments - totalReviewed, 0)
  const aiFinished = aiReady + aiFailed
  return {
    totalAssignments,
    totalReviewed,
    pendingReviews,
    reviewCompletionRate: totalAssignments ? Math.round((totalReviewed / totalAssignments) * 100) : 0,
    aiReady,
    aiFailed,
    aiFinished,
    successRate: aiFinished ? Math.round((aiReady / aiFinished) * 100) : null,
  }
}

async function loadBatchStats(supabase, batches) {
  const entries = await mapLimit(batches || [], COUNT_CONCURRENCY, async (batch) => {
    const name = String(batch?.name || '')
    if (!name) return null
    const [submissionCount, reviewedCount] = await Promise.all([
      countRows(supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('batch', name)),
      countRows(reviewedFilter(supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('batch', name))),
    ])
    return [name, { submissionCount, pendingCount: Math.max(submissionCount - reviewedCount, 0) }]
  })
  return Object.fromEntries(entries.filter(Boolean))
}

async function loadStudentSubmissionCounts(supabase, students) {
  const entries = await mapLimit(students || [], COUNT_CONCURRENCY, async (student) => {
    const id = student?.id
    if (id == null) return null
    const count = await countRows(
      supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('student_id', id)
    )
    return [String(id), count]
  })
  return Object.fromEntries(entries.filter(Boolean))
}

export async function GET(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const [students, batches, trainers, metrics] = await Promise.all([
      fetchAllRows(supabase, 'students', 'id, name, batch, created_at', 'created_at'),
      fetchAllRows(supabase, 'batches', '*', 'created_at'),
      fetchAllRows(supabase, 'trainers', '*', 'created_at'),
      loadMetrics(supabase),
    ])

    const [batchStats, studentSubmissionCounts] = await Promise.all([
      loadBatchStats(supabase, batches),
      loadStudentSubmissionCounts(supabase, students),
    ])

    return jsonNoStore({
      success: true,
      students,
      batches,
      trainers,
      metrics: { ...EMPTY_METRICS, ...metrics },
      batchStats,
      studentSubmissionCounts,
    })
  } catch (err) {
    console.error('[admin-dashboard] failed', err?.message)
    return jsonNoStore({ error: 'Could not load admin dashboard analytics' }, { status: 500 })
  }
}
