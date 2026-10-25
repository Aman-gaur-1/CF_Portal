import { NextResponse } from 'next/server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { findEquivalentActiveCatalogItems, isGlobalCatalogItem, itemIsCompatibleWithBatch, validateActivationPayload } from '@/lib/coursework-activation'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { buildProgressPreview, normalizeProgressPayload, sortProgressItems } from '@/lib/coursework-progress'

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
    const [{ data: globalItems, error: globalItemError }, { data: assignedItems, error: assignedItemError }, { data: progress, error: progressError }] = await Promise.all([
      supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,sort_order,catalog_status,canonical_key').is('batch', null).eq('catalog_status', 'canonical').order('phase').order('sort_order', { ascending: true, nullsFirst: false }).order('title').limit(1000),
      ids.length ? supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,sort_order,catalog_status,canonical_key').in('id', ids) : Promise.resolve({ data: [], error: null }),
      scope.batchNames.length ? supabase.from('batch_curriculum_progress').select('*').in('batch', scope.batchNames).order('phase').order('item_type') : Promise.resolve({ data: [], error: null }),
    ])
    if (globalItemError) throw globalItemError
    if (assignedItemError) throw assignedItemError
    if (progressError) throw progressError
    const itemById = new Map([...(globalItems || []), ...(assignedItems || [])].map(item => [item.id, item]))
    const enrichedAssignments = (assignments || []).map(assignment => ({ ...assignment, item: itemById.get(assignment.coursework_item_id) || null }))
    const activeStudentCounts = {}
    await Promise.all(scope.batchNames.map(async name => {
      const { count, error } = await supabase.from('students').select('id', { count: 'exact', head: true }).eq('batch', name).eq('status', 'active')
      if (error) throw error
      activeStudentCounts[name] = count || 0
    }))
    return jsonNoStore({ success: true, batches: scope.batches, batchNames: scope.batchNames, assignments: enrichedAssignments, items: [...itemById.values()], progress: progress || [], activeStudentCounts })
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
    const body = await request.json().catch(() => ({}))
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (body.action === 'preview-progress' || body.action === 'set-progress') {
      const normalizedProgress = normalizeProgressPayload(body)
      if (normalizedProgress.error) return jsonNoStore({ error: normalizedProgress.error }, { status: 400 })
      const payload = normalizedProgress.value
      if (!scope.batchNames.includes(payload.batch)) return jsonNoStore({ error: 'This batch is not assigned to you.' }, { status: 403 })
      const [{ data: target, error: targetError }, { data: globalItems, error: globalError }, { data: activations, error: activationsError }, { data: currentProgress, error: progressError }, { count: activeStudentCount, error: studentError }] = await Promise.all([
        supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,sort_order,catalog_status,canonical_key').eq('id', payload.coveredThroughCourseworkItemId).maybeSingle(),
        supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,sort_order,catalog_status,canonical_key').is('batch', null).eq('phase', payload.phase).eq('item_type', payload.itemType).eq('active', true).eq('catalog_status', 'canonical').not('sort_order', 'is', null).order('sort_order').order('title'),
        supabase.from('batch_coursework_assignments').select('id,coursework_item_id,active').eq('batch', payload.batch),
        supabase.from('batch_curriculum_progress').select('*').eq('batch', payload.batch).eq('phase', payload.phase).eq('item_type', payload.itemType).maybeSingle(),
        supabase.from('students').select('id', { count: 'exact', head: true }).eq('batch', payload.batch).eq('status', 'active'),
      ])
      if (targetError) throw targetError
      if (globalError) throw globalError
      if (activationsError) throw activationsError
      if (progressError) throw progressError
      if (studentError) throw studentError
      if (!target || target.catalog_status !== 'canonical' || target.batch !== null || target.active === false || target.phase !== payload.phase || target.item_type !== payload.itemType || !Number.isInteger(Number(target.sort_order))) return jsonNoStore({ error: 'Select an active canonical item with an explicit sort order in the selected phase and type.' }, { status: 400 })
      const preview = buildProgressPreview({ globalItems: sortProgressItems(globalItems || []), activations: activations || [], currentProgress, phase: payload.phase, itemType: payload.itemType, targetItemId: target.id, activeStudentCount: activeStudentCount || 0 })
      if (body.action === 'preview-progress') return jsonNoStore({ success: true, preview })
      if (preview.backward && !payload.confirmBackward) return jsonNoStore({ error: 'Backward progress requires explicit confirmation. Existing activations will be retained.', code: 'BACKWARD_PROGRESS_REQUIRES_CONFIRMATION', preview }, { status: 409 })
      if (preview.backward && payload.confirmBackward) return jsonNoStore({ success: true, backwardMovement: true, existingActivationsRetained: true, noChange: true, preview })
      const { data: result, error: applyError } = await supabase.rpc('cf_apply_batch_curriculum_progress', {
        p_batch: payload.batch,
        p_phase: payload.phase,
        p_item_type: payload.itemType,
        p_covered_through_coursework_item_id: payload.coveredThroughCourseworkItemId,
        p_updated_by_role: 'teacher',
        p_updated_by_name: scope.teacherName || teacher.name,
      })
      if (applyError) throw applyError
      return jsonNoStore({ success: true, progress: result, preview })
    }
    const normalized = validateActivationPayload(body)
    if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
    if (!scope.batchNames.includes(normalized.value.batch)) return jsonNoStore({ error: 'This batch is not assigned to you.' }, { status: 403 })
    const { data: items, error: itemError } = await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,sort_order,catalog_status,canonical_key').in('id', normalized.value.courseworkItemIds)
    if (itemError) throw itemError
    if ((items || []).length !== normalized.value.courseworkItemIds.length || (items || []).some(item => !isGlobalCatalogItem(item))) return jsonNoStore({ error: 'Select active global catalog items. Activate reusable coursework separately for each batch.' }, { status: 400 })
    const { data: activeAssignments, error: activeAssignmentError } = await supabase.from('batch_coursework_assignments').select('coursework_item_id').eq('batch', normalized.value.batch).eq('active', true)
    if (activeAssignmentError) throw activeAssignmentError
    const activeIds = [...new Set((activeAssignments || []).map(row => row.coursework_item_id))]
    const { data: activeItems, error: activeItemError } = activeIds.length
      ? await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,catalog_status,canonical_coursework_item_id').in('id', activeIds)
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
      const { data: item, error: itemError } = await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,catalog_status,canonical_coursework_item_id').eq('id', assignment.coursework_item_id).maybeSingle()
      if (itemError) throw itemError
      if (!itemIsCompatibleWithBatch(item, assignment.batch) || item.catalog_status === 'extra' || item.catalog_status === 'archived') return jsonNoStore({ error: 'This coursework cannot be activated without a canonical curriculum mapping or valid Python, Data Analytics, or SQL phase.' }, { status: 400 })
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
