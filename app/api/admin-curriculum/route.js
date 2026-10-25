import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { findEquivalentActiveCatalogItems, isGlobalCatalogItem, itemIsCompatibleWithBatch, validateActivationPayload } from '@/lib/coursework-activation'
import { appendActivity } from '@/lib/activity-log'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { buildProgressPreview, normalizeProgressPayload, sortProgressItems } from '@/lib/coursework-progress'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

async function loadCurriculum(supabase, batch = '') {
  const itemSelect = 'id,item_type,title,original_title,phase,batch,due_at,active,sort_order,catalog_status,canonical_key,canonical_coursework_item_id,created_at,updated_at'
  const globalItemQuery = supabase.from('coursework_items').select(itemSelect).is('batch', null).order('phase').order('sort_order', { ascending: true, nullsFirst: false }).order('title').limit(1000)
  const activationQuery = (batch
    ? supabase.from('batch_coursework_assignments').select('id,batch,coursework_item_id,activated_at,activated_by_role,activated_by_name,due_at,active').eq('batch', batch)
    : supabase.from('batch_coursework_assignments').select('id,batch,coursework_item_id,activated_at,activated_by_role,activated_by_name,due_at,active'))
    .order('activated_at', { ascending: false }).limit(2000)
  const [{ data: globalItems, error: itemError }, { data: activations, error: activationError }, { data: extras, error: extrasError }] = await Promise.all([
    globalItemQuery,
    activationQuery,
    supabase.from('coursework_catalog_extras').select('*').order('submission_count', { ascending: false }).order('original_alias').limit(500),
  ])
  if (itemError) throw itemError
  if (activationError) throw activationError
  if (extrasError) throw extrasError
  const activationItemIds = [...new Set((activations || []).map(row => row.coursework_item_id).filter(Boolean))]
  const legacyItemsQuery = activationItemIds.length
    ? supabase.from('coursework_items').select(itemSelect).in('id', activationItemIds)
    : Promise.resolve({ data: [], error: null })
  const { data: activationItems, error: activationItemError } = await legacyItemsQuery
  if (activationItemError) throw activationItemError
  const itemById = new Map([...(globalItems || []), ...(activationItems || [])].map(item => [item.id, item]))
  const enrichedActivations = (activations || []).map(activation => ({ ...activation, item: itemById.get(activation.coursework_item_id) || null }))
  const [{ data: progress, error: progressError }, { count: activeStudentCount, error: studentCountError }] = await Promise.all([
    batch ? supabase.from('batch_curriculum_progress').select('*').eq('batch', batch).order('phase').order('item_type') : Promise.resolve({ data: [], error: null }),
    batch ? supabase.from('students').select('id', { count: 'exact', head: true }).eq('batch', batch).eq('status', 'active') : Promise.resolve({ count: 0, error: null }),
  ])
  if (progressError) throw progressError
  if (studentCountError) throw studentCountError
  const canonicalItems = (globalItems || []).filter(item => item.catalog_status === 'canonical')
  const canonicalSummary = ['Python', 'Data Analytics', 'SQL'].reduce((summary, phase) => {
    summary[phase] = {
      assignments: canonicalItems.filter(item => item.phase === phase && item.item_type === 'assignment').length,
      projects: canonicalItems.filter(item => item.phase === phase && item.item_type === 'project').length,
    }
    return summary
  }, {})
  return {
    items: [...itemById.values()],
    canonicalItems,
    activations: enrichedActivations,
    assignments: enrichedActivations,
    progress: progress || [],
    activeStudentCount: activeStudentCount || 0,
    extras: extras || [],
    canonicalSummary,
  }
}

async function loadProgressContext(supabase, payload) {
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
  if (!target || target.catalog_status !== 'canonical' || target.batch !== null || target.active === false || target.phase !== payload.phase || target.item_type !== payload.itemType || !Number.isInteger(Number(target.sort_order))) {
    return { error: 'Select an active global item with an explicit sort order in the selected phase and type.' }
  }
  const preview = buildProgressPreview({ globalItems: sortProgressItems(globalItems || []), activations: activations || [], currentProgress, phase: payload.phase, itemType: payload.itemType, targetItemId: target.id, activeStudentCount: activeStudentCount || 0 })
  return { target, currentProgress, preview }
}

