import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'

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

async function countRows(supabase, query) {
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count || 0
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function shortDateLabel(key) {
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })
}

export async function GET(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    await recoverStaleAiDrafts(supabase, { context: 'teacher-analytics' })
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) {
      return jsonNoStore({
        success: true,
        totalSubmissions: 0,
        totalPending: 0,
        totalReviewed: 0,
        aiHealth: { ready: 0, failed: 0, processing: 0, pending: 0 },
        sevenDayTrend: [],
        batchDistribution: [],
      })
    }

    const [total, pending, reviewed, rowsResult] = await Promise.all([
      countRows(supabase, supabase.from('submissions').select('id', { count: 'exact', head: true }).in('batch', scope.batchNames)),
      countRows(supabase, supabase.from('submissions').select('id', { count: 'exact', head: true }).in('batch', scope.batchNames).is('feedback', null)),
      countRows(supabase, supabase.from('submissions').select('id', { count: 'exact', head: true }).in('batch', scope.batchNames).not('feedback', 'is', null)),
      supabase
        .from('submissions')
        .select('id,batch,submitted_at,feedback,ai_status')
        .in('batch', scope.batchNames)
        .order('submitted_at', { ascending: false }),
    ])

    if (rowsResult.error) throw new Error(rowsResult.error.message)
    const rows = rowsResult.data || []

    const aiHealth = {
      ready: rows.filter(row => row.ai_status === 'ready').length,
      failed: rows.filter(row => row.ai_status === 'failed').length,
      processing: rows.filter(row => row.ai_status === 'processing').length,
      pending: rows.filter(row => row.ai_status === 'pending').length,
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const trendKeys = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(today)
      day.setDate(today.getDate() - (6 - index))
      return dateKey(day)
    })
    const trendMap = Object.fromEntries(trendKeys.map(key => [key, 0]))
    for (const row of rows) {
      if (!row.submitted_at) continue
      const key = dateKey(new Date(row.submitted_at))
      if (key in trendMap) trendMap[key] += 1
    }
    const sevenDayTrend = trendKeys.map(key => ({
      date: key,
      label: shortDateLabel(key),
      submissions: trendMap[key],
    }))

    const batchMap = new Map()
    for (const row of rows) {
      const batch = row.batch || 'Unassigned'
      const current = batchMap.get(batch) || { batch, submissions: 0, pending: 0 }
      current.submissions += 1
      if (!row.feedback) current.pending += 1
      batchMap.set(batch, current)
    }
    const batchDistribution = Array.from(batchMap.values())
      .sort((a, b) => b.submissions - a.submissions)
      .slice(0, 8)

    return jsonNoStore({
      success: true,
      totalSubmissions: total,
      totalPending: pending,
      totalReviewed: reviewed,
      aiHealth,
      sevenDayTrend,
      batchDistribution,
    })
  } catch (err) {
    console.error('[teacher-analytics] failed', err?.message)
    return jsonNoStore({ error: 'Could not load analytics' }, { status: 500 })
  }
}
