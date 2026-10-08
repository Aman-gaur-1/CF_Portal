import { debugLog } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
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
    debugLog(`[${context}] payload`, {
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

    const baseCount = () => supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .in('batch', scope.batchNames)
    const [
      totalResult,
      pendingResult,
      reviewedResult,
      readyResult,
      failedResult,
      processingResult,
      pendingAiResult,
      rowsResult,
    ] = await Promise.all([
      baseCount(),
      baseCount().is('feedback', null).is('feedback_at', null),
      baseCount().or('feedback.not.is.null,feedback_at.not.is.null'),
      baseCount().is('feedback', null).is('feedback_at', null).or('ai_status.eq.ready,ai_feedback.not.is.null'),
      baseCount().is('feedback', null).is('feedback_at', null).eq('ai_status', 'failed'),
      baseCount().is('feedback', null).is('feedback_at', null).eq('ai_status', 'processing'),
      baseCount().is('feedback', null).is('feedback_at', null).eq('ai_status', 'pending'),
      supabase
        .from('submissions')
        .select('id,batch,submitted_at,feedback,feedback_at,ai_status,ai_feedback')
        .in('batch', scope.batchNames)
        .order('submitted_at', { ascending: false })
        .limit(5000),
    ])
    for (const result of [totalResult, pendingResult, reviewedResult, readyResult, failedResult, processingResult, pendingAiResult, rowsResult]) {
      if (result.error) throw new Error(result.error.message)
    }

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
    const total = totalResult.count || 0
    const pending = pendingResult.count || 0
    const reviewed = reviewedResult.count || 0
    const aiHealth = {
      ready: readyResult.count || 0,
      failed: failedResult.count || 0,
      processing: processingResult.count || 0,
      pending: pendingAiResult.count || 0,
    }
    debugLog('[teacher-analytics] review state summary', {
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
