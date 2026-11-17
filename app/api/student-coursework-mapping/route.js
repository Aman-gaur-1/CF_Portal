import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
import { normalizeHealthCourseworkType } from '@/lib/health-card-domain'
import { chooseSafeStudentMapping, isActiveCanonicalCoursework } from '@/lib/coursework-mapping'
import { isMissingHealthCardSchema, isUniqueViolation } from '@/lib/student-health-card'
import { appendActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function validSubmissionId(value) {
  const normalized = String(value || '').trim()
  return /^\d+$/.test(normalized) || validUuid(normalized)
}

async function requireStudent(request, supabase) {
  const tokenStudent = getStudentFromRequest(request)
  if (!tokenStudent) return null
  const { data, error } = await supabase.from('students').select('id,name,batch,status').eq('id', tokenStudent.id).eq('name', tokenStudent.name).eq('batch', tokenStudent.batch).eq('status', 'active').maybeSingle()
  if (error) throw error
  return data || null
}

async function loadCanonicalChoices(supabase) {
  const [{ data: items, error: itemError }, { data: aliases, error: aliasError }] = await Promise.all([
    supabase.from('coursework_items').select('id,item_type,title,phase,batch,active,deactivated_at,catalog_status,canonical_coursework_item_id').order('phase').order('item_type').order('sort_order').order('title'),
    supabase.from('coursework_aliases').select('normalized_alias,original_alias,source_phase,source_item_type,canonical_coursework_item_id,confidence,mapping_status'),
  ])
  if (itemError) throw itemError
  if (aliasError && !isMissingHealthCardSchema(aliasError)) throw aliasError
  return { items: (items || []).filter(isActiveCanonicalCoursework), aliases: aliasError ? [] : (aliases || []) }
}

async function loadSubmissionContext(supabase, student, submissionId) {
  const { data: submission, error } = await supabase.from('submissions').select('id,student_id,student_name,batch,topic,submission_type,coursework_item_id,phase,submitted_at').eq('id', submissionId).eq('student_id', student.id).eq('batch', student.batch).maybeSingle()
  if (error) throw error
  return submission || null
}

async function loadSourceCatalogItem(supabase, submission) {
  if (!submission?.coursework_item_id) return null
  const { data, error } = await supabase.from('coursework_items').select('id,item_type,title,active,deactivated_at,batch,catalog_status,canonical_coursework_item_id').eq('id', submission.coursework_item_id).maybeSingle()
  if (error) throw error
  return data || null
}

async function findRequest(supabase, submissionId) {
  const { data, error } = await supabase.from('coursework_mapping_requests').select('*').eq('submission_id', String(submissionId)).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error && !isMissingHealthCardSchema(error)) throw error
  return error ? null : data
}

async function writeEvent(supabase, requestId, fromStatus, toStatus, actorRole, actorName, reason) {
  const { error } = await supabase.from('coursework_mapping_request_events').insert({ request_id: requestId, from_status: fromStatus || null, to_status: toStatus, actor_role: actorRole, actor_name: actorName, reason: reason || null })
  if (error) throw error
}

