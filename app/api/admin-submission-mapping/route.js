import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { calculateCourseworkSummary } from '@/lib/coursework-scoring'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'

export const dynamic = 'force-dynamic'

const SUBMISSION_SELECT = [
  'id', 'student_id', 'student_name', 'batch', 'topic', 'submitted_at',
  'submission_type', 'coursework_item_id', 'phase', 'file_name',
  'original_file_name', 'file_url', 'code_text', 'comment', 'feedback',
  'feedback_by', 'feedback_at', 'ai_evaluation', 'ai_feedback',
  'approved_by', 'approved_at', 'approval_at', 'approval_method',
].join(',')

const ITEM_SELECT = [
  'id', 'item_type', 'title', 'phase', 'batch', 'active', 'deactivated_at',
  'sort_order', 'catalog_status', 'canonical_key', 'canonical_coursework_item_id',
].join(',')

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function validSubmissionId(value) {
  const normalized = String(value || '').trim()
  return validUuid(normalized) || /^[0-9]+$/.test(normalized)
}

function correctionRowsForScoring(corrections, submissionsById) {
  return (corrections || []).map(row => ({
    ...row,
    submitted_at: submissionsById.get(String(row.submission_id))?.submitted_at || row.corrected_at,
  }))
}

function canonicalForSource(source, itemsById) {
  if (!source?.id) return null
  if (source.catalog_status === 'canonical') return source
  return itemsById.get(String(source.canonical_coursework_item_id)) || null
}

async function loadDetails(supabase, submissionId, targetId = '') {
  const [{ data: submission, error: submissionError }, { data: allItems, error: itemError }] = await Promise.all([
    supabase.from('submissions').select(SUBMISSION_SELECT).eq('id', submissionId).maybeSingle(),
    supabase.from('coursework_items').select(ITEM_SELECT).order('phase').order('item_type').order('sort_order').order('title'),
  ])
  if (submissionError) throw submissionError
  if (itemError) throw itemError
  if (!submission) return null

  const items = allItems || []
  const itemsById = new Map(items.map(item => [String(item.id), item]))
  const canonicalItems = items.filter(item => (
    item.catalog_status === 'canonical'
    && item.batch == null
    && item.active
    && !item.deactivated_at
    && ['assignment', 'project'].includes(String(item.item_type || '').trim().toLowerCase())
  ))

  const [{ data: corrections, error: correctionError }, { data: reconciliations, error: reconciliationError }, { data: studentSubmissions, error: studentSubmissionError }, { data: activations, error: activationError }] = await Promise.all([
    supabase.from('coursework_mapping_corrections').select('*').eq('student_id', submission.student_id).order('corrected_at', { ascending: false }).order('id', { ascending: false }),
    supabase.from('student_coursework_reconciliations').select('student_id,batch,coursework_item_id,source_submission_id,source_topic,item_type,confidence,status,counts_for_progress,confirmed_at,updated_at,created_at').eq('student_id', submission.student_id),
    supabase.from('submissions').select('id,student_id,batch,topic,submitted_at,submission_type,coursework_item_id,phase').eq('student_id', submission.student_id).order('submitted_at', { ascending: false }),
    supabase.from('batch_coursework_assignments').select('coursework_item_id,active').eq('batch', submission.batch).eq('active', true),
  ])
  if (correctionError && !isMissingHealthCardSchema(correctionError)) throw correctionError
  if (reconciliationError && !isMissingHealthCardSchema(reconciliationError)) throw reconciliationError
  if (studentSubmissionError) throw studentSubmissionError
  if (activationError) throw activationError

  const safeCorrections = correctionError ? [] : (corrections || [])
  const safeReconciliations = reconciliationError ? [] : (reconciliations || [])
  const studentSubmissionRows = studentSubmissions || []
  const submissionsById = new Map(studentSubmissionRows.map(row => [String(row.id), row]))
  const scoringCorrections = correctionRowsForScoring(safeCorrections, submissionsById)
  const currentSummary = calculateCourseworkSummary(studentSubmissionRows, items, safeReconciliations, scoringCorrections)

  const history = safeCorrections.filter(row => String(row.submission_id) === String(submission.id))
  const latestCorrection = history[0] || null
  const sourceItem = submission.coursework_item_id ? itemsById.get(String(submission.coursework_item_id)) : null
  const sourceCanonical = canonicalForSource(sourceItem, itemsById)
  const reconciliation = safeReconciliations
    .filter(row => String(row.source_submission_id || '') === String(submission.id))
    .sort((left, right) => String(right.updated_at || right.created_at || '').localeCompare(String(left.updated_at || left.created_at || '')))[0] || null
  const reconciliationCanonical = reconciliation ? itemsById.get(String(reconciliation.coursework_item_id)) : null
  const currentItem = latestCorrection
    ? itemsById.get(String(latestCorrection.new_canonical_coursework_item_id))
    : sourceCanonical || reconciliationCanonical || null

  let targetItem = targetId ? itemsById.get(String(targetId)) : null
  let preview = null
  if (targetId) {
    if (!targetItem || !canonicalItems.some(item => String(item.id) === String(targetItem.id))) {
      return { error: jsonNoStore({ error: 'Select an active canonical coursework item.' }, { status: 400 }) }
    }
    const previewCorrections = safeCorrections.map(row => (
      String(row.submission_id) === String(submission.id)
        ? { ...row, new_canonical_coursework_item_id: targetItem.id, new_canonical_title: targetItem.title, new_canonical_phase: targetItem.phase, new_item_type: targetItem.item_type }
        : row
    ))
    if (!latestCorrection) {
      previewCorrections.push({
        submission_id: submission.id,
        student_id: submission.student_id,
        batch: submission.batch,
        new_canonical_coursework_item_id: targetItem.id,
        new_canonical_title: targetItem.title,
        new_canonical_phase: targetItem.phase,
        new_item_type: targetItem.item_type,
        corrected_at: new Date().toISOString(),
      })
    }
    const previewSummary = calculateCourseworkSummary(
      studentSubmissionRows,
      items,
      safeReconciliations,
      correctionRowsForScoring(previewCorrections, submissionsById),
    )
    let healthCardTotal = null
    const { data: healthCard, error: healthError } = await supabase.rpc('cf_get_student_health_card', { p_student_id: submission.student_id })
    if (!healthError) {
      const healthMetrics = healthCard?.metrics || {}
      const value = Number(healthMetrics.totalPoints)
      if (Number.isFinite(value)) healthCardTotal = value
    }
    const activeIds = new Set((activations || []).map(row => String(row.coursework_item_id)))
    const activeForBatch = activeIds.has(String(targetItem.id)) || items.some(item => activeIds.has(String(item.id)) && String(item.canonical_coursework_item_id || '') === String(targetItem.id))
    preview = {
      before: {
        itemId: currentItem?.id || null,
        title: currentItem?.title || null,
        phase: currentItem?.phase || null,
        itemType: currentItem?.item_type || null,
        points: currentItem ? (String(currentItem.item_type).toLowerCase() === 'project' ? 10 : 5) : 0,
        assignmentCount: currentSummary.assignmentCount,
        projectCount: currentSummary.projectCount,
        courseworkPoints: currentSummary.points,
        healthCardTotal,
      },
      after: {
        itemId: targetItem.id,
        title: targetItem.title,
        phase: targetItem.phase,
        itemType: targetItem.item_type,
        points: String(targetItem.item_type).toLowerCase() === 'project' ? 10 : 5,
        assignmentCount: previewSummary.assignmentCount,
        projectCount: previewSummary.projectCount,
        courseworkPoints: previewSummary.points,
        healthCardTotal: healthCardTotal == null ? null : healthCardTotal - currentSummary.points + previewSummary.points,
        activeForBatch,
      },
      duplicateTarget: currentSummary.canonicalCourseworkItemIds.some(id => String(id) === String(targetItem.id)) && String(currentItem?.id || '') !== String(targetItem.id),
      rankPreviewAvailable: false,
    }
  }

  return {
    submission,
    currentMapping: currentItem ? { id: currentItem.id, title: currentItem.title, phase: currentItem.phase, itemType: currentItem.item_type } : null,
    canonicalItems,
    history,
    preview,
  }
}

