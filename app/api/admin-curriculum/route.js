import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { findEquivalentActiveCatalogItems, isGlobalCatalogItem, itemIsCompatibleWithBatch, validateActivationPayload } from '@/lib/coursework-activation'
import { appendActivity } from '@/lib/activity-log'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { buildProgressPreview, normalizeProgressPayload, sortProgressItems } from '@/lib/coursework-progress'
import { courseworkIdentity } from '@/lib/coursework-identity'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

async function loadCurriculum(supabase, batch = '', includeExtras = false) {
  const itemSelect = 'id,item_type,title,original_title,phase,batch,due_at,active,sort_order,catalog_status,canonical_key,canonical_coursework_item_id,created_at,updated_at'
  const globalItemQuery = supabase.from('coursework_items').select(itemSelect).is('batch', null).eq('catalog_status', 'canonical').eq('active', true).not('sort_order', 'is', null).order('phase').order('sort_order', { ascending: true, nullsFirst: false }).order('title').limit(100)
  const activationQuery = (batch
    ? supabase.from('batch_coursework_assignments').select('id,batch,coursework_item_id,activated_at,activated_by_role,activated_by_name,due_at,active').eq('batch', batch)
    : supabase.from('batch_coursework_assignments').select('id,batch,coursework_item_id,activated_at,activated_by_role,activated_by_name,due_at,active'))
    .order('activated_at', { ascending: false }).limit(2000)
  const extraQuery = includeExtras
    ? supabase.from('coursework_catalog_extras').select('*').order('submission_count', { ascending: false }).order('original_alias').limit(500)
    : Promise.resolve({ data: [], error: null })
  const [{ data: globalItems, error: itemError }, { data: activations, error: activationError }, { data: extras, error: extrasError }] = await Promise.all([
    globalItemQuery,
    activationQuery,
    extraQuery,
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
  const canonicalItems = globalItems || []
  const canonicalSummary = ['Python', 'Data Analytics', 'SQL'].reduce((summary, phase) => {
    summary[phase] = {
      assignments: canonicalItems.filter(item => item.phase === phase && item.item_type === 'assignment').length,
      projects: canonicalItems.filter(item => item.phase === phase && item.item_type === 'project').length,
    }
    return summary
  }, {})
  const activeIds = new Set((activations || []).filter(row => row.active).map(row => String(row.coursework_item_id)))
  const activeKeys = new Set((enrichedActivations || []).filter(row => row.active).map(row => courseworkIdentity(row.item)).filter(Boolean))
  const phaseSummary = ['Python', 'Data Analytics', 'SQL'].reduce((summary, phase) => {
    const phaseItems = canonicalItems.filter(item => item.phase === phase)
    summary[phase] = {
      assignments: phaseItems.filter(item => item.item_type === 'assignment').length,
      projects: phaseItems.filter(item => item.item_type === 'project').length,
      active: phaseItems.filter(item => activeIds.has(String(item.id)) || activeKeys.has(courseworkIdentity(item))).length,
    }
    return summary
  }, {})
  return {
    items: [...itemById.values()],
    canonicalItems,
    activations: enrichedActivations,
    progress: progress || [],
    activeStudentCount: activeStudentCount || 0,
    extras: extras || [],
    extrasLoaded: includeExtras,
    canonicalSummary,
    phaseSummary,
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

function normalizeBulkMode(value) {
  const mode = String(value || '').trim().toLowerCase().replace(/_/g, '-')
  if (mode === 'covered-through' || mode === 'progress') return 'covered-through'
  if (mode === 'select-topics' || mode === 'select') return 'select-topics'
  return ''
}

function normalizeBulkIds(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(value => String(value || '').trim()).filter(Boolean))]
}

async function buildBulkPreview(supabase, body = {}) {
  const releaseMode = normalizeBulkMode(body.releaseMode || body.mode)
  const targetMode = String(body.targetMode || '').trim().toLowerCase()
  const phase = String(body.phase || '').trim()
  const itemType = String(body.itemType || body.item_type || '').trim().toLowerCase()
  const selectedIds = normalizeBulkIds(body.courseworkItemIds || body.coursework_item_ids)
  const coveredThroughCourseworkItemId = String(body.coveredThroughCourseworkItemId || body.covered_through_coursework_item_id || '').trim()
  if (!releaseMode) return { error: 'Choose Covered Through or Select Topics.' }
  if (!['single', 'selected', 'all'].includes(targetMode)) return { error: 'Choose one, selected, or all target batches.' }
  if (!['Python', 'Data Analytics', 'SQL'].includes(phase)) return { error: 'Choose a valid curriculum phase.' }
  if (!['assignment', 'project'].includes(itemType)) return { error: 'Choose assignment or project.' }

  const { data: batchRows, error: batchError } = await supabase.from('batches').select('name').order('name').limit(500)
  if (batchError) throw batchError
  const availableBatchNames = (batchRows || []).map(row => row.name).filter(Boolean)
  const requestedBatchNames = targetMode === 'all'
    ? availableBatchNames
    : targetMode === 'single'
      ? normalizeBulkIds(body.batch || body.batchName)
      : normalizeBulkIds(body.batchNames)
  const targetBatches = [...new Set(requestedBatchNames)]
  if (!targetBatches.length) return { error: 'Select at least one target batch.' }
  if (targetBatches.some(name => !availableBatchNames.includes(name))) return { error: 'Every target batch must exist.' }

  const itemSelect = 'id,item_type,title,phase,batch,active,sort_order,catalog_status,canonical_key,canonical_coursework_item_id,updated_at'
  const { data: canonicalItems, error: canonicalError } = await supabase
    .from('coursework_items')
    .select(itemSelect)
    .is('batch', null)
    .eq('catalog_status', 'canonical')
    .eq('active', true)
    .not('sort_order', 'is', null)
    .order('phase')
    .order('sort_order')
    .order('title')
  if (canonicalError) throw canonicalError
  const canonicalById = new Map((canonicalItems || []).map(item => [String(item.id), item]))
  let selectedItems = []
  if (releaseMode === 'covered-through') {
    const target = canonicalById.get(coveredThroughCourseworkItemId)
    if (!target || target.phase !== phase || target.item_type !== itemType) return { error: 'Covered-through item must be an active canonical item in the selected phase and type.' }
    selectedItems = (canonicalItems || []).filter(item => item.phase === phase && item.item_type === itemType && Number(item.sort_order) <= Number(target.sort_order))
  } else {
    if (!selectedIds.length || selectedIds.length > 200) return { error: 'Select between one and 200 topics.' }
    selectedItems = selectedIds.map(id => canonicalById.get(id)).filter(Boolean)
    if (selectedItems.length !== selectedIds.length || selectedItems.some(item => item.phase !== phase || item.item_type !== itemType)) return { error: 'Every selected topic must be canonical and match the selected phase and type.' }
    selectedItems.sort((left, right) => Number(left.sort_order) - Number(right.sort_order) || String(left.title).localeCompare(String(right.title)))
  }
  if (!selectedItems.length) return { error: 'No ordered canonical coursework matches this release.' }

  const [{ data: assignments, error: assignmentError }, { data: progress, error: progressError }, { data: students, error: studentError }] = await Promise.all([
    supabase.from('batch_coursework_assignments').select('id,batch,coursework_item_id,active,activated_at,updated_at').in('batch', targetBatches).eq('active', true),
    supabase.from('batch_curriculum_progress').select('*').in('batch', targetBatches).eq('phase', phase).eq('item_type', itemType),
    supabase.from('students').select('batch').in('batch', targetBatches).eq('status', 'active'),
  ])
  if (assignmentError) throw assignmentError
  if (progressError) throw progressError
  if (studentError) throw studentError
  const assignmentItemIds = [...new Set((assignments || []).map(row => row.coursework_item_id).filter(Boolean))]
  const { data: activeItems, error: activeItemError } = assignmentItemIds.length
    ? await supabase.from('coursework_items').select(itemSelect).in('id', assignmentItemIds)
    : { data: [], error: null }
  if (activeItemError) throw activeItemError
  const itemById = new Map((activeItems || []).map(item => [String(item.id), item]))
  const assignmentsByBatch = new Map()
  for (const row of assignments || []) {
    const list = assignmentsByBatch.get(row.batch) || []
    list.push({ ...row, item: itemById.get(String(row.coursework_item_id)) || null })
    assignmentsByBatch.set(row.batch, list)
  }
  const progressByBatch = new Map((progress || []).map(row => [row.batch, row]))
  const studentCounts = new Map()
  for (const student of students || []) studentCounts.set(student.batch, (studentCounts.get(student.batch) || 0) + 1)
  const equivalent = (target, active) => Boolean(active && (
    String(active.id) === String(target.id)
    || String(active.canonical_coursework_item_id || '') === String(target.id)
    || courseworkIdentity(active) === courseworkIdentity(target)
  ))
  const batchResults = targetBatches.map(batch => {
    const currentProgress = progressByBatch.get(batch) || null
    const activeForBatch = assignmentsByBatch.get(batch) || []
    const alreadyBeyond = releaseMode === 'covered-through'
      && currentProgress
      && Number(currentProgress.covered_through_sort_order) > Number(selectedItems[selectedItems.length - 1].sort_order)
    const matches = selectedItems.map(item => ({ item, existing: activeForBatch.find(row => equivalent(item, row.item)) || null }))
    const newItems = alreadyBeyond ? [] : matches.filter(match => !match.existing).map(match => match.item)
    const alreadyActive = alreadyBeyond ? 0 : matches.filter(match => match.existing).length
    const duplicateEquivalentSkipped = alreadyBeyond ? 0 : matches.filter(match => match.existing && String(match.existing.item?.id) !== String(match.item.id)).length
    const activeStudentCount = studentCounts.get(batch) || 0
    return {
      batch,
      status: alreadyBeyond ? 'already_beyond' : 'ready',
      currentSortOrder: currentProgress?.covered_through_sort_order ?? null,
      requestedSortOrder: releaseMode === 'covered-through' ? Number(selectedItems[selectedItems.length - 1].sort_order) : null,
      newActivations: newItems.length,
      alreadyActive,
      duplicateEquivalentSkipped,
      activeStudentCount,
      expectedPendingImpact: newItems.length * activeStudentCount,
    }
  })
  const fingerprintState = {
    releaseMode,
    targetMode,
    targetBatches,
    phase,
    itemType,
    selectedItems: selectedItems.map(item => ({ id: item.id, updated_at: item.updated_at, sort_order: item.sort_order })),
    assignments: (assignments || []).map(row => ({ batch: row.batch, coursework_item_id: row.coursework_item_id, active: row.active, updated_at: row.updated_at })).sort((left, right) => `${left.batch}|${left.coursework_item_id}`.localeCompare(`${right.batch}|${right.coursework_item_id}`)),
    progress: (progress || []).map(row => ({ batch: row.batch, covered_through_coursework_item_id: row.covered_through_coursework_item_id, covered_through_sort_order: row.covered_through_sort_order, updated_at: row.updated_at })).sort((left, right) => String(left.batch).localeCompare(String(right.batch))),
    studentCounts: Object.fromEntries([...studentCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
  const previewToken = createHash('sha256').update(JSON.stringify(fingerprintState)).digest('hex')
  const totals = batchResults.reduce((sum, row) => ({
    newActivations: sum.newActivations + row.newActivations,
    alreadyActive: sum.alreadyActive + row.alreadyActive,
    duplicateEquivalentSkipped: sum.duplicateEquivalentSkipped + row.duplicateEquivalentSkipped,
    activeStudentsAffected: sum.activeStudentsAffected + row.activeStudentCount,
    expectedPendingImpact: sum.expectedPendingImpact + row.expectedPendingImpact,
  }), { newActivations: 0, alreadyActive: 0, duplicateEquivalentSkipped: 0, activeStudentsAffected: 0, expectedPendingImpact: 0 })
  return {
    normalized: { releaseMode, targetMode, targetBatches, phase, itemType, selectedIds: selectedItems.map(item => item.id), coveredThroughCourseworkItemId: releaseMode === 'covered-through' ? selectedItems[selectedItems.length - 1].id : null },
    preview: {
      previewToken,
      releaseMode,
      targetMode,
      targetBatches,
      batchCount: targetBatches.length,
      selectedItems: selectedItems.map(item => ({ id: item.id, title: item.title, phase: item.phase, item_type: item.item_type, sort_order: item.sort_order })),
      selectedCourseworkCount: selectedItems.length,
      ...totals,
      batches: batchResults,
    },
  }
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
    const data = await loadCurriculum(
      getSupabaseAdmin(),
      String(request.nextUrl.searchParams.get('batch') || '').trim(),
      request.nextUrl.searchParams.get('view') === 'extras'
    )
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
    if (body.action === 'bulk-preview' || body.action === 'bulk-activate' || body.action === 'bulk-set-progress') {
      const previewContext = await buildBulkPreview(supabase, body)
      if (previewContext.error) return jsonNoStore({ error: previewContext.error }, { status: 400 })
      if (body.action === 'bulk-preview') return jsonNoStore({ success: true, preview: previewContext.preview })
      if (!body.previewToken) return jsonNoStore({ error: 'Preview this release before confirming it.', code: 'BULK_PREVIEW_REQUIRED' }, { status: 409 })
      if (body.previewToken !== previewContext.preview.previewToken) return jsonNoStore({ error: 'Coursework state changed. Preview again before confirming this release.', code: 'BULK_PREVIEW_STALE', preview: previewContext.preview }, { status: 409 })
      const expectedAction = previewContext.normalized.releaseMode === 'covered-through' ? 'bulk-set-progress' : 'bulk-activate'
      if (body.action !== expectedAction) return jsonNoStore({ error: 'Release action does not match the selected release mode.' }, { status: 400 })
      const { data: result, error: bulkError } = await supabase.rpc('cf_bulk_coursework_release', {
        p_mode: previewContext.normalized.releaseMode,
        p_batches: previewContext.normalized.targetBatches,
        p_coursework_item_ids: previewContext.normalized.selectedIds,
        p_phase: previewContext.normalized.phase,
        p_item_type: previewContext.normalized.itemType,
        p_covered_through_coursework_item_id: previewContext.normalized.coveredThroughCourseworkItemId,
        p_updated_by_role: 'admin',
        p_updated_by_name: admin.name,
      })
      if (bulkError) throw bulkError
      await appendActivity({
        eventType: 'health_coursework_bulk_release',
        description: `bulk ${previewContext.normalized.releaseMode} release for ${previewContext.normalized.targetBatches.length} batch(es)`,
        actorName: admin.name,
        actorRole: 'admin',
        action: previewContext.normalized.releaseMode === 'covered-through' ? 'bulk-set-progress' : 'bulk-activate',
        metadata: {
          target_batches: previewContext.normalized.targetBatches,
          phase: previewContext.normalized.phase,
          item_type: previewContext.normalized.itemType,
          release_mode: previewContext.normalized.releaseMode,
          coursework_item_ids: previewContext.normalized.selectedIds,
          new_activations: result?.newActivations || 0,
          already_active: result?.alreadyActive || 0,
          duplicate_equivalent_skipped: result?.duplicateEquivalentSkipped || 0,
          active_students_affected: result?.activeStudentsAffected || 0,
          expected_pending_impact: result?.expectedPendingImpact || 0,
        },
        supabase,
      })
      return jsonNoStore({ success: true, result, preview: previewContext.preview })
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
