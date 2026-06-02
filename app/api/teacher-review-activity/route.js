import { NextResponse } from 'next/server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'
import { isReviewActivityFresh, serializeReviewActivity } from '@/lib/review-activity'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function POST(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const submissionId = String(body?.submissionId || '').trim()
    const action = body?.action === 'clear' ? 'clear' : 'touch'
    if (!submissionId) return jsonNoStore({ error: 'submissionId is required' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { scoped, submission } = await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)
    const trainerName = scoped.teacherName || teacher.name

    if (action === 'clear') {
      const { error } = await supabase
        .from('submissions')
        .update({ review_active_by: null, review_active_at: null })
        .eq('id', submissionId)
        .eq('review_active_by', trainerName)
      if (error) throw new Error(error.message)
      return jsonNoStore({ success: true, activity: null })
    }

    if (
      isReviewActivityFresh(submission) &&
      normalizeName(submission.review_active_by) !== normalizeName(trainerName)
    ) {
      return jsonNoStore({ success: true, activity: serializeReviewActivity(submission, trainerName) })
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('submissions')
      .update({ review_active_by: trainerName, review_active_at: now })
      .eq('id', submissionId)
      .select('id, review_active_by, review_active_at')
      .single()
    if (error) throw new Error(error.message)

    return jsonNoStore({ success: true, activity: serializeReviewActivity(data, trainerName) })
  } catch (err) {
    const status = err?.status || 500
    console.error('[teacher-review-activity] failed', err?.message)
    return jsonNoStore({ error: status === 403 ? err.message : 'Could not update review activity' }, { status })
  }
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase()
}
