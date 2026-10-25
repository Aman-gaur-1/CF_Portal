import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { normalizeHealthCourseworkType } from '@/lib/health-card-domain'
import { HEALTH_CARD_PHASES } from '@/lib/health-card-admin'
import { selectVisibleStudentCoursework } from '@/lib/student-coursework-visibility'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function GET(request) {
  try {
    const identity = getStudentFromRequest(request)
    if (!identity) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    const { data: student, error: studentError } = await supabase.from('students').select('id,name,batch,status').eq('id', identity.id).eq('batch', identity.batch).eq('status', 'active').maybeSingle()
    if (studentError) throw studentError
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    const { data: assignments, error: assignmentError } = await supabase
      .from('batch_coursework_assignments')
      .select('id,batch,coursework_item_id,activated_at,due_at,active')
      .eq('batch', student.batch)
      .eq('active', true)
      .order('activated_at', { ascending: true })
    if (assignmentError) throw assignmentError
    const itemIds = (assignments || []).map(row => row.coursework_item_id)
    const [{ data: items, error: itemError }, { data: submissions, error: submissionError }, { data: reconciliations, error: reconciliationError }] = await Promise.all([
      itemIds.length ? supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,sort_order').in('id', itemIds).eq('active', true).in('phase', HEALTH_CARD_PHASES) : { data: [], error: null },
      supabase.from('submissions').select('coursework_item_id,submission_type,submitted_at').eq('student_id', student.id).not('coursework_item_id', 'is', null),
      supabase.from('student_coursework_reconciliations').select('coursework_item_id,confidence,status,counts_for_progress').eq('student_id', student.id).eq('batch', student.batch).eq('status', 'confirmed').eq('counts_for_progress', true).in('confidence', ['confirmed', 'high_confidence']),
    ])
    if (itemError) throw itemError
    if (submissionError) throw submissionError
    if (reconciliationError) throw reconciliationError
    const itemById = new Map((items || []).map(item => [String(item.id), item]))
    const directCompletedIds = new Set((submissions || []).filter(row => {
      const item = itemById.get(String(row.coursework_item_id))
      return item && normalizeHealthCourseworkType(row.submission_type) === normalizeHealthCourseworkType(item.item_type)
    }).map(row => String(row.coursework_item_id)))
    const reconciledIds = new Set((reconciliations || []).map(row => String(row.coursework_item_id)))
    const currentScoredIds = new Set((submissions || []).filter(row => {
      const submittedAt = row.submitted_at ? new Date(row.submitted_at).getTime() : 0
      const item = itemById.get(String(row.coursework_item_id))
      return submittedAt >= Date.parse('2026-10-01T00:00:00+05:30') && item && normalizeHealthCourseworkType(row.submission_type) === normalizeHealthCourseworkType(item.item_type)
    }).map(row => String(row.coursework_item_id)))
    const coursework = selectVisibleStudentCoursework({
      assignments,
      items,
      batch: student.batch,
      getState: item => {
        const itemId = String(item.id)
        const completed = directCompletedIds.has(itemId) || reconciledIds.has(itemId)
        return {
          completed,
          progressCompleted: completed,
          scoredCurrent: currentScoredIds.has(itemId),
          progressSource: reconciledIds.has(itemId) && !directCompletedIds.has(itemId) ? 'historical_reconciliation' : directCompletedIds.has(itemId) ? 'submission' : null,
          status: completed ? 'completed' : 'pending',
        }
      },
    })
    const response = jsonNoStore({ success: true, coursework, phases: [...new Set(coursework.map(item => item.phase).filter(Boolean))] })
    response.headers.set('X-CF-Student-Coursework-Debug', JSON.stringify({ assignmentCount: assignments?.length || 0, itemCount: items?.length || 0, visibleCount: coursework.length }))
    return response
  } catch (error) {
    console.error('[student-coursework] failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Coursework activation is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not load active coursework.' }, { status: 500 })
  }
}
