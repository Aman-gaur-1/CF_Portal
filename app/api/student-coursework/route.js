import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { normalizeHealthCourseworkType } from '@/lib/health-card-domain'
import { HEALTH_CARD_PHASES, isSupportedHealthCardPhase } from '@/lib/health-card-admin'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function GET(request) {
  try {
    const identity = getStudentFromRequest(request)
    if (!identity) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    const { data: student, error: studentError } = await supabase.from('students').select('id,name,batch').eq('id', identity.id).eq('batch', identity.batch).maybeSingle()
    if (studentError) throw studentError
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    const { data: assignments, error: assignmentError } = await supabase
      .from('batch_coursework_assignments')
      .select('id,batch,coursework_item_id,activated_at,active')
      .eq('batch', student.batch)
      .eq('active', true)
      .order('activated_at', { ascending: true })
    if (assignmentError) throw assignmentError
    const itemIds = (assignments || []).map(row => row.coursework_item_id)
    const [{ data: items, error: itemError }, { data: submissions, error: submissionError }] = await Promise.all([
      itemIds.length ? supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').in('id', itemIds).eq('active', true).in('phase', HEALTH_CARD_PHASES) : { data: [], error: null },
      supabase.from('submissions').select('coursework_item_id,submission_type,submitted_at').eq('student_id', student.id).not('coursework_item_id', 'is', null),
    ])
    if (itemError) throw itemError
    if (submissionError) throw submissionError
    const itemById = new Map((items || []).map(item => [String(item.id), item]))
    const completedIds = new Set((submissions || []).filter(row => {
      const item = itemById.get(String(row.coursework_item_id))
      return item && normalizeHealthCourseworkType(row.submission_type) === normalizeHealthCourseworkType(item.item_type)
    }).map(row => String(row.coursework_item_id)))
    const coursework = (assignments || []).map(assignment => {
      const item = itemById.get(String(assignment.coursework_item_id))
      if (!item || !isSupportedHealthCardPhase(item.phase)) return null
      return {
        ...item,
        activationId: assignment.id,
        activatedAt: assignment.activated_at,
        dueAt: assignment.due_at || item.due_at || null,
        completed: completedIds.has(String(item.id)),
        status: completedIds.has(String(item.id)) ? 'completed' : 'pending',
      }
    }).filter(Boolean)
    return jsonNoStore({ success: true, coursework, phases: [...new Set(coursework.map(item => item.phase).filter(Boolean))] })
  } catch (error) {
    console.error('[student-coursework] failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Coursework activation is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not load active coursework.' }, { status: 500 })
  }
}