async function ensureReconciliation(supabase, { student, submission, item, confidence }) {
  const { data: sourceExisting, error: sourceLookupError } = await supabase.from('student_coursework_reconciliations').select('id,source_submission_id,coursework_item_id').eq('student_id', student.id).eq('source_submission_id', String(submission.id)).eq('status', 'confirmed').limit(1).maybeSingle()
  if (sourceLookupError) throw sourceLookupError
  if (sourceExisting && String(sourceExisting.coursework_item_id) !== String(item.id)) {
    const error = new Error('This submission is already mapped to another canonical coursework item. Ask your Trainer or Admin to correct it.')
    error.status = 409
    throw error
  }
  if (sourceExisting) return { reconciliation: sourceExisting, duplicateTarget: false }
  const { data: existing, error: lookupError } = await supabase.from('student_coursework_reconciliations').select('id,source_submission_id,coursework_item_id').eq('student_id', student.id).eq('coursework_item_id', item.id).eq('status', 'confirmed').limit(1).maybeSingle()
  if (lookupError) throw lookupError
  if (existing) return { reconciliation: existing, duplicateTarget: String(existing.source_submission_id || '') !== String(submission.id) }
  const phase = String(item.phase || submission.phase || '').trim()
  if (!['Python', 'Data Analytics', 'SQL'].includes(phase)) {
    const error = new Error('The selected coursework item is missing a valid curriculum phase.')
    error.status = 400
    throw error
  }
  const payload = {
    student_id: student.id,
    batch: student.batch,
    coursework_item_id: item.id,
    source_submission_id: String(submission.id),
    source_topic: submission.topic,
    phase,
    item_type: normalizeHealthCourseworkType(item.item_type),
    confidence,
    status: 'confirmed',
    counts_for_progress: true,
    counts_for_points: true,
    confirmed_by: 'student_self_service',
    confirmed_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('student_coursework_reconciliations').insert(payload).select('id,source_submission_id,coursework_item_id').single()
  if (!error) return { reconciliation: data, duplicateTarget: false }
  if (isUniqueViolation(error)) {
    const retry = await supabase.from('student_coursework_reconciliations').select('id,source_submission_id,coursework_item_id').eq('student_id', student.id).eq('coursework_item_id', item.id).eq('status', 'confirmed').limit(1).maybeSingle()
    if (retry.error) throw retry.error
    return { reconciliation: retry.data, duplicateTarget: String(retry.data?.source_submission_id || '') !== String(submission.id) }
  }
  throw error
}

async function saveMappingRequest(supabase, { student, submission, item, status, reason, actorRole = 'student', actorName = student.name }) {
  const existing = await findRequest(supabase, submission.id)
  const payload = {
    submission_id: String(submission.id),
    student_id: student.id,
    batch: student.batch,
    source_topic: submission.topic || 'Untitled coursework',
    source_item_type: normalizeHealthCourseworkType(submission.submission_type) || null,
    source_phase: submission.phase || null,
    target_coursework_item_id: item?.id || null,
    target_title: item?.title || null,
    target_item_type: item ? normalizeHealthCourseworkType(item.item_type) : null,
    status,
    reason,
    requested_by_role: existing?.requested_by_role || actorRole,
    requested_by_name: existing?.requested_by_name || actorName,
    reviewed_by_role: status === 'pending_review' ? null : actorRole,
    reviewed_by_name: status === 'pending_review' ? null : actorName,
    reviewed_at: status === 'pending_review' ? null : new Date().toISOString(),
  }
  let requestRow
  if (existing) {
    const { data, error } = await supabase.from('coursework_mapping_requests').update(payload).eq('id', existing.id).select('*').single()
    if (error) throw error
    requestRow = data
  } else {
    const { data, error } = await supabase.from('coursework_mapping_requests').insert(payload).select('*').single()
    if (error && isUniqueViolation(error)) {
      const concurrent = await findRequest(supabase, submission.id)
      if (concurrent) return concurrent
    }
    if (error) throw error
    requestRow = data
  }
  if (!existing || existing.status !== status) await writeEvent(supabase, requestRow.id, existing?.status, status, actorRole, actorName, reason)
  return requestRow
}

export async function GET(request) {
  try {
    const supabase = getSupabaseAdmin()
    const student = await requireStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })
    const submissionId = String(new URL(request.url).searchParams.get('submissionId') || '').trim()
    if (!validSubmissionId(submissionId)) return jsonNoStore({ error: 'A valid submissionId is required.' }, { status: 400 })
    const submission = await loadSubmissionContext(supabase, student, submissionId)
    if (!submission) return jsonNoStore({ error: 'Submission not found.' }, { status: 404 })
    const [{ items, aliases }, requestRow] = await Promise.all([loadCanonicalChoices(supabase), findRequest(supabase, submission.id)])
    return jsonNoStore({ success: true, submission, canonicalItems: items, request: requestRow, safeSuggestion: chooseSafeStudentMapping({ sourceTopic: submission.topic, sourceType: submission.submission_type, sourcePhase: submission.phase, canonicalItems: items, aliases }) })
  } catch (error) {
    console.error('[student-coursework-mapping] GET failed', error?.message)
    return jsonNoStore({ error: isMissingHealthCardSchema(error) ? 'Coursework mapping is not deployed yet.' : 'Could not load coursework mapping options.' }, { status: isMissingHealthCardSchema(error) ? 503 : 500 })
  }
}

