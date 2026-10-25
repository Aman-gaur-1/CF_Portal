import { NextResponse } from 'next/server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { findEquivalentActiveCatalogItems, isGlobalCatalogItem, itemIsCompatibleWithBatch, validateActivationPayload } from '@/lib/coursework-activation'
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
    const [{ data: globalItems, error: globalItemError }, { data: assignedItems, error: assignedItemError }] = await Promise.all([
      supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').is('batch', null).order('phase').order('title').limit(1000),
      ids.length ? supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').in('id', ids) : Promise.resolve({ data: [], error: null }),
    ])
    if (globalItemError) throw globalItemError
    if (assignedItemError) throw assignedItemError
    const itemById = new Map([...(globalItems || []), ...(assignedItems || [])].map(item => [item.id, item]))
    const enrichedAssignments = (assignments || []).map(assignment => ({ ...assignment, item: itemById.get(assignment.coursework_item_id) || null }))
    return jsonNoStore({ success: true, batches: scope.batches, batchNames: scope.batchNames, assignments: enrichedAssignments, items: [...itemById.values()] })
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
    if ((items || []).length !== normalized.value.courseworkItemIds.length || (items || []).some(item => !isGlobalCatalogItem(item))) return jsonNoStore({ error: 'Select active global catalog items. Activate reusable coursework separately for each batch.' }, { status: 400 })
    const { data: activeAssignments, error: activeAssignmentError } = await supabase.from('batch_coursework_assignments').select('coursework_item_id').eq('batch', normalized.value.batch).eq('active', true)
    if (activeAssignmentError) throw activeAssignmentError
    const activeIds = [...new Set((activeAssignments || []).map(row => row.coursework_item_id))]
    const { data: activeItems, error: activeItemError } = activeIds.length
      ? await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').in('id', activeIds)
      : { data: [], error: null }
    if (activeItemError) throw activeItemError
    if (findEquivalentActiveCatalogItems(items || [], activeItems || []).length) return jsonNoStore({ error: 'Already active for this batch.' }, { status: 409 })
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

export async function PATCH(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const id = String(body?.id || '').trim()
    if (!id || typeof body?.active !== 'boolean') return jsonNoStore({ error: 'Activation id and active state are required.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    const { data: assignment, error: lookupError } = await supabase
      .from('batch_coursework_assignments')
      .select('id,batch,coursework_item_id')
      .eq('id', id)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!assignment || !scope.batchNames.includes(assignment.batch)) return jsonNoStore({ error: 'This activation is outside your assigned batches.' }, { status: 403 })

    if (body.active === true) {
      const { data: item, error: itemError } = await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').eq('id', assignment.coursework_item_id).maybeSingle()
      if (itemError) throw itemError
      if (!itemIsCompatibleWithBatch(item, assignment.batch)) return jsonNoStore({ error: 'This coursework cannot be activated without a valid Python, Data Analytics, or SQL phase.' }, { status: 400 })
      const { data: activeAssignments, error: activeAssignmentError } = await supabase.from('batch_coursework_assignments').select('id,coursework_item_id').eq('batch', assignment.batch).eq('active', true).neq('id', id)
      if (activeAssignmentError) throw activeAssignmentError
      const activeIds = [...new Set((activeAssignments || []).map(row => row.coursework_item_id))]
      const { data: activeItems, error: activeItemError } = activeIds.length
        ? await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').in('id', activeIds)
        : { data: [], error: null }
      if (activeItemError) throw activeItemError
      if (findEquivalentActiveCatalogItems(item ? [item] : [], activeItems || []).length) return jsonNoStore({ error: 'Already active for this batch.' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('batch_coursework_assignments')
      .update({ active: body.active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return jsonNoStore({ success: true, activation: data })
  } catch (error) {
    console.error('[teacher-curriculum] update failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Curriculum activation is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not update coursework activation.' }, { status: 500 })
  }
}