export async function GET(request) {
  try {
    noStore()
    if (!getAdminFromRequest(request)) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const submissionId = String(request.nextUrl.searchParams.get('submissionId') || '').trim()
    const targetId = String(request.nextUrl.searchParams.get('targetCanonicalCourseworkItemId') || '').trim()
    if (!validSubmissionId(submissionId)) return jsonNoStore({ error: 'A valid submissionId is required.' }, { status: 400 })
    if (targetId && !validUuid(targetId)) return jsonNoStore({ error: 'A valid canonical coursework item is required.' }, { status: 400 })
    const details = await loadDetails(getSupabaseAdmin(), submissionId, targetId)
    if (!details) return jsonNoStore({ error: 'Submission not found.' }, { status: 404 })
    if (details.error) return details.error
    return jsonNoStore({ success: true, ...details })
  } catch (error) {
    console.error('[admin-submission-mapping] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load coursework mapping details.' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const forbiddenFields = ['newPoints', 'points', 'score', 'submission_type', 'phase', 'item_type', 'newType']
    if (forbiddenFields.some(field => Object.prototype.hasOwnProperty.call(body || {}, field))) {
      return jsonNoStore({ error: 'Only submissionId, targetCanonicalCourseworkItemId, and reason are accepted.' }, { status: 400 })
    }
    const submissionId = String(body?.submissionId || '').trim()
    const targetId = String(body?.targetCanonicalCourseworkItemId || '').trim()
    const reason = String(body?.reason || '').trim()
    if (!validSubmissionId(submissionId) || !validUuid(targetId)) return jsonNoStore({ error: 'A valid submissionId and target canonical coursework item are required.' }, { status: 400 })
    if (reason.length < 5 || reason.length > 500) return jsonNoStore({ error: 'Enter a correction reason between 5 and 500 characters.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('cf_correct_coursework_mapping', {
      p_submission_id: submissionId,
      p_target_canonical_coursework_item_id: targetId,
      p_reason: reason,
      p_admin_name: admin.name,
    })
    if (error) {
      const status = /already mapped|not found|active canonical|required/i.test(error.message || '') ? 409 : 400
      return jsonNoStore({ error: error.message || 'Could not correct coursework mapping.' }, { status })
    }
    return jsonNoStore({ success: true, correction: data })
  } catch (error) {
    console.error('[admin-submission-mapping] correction failed', error?.message)
    return jsonNoStore({ error: 'Could not correct coursework mapping.' }, { status: 500 })
  }
}