async function findActiveEquivalentItems(supabase, batch, items, excludeActivationId = '') {
  const { data: assignments, error: assignmentError } = await supabase
    .from('batch_coursework_assignments')
    .select('id,coursework_item_id')
    .eq('batch', batch)
    .eq('active', true)
  if (assignmentError) throw assignmentError
  const ids = (assignments || []).filter(row => row.id !== excludeActivationId).map(row => row.coursework_item_id)
  if (!ids.length) return []
  const { data: activeItems, error: itemError } = await supabase
    .from('coursework_items')
    .select('id,item_type,title,phase,batch,active,catalog_status,canonical_coursework_item_id')
    .in('id', ids)
  if (itemError) throw itemError
  return findEquivalentActiveCatalogItems(items, activeItems || [])
}

export async function GET(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const data = await loadCurriculum(getSupabaseAdmin(), String(request.nextUrl.searchParams.get('batch') || '').trim())
    return jsonNoStore({ success: true, ...data })
  } catch (error) {
    console.error('[admin-curriculum] load failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Curriculum activation is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not load curriculum.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const supabase = getSupabaseAdmin()
    if (body.action === 'map-extra') {
      const aliasId = String(body.aliasId || '').trim()
      const canonicalCourseworkItemId = String(body.canonicalCourseworkItemId || '').trim()
      if (!aliasId || !canonicalCourseworkItemId) return jsonNoStore({ error: 'Alias and canonical coursework are required.' }, { status: 400 })
      const { data, error } = await supabase.rpc('cf_map_coursework_alias', {
        p_alias_id: aliasId,
        p_canonical_coursework_item_id: canonicalCourseworkItemId,
        p_actor: admin.name,
      })
      if (error) throw error
      return jsonNoStore({ success: true, mapping: data })
    }
    if (body.action === 'ignore-extra') {
      const aliasId = String(body.aliasId || '').trim()
      if (!aliasId) return jsonNoStore({ error: 'Alias is required.' }, { status: 400 })
      const { error } = await supabase.from('coursework_aliases').update({ mapping_status: 'ignored', confidence: 'AMBIGUOUS', updated_at: new Date().toISOString() }).eq('id', aliasId)
      if (error) throw error
      return jsonNoStore({ success: true })
    }
    if (body.action === 'preview-progress' || body.action === 'set-progress') {
      const normalizedProgress = normalizeProgressPayload(body)
      if (normalizedProgress.error) return jsonNoStore({ error: normalizedProgress.error }, { status: 400 })
      const payload = normalizedProgress.value
      const context = await loadProgressContext(supabase, payload)
      if (context.error) return jsonNoStore({ error: context.error }, { status: 400 })
      if (body.action === 'preview-progress') return jsonNoStore({ success: true, preview: context.preview })
      if (context.preview.backward && !payload.confirmBackward) {
        return jsonNoStore({ error: 'Backward progress requires explicit confirmation. Existing activations will be retained.', code: 'BACKWARD_PROGRESS_REQUIRES_CONFIRMATION', preview: context.preview }, { status: 409 })
      }
      if (context.preview.backward && payload.confirmBackward) {
        await appendActivity({ eventType: 'health_coursework_progress_backward_reviewed', description: `reviewed backward progress request for ${payload.batch} / ${payload.phase} / ${payload.itemType}; existing activations retained`, actorName: admin.name, actorRole: 'admin', action: 'review', metadata: { batch: payload.batch, phase: payload.phase, item_type: payload.itemType, requested_item_id: payload.coveredThroughCourseworkItemId }, supabase })
        return jsonNoStore({ success: true, backwardMovement: true, existingActivationsRetained: true, noChange: true, preview: context.preview })
      }
      const { data: result, error: applyError } = await supabase.rpc('cf_apply_batch_curriculum_progress', {
        p_batch: payload.batch,
        p_phase: payload.phase,
        p_item_type: payload.itemType,
        p_covered_through_coursework_item_id: payload.coveredThroughCourseworkItemId,
        p_updated_by_role: 'admin',
        p_updated_by_name: admin.name,
      })
      if (applyError) {
        if (applyError.code === 'P0001') return jsonNoStore({ error: 'Backward progress requires explicit confirmation. Existing activations are retained.' }, { status: 409 })
        throw applyError
      }
      await appendActivity({ eventType: 'health_coursework_progress_updated', description: `released cumulative coursework through ${context.target.title} for ${payload.batch}`, actorName: admin.name, actorRole: 'admin', action: 'update', metadata: { batch: payload.batch, phase: payload.phase, item_type: payload.itemType, covered_through_item_id: payload.coveredThroughCourseworkItemId }, supabase })
      return jsonNoStore({ success: true, progress: result, preview: context.preview })
    }
    if (body.action === 'activate') {
      const normalized = validateActivationPayload(body)
      if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
      const { batch, courseworkItemIds, dueAt } = normalized.value
      const { data: batchRow, error: batchError } = await supabase.from('batches').select('name').eq('name', batch).maybeSingle()
      if (batchError) throw batchError
      if (!batchRow) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
      const { data: items, error: itemError } = await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,sort_order,catalog_status,canonical_key').in('id', courseworkItemIds)
      if (itemError) throw itemError
      if ((items || []).length !== courseworkItemIds.length || (items || []).some(item => !isGlobalCatalogItem(item))) return jsonNoStore({ error: 'Select active global catalog items. Activate reusable coursework separately for each batch.' }, { status: 400 })
      const duplicateItems = await findActiveEquivalentItems(supabase, batch, items || [])
      if (duplicateItems.length) return jsonNoStore({ error: 'Already active for this batch.', duplicateCourseworkItemIds: duplicateItems.map(item => item.id) }, { status: 409 })
      const now = new Date().toISOString()
      const rows = courseworkItemIds.map(courseworkItemId => ({ batch, coursework_item_id: courseworkItemId, activated_at: now, activated_by_role: 'admin', activated_by_name: admin.name, due_at: dueAt, active: true, updated_at: now }))
      const { data: activated, error } = await supabase.from('batch_coursework_assignments').upsert(rows, { onConflict: 'batch,coursework_item_id' }).select('*')
      if (error) throw error
      await appendActivity({ eventType: 'health_coursework_activated', description: `activated ${activated?.length || 0} coursework item(s) for ${batch}`, actorName: admin.name, actorRole: 'admin', action: 'activate', metadata: { batch, coursework_item_ids: courseworkItemIds }, supabase })
      return jsonNoStore({ success: true, activations: activated || [] })
    }

    return jsonNoStore({ error: 'The canonical curriculum is release-managed. Use the supplied 47-item master or review Extras.' }, { status: 409 })
  } catch (error) {
    console.error('[admin-curriculum] write failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Curriculum activation is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not update curriculum.' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const id = String(body.id || '').trim()
    if (!id || typeof body.active !== 'boolean') return jsonNoStore({ error: 'Activation id and active status are required.' }, { status: 400 })
    const supabase = getSupabaseAdmin()
    if (body.active === true) {
      const { data: activation, error: activationError } = await supabase.from('batch_coursework_assignments').select('id,batch,coursework_item_id').eq('id', id).maybeSingle()
      if (activationError) throw activationError
      const { data: item, error: itemError } = activation
        ? await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,catalog_status,canonical_coursework_item_id').eq('id', activation.coursework_item_id).maybeSingle()
        : { data: null, error: null }
      if (itemError) throw itemError
      if (!activation || !itemIsCompatibleWithBatch(item, activation.batch) || item.catalog_status === 'extra' || item.catalog_status === 'archived') return jsonNoStore({ error: 'This coursework cannot be activated without a canonical curriculum mapping or valid Python, Data Analytics, or SQL phase.' }, { status: 400 })
      const duplicateItems = await findActiveEquivalentItems(supabase, activation.batch, item ? [item] : [], id)
      if (duplicateItems.length) return jsonNoStore({ error: 'Already active for this batch.' }, { status: 409 })
    }
    const { data, error } = await supabase.from('batch_coursework_assignments').update({ active: body.active, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return jsonNoStore({ error: 'Activation not found.' }, { status: 404 })
    return jsonNoStore({ success: true, activation: data })
  } catch (error) {
    console.error('[admin-curriculum] activation update failed', error?.message)
    return jsonNoStore({ error: 'Could not update coursework activation.' }, { status: 500 })
  }
}
