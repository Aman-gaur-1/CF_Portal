import { debugLog } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'

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
  if (process.env.NODE_ENV === 'production' && process.env.DEBUG_LOGS !== 'true') return
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

    const confirmedIds = confirmedReviewedIds(request.nextUrl.searchParams)
    const { data, error } = await supabase.rpc('cf_teacher_submission_analytics', {
      p_batch_names: scope.batchNames,
      p_confirmed_reviewed_ids: Array.from(confirmedIds),
    })
    if (error) throw new Error(error.message)
    return jsonNoStoreWithPayloadLog({ success: true, ...(data || {}) }, {
      teacherName: scope.teacherName,
      batches: scope.batchNames.length,
      rows: 0,
      aggregate: true,
    })
  } catch (err) {
    console.error('[teacher-analytics] failed', err?.message)
    return jsonNoStore({ error: 'Could not load analytics' }, { status: 500 })
  }
}
