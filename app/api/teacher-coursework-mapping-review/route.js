import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { normalizeHealthCourseworkType } from '@/lib/health-card-domain'
import { isActiveCanonicalCoursework } from '@/lib/coursework-mapping'
import { isMissingHealthCardSchema, isUniqueViolation } from '@/lib/student-health-card'
import { appendActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

function validSubmissionId(value) {
  const normalized = String(value || '').trim()
  return /^\d+$/.test(normalized) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
}

async function writeEvent(supabase, requestId, fromStatus, toStatus, actorName, reason) {
  const { error } = await supabase.from('coursework_mapping_request_events').insert({ request_id: requestId, from_status: fromStatus || null, to_status: toStatus, actor_role: 'teacher', actor_name: actorName, reason: reason || null })
  if (error) throw error
}

async function ensureReconciliation(supabase, requestRow, item, teacherName) {
  const { data: sourceExisting, error: sourceLookupError } = await supabase.from('student_coursework_reconciliations').select('id,source_submission_id,coursework_item_id').eq('student_id', requestRow.student_id).eq('source_submission_id', String(requestRow.submission_id)).eq('status', 'confirmed').limit(1).maybeSingle()
  if (sourceLookupError) throw sourceLookupError
  if (sourceExisting && String(sourceExisting.coursework_item_id) !== String(item.id)) {
    const error = new Error('This submission is already mapped to another canonical coursework item. Use the Admin correction flow for a change.')
    error.status = 409
    throw error
  }
  if (sourceExisting) return { existing: sourceExisting, duplicateTarget: false }
  const { data: existing, error: lookupError } = await supabase.from('student_coursework_reconciliations').select('id,source_submission_id,coursework_item_id').eq('student_id', requestRow.student_id).eq('coursework_item_id', item.id).eq('status', 'confirmed').limit(1).maybeSingle()
  if (lookupError) throw lookupError
  if (existing) return { existing, duplicateTarget: String(existing.source_submission_id || '') !== String(requestRow.submission_id) }
  const phase = String(item.phase || requestRow.source_phase || '').trim()
  if (!['Python', 'Data Analytics', 'SQL'].includes(phase)) {
    const error = new Error('The selected coursework item is missing a valid curriculum phase.')
    error.status = 400
    throw error
  }
  const { data, error } = await supabase.from('student_coursework_reconciliations').insert({
    student_id: requestRow.student_id,
    batch: requestRow.batch,
    coursework_item_id: item.id,
    source_submission_id: String(requestRow.submission_id),
    source_topic: requestRow.source_topic,
    phase,
    item_type: normalizeHealthCourseworkType(item.item_type),
    confidence: 'confirmed',
    status: 'confirmed',
    counts_for_progress: true,
    counts_for_points: true,
    confirmed_by: teacherName,
    confirmed_at: new Date().toISOString(),
  }).select('id,source_submission_id,coursework_item_id').single()
  if (!error) return { existing: data, duplicateTarget: false }
  if (isUniqueViolation(error)) {
    const retry = await supabase.from('student_coursework_reconciliations').select('id,source_submission_id,coursework_item_id').eq('student_id', requestRow.student_id).eq('coursework_item_id', item.id).eq('status', 'confirmed').limit(1).maybeSingle()
    if (retry.error) throw retry.error
    return { existing: retry.data, duplicateTarget: String(retry.data?.source_submission_id || '') !== String(requestRow.submission_id) }
  }
  throw error
}

export async function GET(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.length) return jsonNoStore({ success: true, requests: [], canonicalItems: [] })
    const [{ data: requests, error: requestError }, { data: items, error: itemError }] = await Promise.all([
      supabase.from('coursework_mapping_requests').select('*').in('batch', scope.batchNames).eq('status', 'pending_review').order('created_at', { ascending: true }).limit(200),
      supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,deactivated_at,catalog_status').order('phase').order('item_type').order('sort_order').order('title'),
    ])
    if (requestError) throw requestError
    if (itemError) throw itemError
    const canonicalItems = (items || []).filter(isActiveCanonicalCoursework)
    const ids = [...new Set((requests || []).map(row => String(row.submission_id)).filter(validSubmissionId))]
    let submissions = []
    if (ids.length) {
      const { data, error } = await supabase.from('submissions').select('id,student_id,student_name,batch,topic,submission_type,phase,submitted_at').in('id', ids)
      if (error) throw error
      submissions = data || []
    }
    const submissionsById = new Map(submissions.map(row => [String(row.id), row]))
    return jsonNoStore({ success: true, teacherName: scope.teacherName, requests: (requests || []).map(row => ({ ...row, submission: submissionsById.get(String(row.submission_id)) || null })), canonicalItems })
  } catch (error) {
    console.error('[teacher-coursework-mapping-review] GET failed', error?.message)
    const missing = isMissingHealthCardSchema(error)
    return jsonNoStore({ error: missing ? 'Coursework mapping review is not deployed yet.' : 'Could not load mapping review.' }, { status: missing ? 503 : 500 })
  }
}

