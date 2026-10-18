import { NextResponse } from 'next/server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { itemIsCompatibleWithBatch, validateActivationPayload } from '@/lib/coursework-activation'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function GET(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    const { data: assignments, error: activationError } = scope.batchNames.length
      ? await supabase.from('batch_coursework_assignments').select('id,batch,coursework_item_id,activated_at,activated_by_role,activated_by_name,due_at,active').in('batch', scope.batchNames).order('activated_at', { ascending: false })
      : { data: [], error: null }
    if (activationError) throw activationError
    const ids = [...new Set((assignments || []).map(row => row.coursework_item_id))]
    const { data: items, error: itemError } = ids.length ? await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').in('id', ids) : { data: [], error: null }
    if (itemError) throw itemError
    return jsonNoStore({ success: true, batches: scope.batches, batchNames: scope.batchNames, assignments: assignments || [], items: items || [] })
  } catch (error) {
    console.error('[teacher-curriculum] load failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Curriculum activation is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not load assigned curriculum.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const normalized = validateActivationPayload(await request.json().catch(() => ({})))
    if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.includes(normalized.value.batch)) return jsonNoStore({ error: 'This batch is not assigned to you.' }, { status: 403 })
    const { data: items, error: itemError } = await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').in('id', normalized.value.courseworkItemIds)
    if (itemError) throw itemError
    if ((items || []).length !== normalized.value.courseworkItemIds.length || (items || []).some(item => !itemIsCompatibleWithBatch(item, normalized.value.batch))) return jsonNoStore({ error: 'Each item must be an active Assignment/Project compatible with the selected batch.' }, { status: 400 })
    const now = new Date().toISOString()
    const rows = normalized.value.courseworkItemIds.map(courseworkItemId => ({ batch: normalized.value.batch, coursework_item_id: courseworkItemId, activated_at: now, activated_by_role: 'teacher', activated_by_name: scope.teacherName || teacher.name, due_at: normalized.value.dueAt, active: true, updated_at: now }))
    const { data, error } = await supabase.from('batch_coursework_assignments').upsert(rows, { onConflict: 'batch,coursework_item_id' }).select('*')
    if (error) throw error
    return jsonNoStore({ success: true, activations: data || [] })
  } catch (error) {
    console.error('[teacher-curriculum] write failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Curriculum activation is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not activate coursework.' }, { status: 500 })
  }
}
