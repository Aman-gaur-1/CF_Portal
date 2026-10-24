import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { withSignedAssignmentUrls } from '@/lib/assignment-file-access'
import { detectAssignmentLanguage, detectAssignmentType, normalizeAssignmentPhase, phaseMatchesDetectedLanguage } from '@/lib/assignment-analysis'
import { calculateLifetimeCoursework, getCourseworkPoints } from '@/lib/coursework-scoring'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'
import { normalizeHealthCourseworkType } from '@/lib/health-card-domain'
import { isSupportedHealthCardPhase } from '@/lib/health-card-admin'

export const dynamic = 'force-dynamic'

const STUDENT_SUBMISSION_SELECT = [
  'id',
  'student_id',
  'student_name',
  'batch',
  'topic',
  'file_name',
  'original_file_name',
  'file_url',
  'code_text',
  'comment',
  'submitted_at',
  'submission_type',
  'coursework_item_id',
  'phase',
  'feedback',
  'feedback_by',
  'feedback_at',
  'ai_status',
  'ai_error',
].join(',')

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

async function requireStudent(request, supabase) {
  const tokenStudent = getStudentFromRequest(request)
  if (!tokenStudent) return null

  const { data, error } = await supabase
    .from('students')
    .select('id,name,batch')
    .eq('id', tokenStudent.id)
    .eq('name', tokenStudent.name)
    .eq('batch', tokenStudent.batch)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

export async function GET(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const student = await requireStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    let { data, error } = await supabase
      .from('submissions')
      .select(STUDENT_SUBMISSION_SELECT)
      .eq('student_id', student.id)
      .order('submitted_at', { ascending: false })

    if (error && isMissingHealthCardSchema(error)) {
      ({ data, error } = await supabase
        .from('submissions')
        .select(STUDENT_SUBMISSION_SELECT.replace('coursework_item_id,', ''))
        .eq('student_id', student.id)
        .order('submitted_at', { ascending: false }))
    }
    if (error) throw new Error(error.message)

    const submissions = data || []
    let courseworkItems = []
    const { data: catalog, error: catalogError } = await supabase
      .from('coursework_items')
      .select('id,item_type,title,batch,active')
    if (!catalogError) courseworkItems = catalog || []
    else if (!isMissingHealthCardSchema(catalogError)) throw new Error(catalogError.message)

    const { canonicalSubmissionIds, ...lifetimeCoursework } = calculateLifetimeCoursework(submissions, courseworkItems)
    const canonicalIds = new Set(canonicalSubmissionIds.map(id => String(id)))
    const decoratedSubmissions = submissions.map(row => ({
      ...row,
      coursework_points: canonicalIds.has(String(row.id)) ? getCourseworkPoints(row.submission_type) : 0,
    }))
    return jsonNoStore({
      success: true,
      submissions: await withSignedAssignmentUrls(decoratedSubmissions, { supabase }),
      lifetimeCoursework,
    })
  } catch (err) {
    console.error('[student-submissions] load failed', err?.message)
    return jsonNoStore({ error: 'Could not load submissions' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const student = await requireStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const courseworkItemId = String(body?.coursework_item_id || body?.courseworkItemId || '').trim()
    const codeText = sanitizeStudentText(body?.code_text, 50000)
    const fileName = String(body?.file_name || '').trim()
    const originalFileName = String(body?.original_file_name || '').trim().slice(0, 240) || null
    if (!courseworkItemId) return jsonNoStore({ error: 'Select active coursework before submitting.' }, { status: 400 })
    if (!fileName && !codeText) return jsonNoStore({ error: 'Upload a file or paste your code' }, { status: 400 })

    const [{ data: item, error: itemError }, { data: activation, error: activationError }] = await Promise.all([
      supabase.from('coursework_items').select('id,item_type,title,phase,batch,active').eq('id', courseworkItemId).maybeSingle(),
      supabase.from('batch_coursework_assignments').select('id,coursework_item_id,batch,active').eq('coursework_item_id', courseworkItemId).eq('batch', student.batch).eq('active', true).maybeSingle(),
    ])
    if (itemError) throw itemError
    if (activationError) throw activationError
    const itemType = normalizeHealthCourseworkType(item?.item_type)
    if (!item || !item.active || !itemType || (item.batch && item.batch !== student.batch) || !activation) {
      return jsonNoStore({ error: 'That coursework is not active for your batch.' }, { status: 409 })
    }
    const topic = sanitizeStudentText(item.title, 240)
    const phase = normalizeAssignmentPhase(item.phase) || sanitizeStudentText(item.phase, 160)
    if (!topic || !phase || !isSupportedHealthCardPhase(phase)) return jsonNoStore({ error: 'The selected coursework is missing a valid phase.' }, { status: 409 })

    const detected = detectAssignmentLanguage({
      text: codeText,
      fileName: originalFileName || fileName,
      topic,
    })
    const assignmentType = detectAssignmentType({
      text: codeText,
      fileName: originalFileName || fileName,
      topic,
    })

    const payload = {
      student_id: student.id,
      student_name: student.name,
      batch: student.batch,
      topic,
      file_name: fileName || null,
      original_file_name: originalFileName,
      file_url: null,
      code_text: codeText || null,
      comment: sanitizeStudentText(body?.comment, 2000),
      submitted_at: new Date().toISOString(),
       coursework_item_id: item.id,
       submission_type: itemType,
      phase,
      detected_assignment_language: sanitizeStudentText(body?.detected_assignment_language, 80) || detected.language,
      detected_assignment_phase: normalizeAssignmentPhase(body?.detected_assignment_phase) || detected.phase,
      detected_assignment_type: assignmentType,
      final_evaluation_phase: phase,
      phase_detection_warning: !phaseMatchesDetectedLanguage(phase, detected),
      ai_status: 'pending',
      ai_workflow_state: 'pending',
    }

    const { data, error } = await supabase
      .from('submissions')
      .insert(payload)
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    return jsonNoStore({ success: true, submission: data })
  } catch (err) {
    console.error('[student-submissions] create failed', err?.message)
    return jsonNoStore({ error: 'Could not submit assignment' }, { status: 500 })
  }
}
