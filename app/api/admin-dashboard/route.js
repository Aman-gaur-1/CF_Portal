import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 1000
const EMPTY_METRICS = {
  totalAssignments: 0,
  totalReviewed: 0,
  pendingReviews: 0,
  reviewCompletionRate: 0,
  aiReady: 0,
  aiFailed: 0,
  aiFinished: 0,
  successRate: null,
  todayRequests: 0,
  generatedToday: 0,
  failedToday: 0,
  pendingQueue: 0,
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

function isReviewedSubmission(row) {
  return row?.feedback != null || row?.feedback_at != null
}

function loadMetricsFromSubmissionRows(submissions) {
  const totalAssignments = submissions.length
  let totalReviewed = 0
  let aiReady = 0
  let aiFailed = 0
  let todayRequests = 0
  let generatedToday = 0
  let failedToday = 0
  let pendingQueue = 0
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  submissions.forEach((row) => {
    if (isReviewedSubmission(row)) totalReviewed += 1
    if (row.ai_status === 'ready') aiReady += 1
    if (row.ai_status === 'failed') aiFailed += 1
    if (!isReviewedSubmission(row) && !row.ai_feedback) pendingQueue += 1

    const aiTimestamp = row.ai_feedback_at || row.submitted_at
    const aiTime = aiTimestamp ? new Date(aiTimestamp).getTime() : 0
    if (aiTime >= startOfToday.getTime()) {
      if (row.ai_status) todayRequests += 1
      if (row.ai_status === 'ready') generatedToday += 1
      if (row.ai_status === 'failed') failedToday += 1
    }
  })

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
    todayRequests,
    generatedToday,
    failedToday,
    pendingQueue,
  }
}

function loadBatchStatsFromSubmissionRows(batches, submissions) {
  const stats = new Map()

  ;(batches || []).forEach((batch) => {
    const name = String(batch?.name || '')
    if (name) stats.set(name, { submissionCount: 0, reviewedCount: 0 })
  })

  submissions.forEach((row) => {
    const name = String(row?.batch || '')
    if (!name || !stats.has(name)) return
    const current = stats.get(name)
    current.submissionCount += 1
    if (isReviewedSubmission(row)) current.reviewedCount += 1
  })

  return Object.fromEntries(
    [...stats.entries()].map(([name, value]) => [
      name,
      {
        submissionCount: value.submissionCount,
        pendingCount: Math.max(value.submissionCount - value.reviewedCount, 0),
      },
    ])
  )
}

function loadStudentSubmissionCountsFromSubmissionRows(students, submissions) {
  const counts = new Map()

  ;(students || []).forEach((student) => {
    if (student?.id != null) counts.set(String(student.id), 0)
  })

  submissions.forEach((row) => {
    if (row?.student_id == null) return
    const id = String(row.student_id)
    if (counts.has(id)) counts.set(id, counts.get(id) + 1)
  })

  return Object.fromEntries(counts.entries())
}

export async function GET(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const [students, batches, trainers, submissions] = await Promise.all([
      fetchAllRows(supabase, 'students', 'id, name, batch, created_at', 'created_at'),
      fetchAllRows(supabase, 'batches', '*', 'created_at'),
      fetchAllRows(supabase, 'trainers', '*', 'created_at'),
      fetchAllRows(supabase, 'submissions', 'student_id,batch,submitted_at,feedback,feedback_at,ai_feedback,ai_feedback_at,ai_status'),
    ])

    const metrics = loadMetricsFromSubmissionRows(submissions)
    const batchStats = loadBatchStatsFromSubmissionRows(batches, submissions)
    const studentSubmissionCounts = loadStudentSubmissionCountsFromSubmissionRows(students, submissions)

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