export async function POST(request) {
  try {
    const supabase = getSupabaseAdmin()
    const student = await requireStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const submissionId = String(body?.submissionId || '').trim()
    const targetId = String(body?.targetCanonicalCourseworkItemId || '').trim()
    if (!validSubmissionId(submissionId) || !validUuid(targetId)) return jsonNoStore({ error: 'A valid submissionId and canonical coursework item are required.' }, { status: 400 })
    const submission = await loadSubmissionContext(supabase, student, submissionId)
    if (!submission) return jsonNoStore({ error: 'Submission not found.' }, { status: 404 })
    const { items, aliases } = await loadCanonicalChoices(supabase)
    const item = items.find(candidate => String(candidate.id) === targetId)
    if (!item) return jsonNoStore({ error: 'Select an active canonical coursework item.' }, { status: 400 })
    const sourceItem = await loadSourceCatalogItem(supabase, submission)
    if (sourceItem && isActiveCanonicalCoursework(sourceItem)) {
      return jsonNoStore({ error: 'This submission already has an active canonical coursework mapping.' }, { status: 409 })
    }

    const existingRequest = await findRequest(supabase, submission.id)
    if (existingRequest && ['auto_applied', 'approved'].includes(existingRequest.status) && String(existingRequest.target_coursework_item_id || '') !== targetId) {
      return jsonNoStore({ error: 'This submission is already mapped. Ask your Trainer or Admin to correct the existing mapping.' }, { status: 409 })
    }

    const safeSuggestion = chooseSafeStudentMapping({ sourceTopic: submission.topic, sourceType: submission.submission_type, sourcePhase: submission.phase, canonicalItems: items, aliases })
    const typeChanged = normalizeHealthCourseworkType(submission.submission_type) !== normalizeHealthCourseworkType(item.item_type)
    const autoApply = !typeChanged && safeSuggestion.mode === 'auto_applied' && String(safeSuggestion.item?.id) === targetId
    if (!autoApply) {
      const mappingRequest = await saveMappingRequest(supabase, { student, submission, item, status: 'pending_review', reason: typeChanged ? 'Coursework type differs from the submitted type; Trainer review required.' : 'Student selected a coursework mapping that requires Trainer review.' })
      return jsonNoStore({ success: true, status: 'pending_review', request: mappingRequest, duplicateTarget: false })
    }

    const applied = await ensureReconciliation(supabase, { student, submission, item, confidence: safeSuggestion.reason.includes('alias') ? 'high_confidence' : 'confirmed' })
    const mappingRequest = await saveMappingRequest(supabase, { student, submission, item, status: 'auto_applied', reason: safeSuggestion.reason })
    await appendActivity({ eventType: 'student_coursework_mapping_auto_applied', description: `Student ${student.name} mapped submission ${submission.id} to ${item.title}.`, actorName: student.name, actorRole: 'system', action: 'student_mapping_auto_apply', metadata: { submission_id: submission.id, student_id: student.id, coursework_item_id: item.id, duplicate_target: applied.duplicateTarget }, supabase })
    return jsonNoStore({ success: true, status: 'auto_applied', request: mappingRequest, duplicateTarget: applied.duplicateTarget, pointsAwarded: applied.duplicateTarget ? 0 : (normalizeHealthCourseworkType(item.item_type) === 'project' ? 10 : 5) })
  } catch (error) {
    console.error('[student-coursework-mapping] POST failed', error?.message)
    const missing = isMissingHealthCardSchema(error)
    return jsonNoStore({ error: missing ? 'Coursework mapping is not deployed yet.' : 'Could not save coursework mapping.' }, { status: missing ? 503 : error?.status || 500 })
  }
}

