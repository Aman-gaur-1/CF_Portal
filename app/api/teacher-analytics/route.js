import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { recoverStaleAiDrafts } from '@/lib/ai/claim-evaluation'
import {
  decorateSubmissionReviewState,
  isReviewedSubmission,
  summarizeReviewRows,
} from '@/lib/review-state'

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

function jsonNoStoreWithPayloadLog(body, meta = {}, init) {
  logPayloadSize('teacher-analytics', body, meta)
  return jsonNoStore(body, init)
}

function logPayloadSize(context, body, meta = {}) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
    console.info(`[${context}] payload`, {
      ...meta,
      bytes,
      kb: Math.round(bytes / 1024),
      overTarget: bytes > 200 * 1024,
    })
  } catch (err) {
    console.warn(`[${context}] payload measurement failed`, { error: err?.message })
  }
}

function confirmedReviewedIds(params) {
  return new Set(
    String(params.get('confirmedReviewedIds') || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => /^\d+$/.test(id))
  )
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function shortDateLabel(key) {
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })
}

export async function GET(request) {
  try {
    noStore()
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    await recoverStaleAiDrafts(supabase, { context: 'teacher-analytics' })
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) {
      return jsonNoStoreWithPayloadLog({
        success: true,
        totalSubmissions: 0,
        totalPending: 0,
        totalReviewed: 0,
        aiHealth: { ready: 0, failed: 0, processing: 0, pending: 0 },
        sevenDayTrend: [],
        batchDistribution: [],
      }, { teacherName: teacher.name, emptyScope: true })
    }

    const rowsResult = await supabase
      .from('submissions')
      .select('id,batch,submitted_at,feedback,feedback_at,ai_status,ai_feedback')
      .in('batch', scope.batchNames)
      .order('submitted_at', { ascending: false })
    if (rowsResult.error) throw new Error(rowsResult.error.message)
    const confirmedIds = confirmedReviewedIds(request.nextUrl.searchParams)
    const rows = (rowsResult.data || []).map(row => decorateSubmissionReviewState(row, confirmedIds))
    const staleConfirmed = rows.filter(row => confirmedIds.has(String(row.id)) && !isReviewedSubmission(row))
    if (staleConfirmed.length) {
      console.warn('[teacher-analytics] confirmed published rows arrived stale from Supabase', {
        teacherName: scope.teacherName,
        staleIds: staleConfirmed.map(row => row.id).slice(0, 20),
        staleCount: staleConfirmed.length,
      })
    }
    const total = rows.length
    const pending = rows.filter(row => !isReviewedSubmission(row, confirmedIds)).length
    const reviewed = rows.filter(row => isReviewedSubmission(row, confirmedIds)).length
    const unreviewedRows = rows.filter(row => !isReviewedSubmission(row, confirmedIds))

    const aiHealth = {
      ready: unreviewedRows.filter(row => row.ai_status === 'ready' || row.ai_feedback).length,
      failed: unreviewedRows.filter(row => row.ai_status === 'failed').length,
      processing: unreviewedRows.filter(row => row.ai_status === 'processing').length,
      pending: unreviewedRows.filter(row => row.ai_status === 'pending').length,
    }
    console.info('[teacher-analytics] review state summary', {
      teacherName: scope.teacherName,
      confirmedCount: confirmedIds.size,
      summary: summarizeReviewRows(rows, confirmedIds),
      aiHealth,
    })

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
      if (!isReviewedSubmission(row, confirmedIds)) current.pending += 1
      batchMap.set(batch, current)
    }
    const batchDistribution = Array.from(batchMap.values())
      .sort((a, b) => b.submissions - a.submissions)
      .slice(0, 8)

    return jsonNoStoreWithPayloadLog({
      success: true,
      totalSubmissions: total,
      totalPending: pending,
      totalReviewed: reviewed,
      aiHealth,
      sevenDayTrend,
      batchDistribution,
    }, { teacherName: scope.teacherName, rows: rows.length })
  } catch (err) {
    console.error('[teacher-analytics] failed', err?.message)
    return jsonNoStore({ error: 'Could not load analytics' }, { status: 500 })
  }
}