export async function PATCH(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const requestId = String(body?.requestId || '').trim()
    const decision = String(body?.decision || '').trim().toLowerCase()
    const targetId = String(body?.targetCanonicalCourseworkItemId || '').trim()
    const reason = String(body?.reason || '').trim()
    if (!/^\d+$/.test(requestId) || !['approve', 'reject'].includes(decision)) return jsonNoStore({ error: 'A valid requestId and approve/reject decision are required.' }, { status: 400 })
    if (decision === 'approve' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) return jsonNoStore({ error: 'Select an active canonical coursework item before approving.' }, { status: 400 })
    if (reason.length > 500) return jsonNoStore({ error: 'Reason must be 500 characters or fewer.' }, { status: 400 })
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    const { data: requestRow, error: requestError } = await supabase.from('coursework_mapping_requests').select('*').eq('id', requestId).maybeSingle()
    if (requestError) throw requestError
    if (!requestRow) return jsonNoStore({ error: 'Mapping request not found.' }, { status: 404 })
    if (!scope.batchNames.includes(requestRow.batch)) return jsonNoStore({ error: 'This mapping request is outside your assigned batches.' }, { status: 403 })
    if (requestRow.status !== 'pending_review') return jsonNoStore({ success: true, request: requestRow, alreadyResolved: true })

    let item = null
    let reconciliation = null
    let duplicateTarget = false
    if (decision === 'approve') {
      const { data: target, error: targetError } = await supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,deactivated_at,catalog_status').eq('id', targetId).maybeSingle()
      if (targetError) throw targetError
      if (!isActiveCanonicalCoursework(target)) return jsonNoStore({ error: 'Select an active global canonical coursework item.' }, { status: 400 })
      item = target
      const applied = await ensureReconciliation(supabase, requestRow, item, scope.teacherName)
      reconciliation = applied.existing
      duplicateTarget = applied.duplicateTarget
    }
    const nextStatus = decision === 'approve' ? 'approved' : 'rejected'
    const { data: updated, error: updateError } = await supabase.from('coursework_mapping_requests').update({ status: nextStatus, target_coursework_item_id: item?.id || requestRow.target_coursework_item_id || null, target_title: item?.title || requestRow.target_title || null, target_item_type: item ? normalizeHealthCourseworkType(item.item_type) : requestRow.target_item_type || null, reason: reason || requestRow.reason || null, reviewed_by_role: 'teacher', reviewed_by_name: scope.teacherName, reviewed_at: new Date().toISOString() }).eq('id', requestRow.id).eq('status', 'pending_review').select('*').single()
    if (updateError) throw updateError
    await writeEvent(supabase, requestRow.id, requestRow.status, nextStatus, scope.teacherName, reason || requestRow.reason)
    await appendActivity({ eventType: `coursework_mapping_${nextStatus}`, description: `${scope.teacherName} ${decision}d coursework mapping request ${requestRow.id}.`, actorName: scope.teacherName, actorRole: 'teacher', action: `coursework_mapping_${decision}`, metadata: { request_id: requestRow.id, submission_id: requestRow.submission_id, student_id: requestRow.student_id, coursework_item_id: item?.id || null, duplicate_target: duplicateTarget }, supabase })
    return jsonNoStore({ success: true, request: updated, reconciliation, duplicateTarget, pointsAwarded: decision === 'approve' && !duplicateTarget ? (normalizeHealthCourseworkType(item.item_type) === 'project' ? 10 : 5) : 0 })
  } catch (error) {
    console.error('[teacher-coursework-mapping-review] PATCH failed', error?.message)
    const missing = isMissingHealthCardSchema(error)
    return jsonNoStore({ error: missing ? 'Coursework mapping review is not deployed yet.' : error?.message || 'Could not save mapping review.' }, { status: missing ? 503 : error?.status || 500 })
  }
}

