import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import { withSignedAssignmentUrls } from '@/lib/assignment-file-access'
import { detectAssignmentLanguage, detectAssignmentType, normalizeAssignmentPhase, phaseMatchesDetectedLanguage } from '@/lib/assignment-analysis'

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

    const { data, error } = await supabase
      .from('submissions')
      .select(STUDENT_SUBMISSION_SELECT)
      .eq('student_id', student.id)
      .order('submitted_at', { ascending: false })

    if (error) throw new Error(error.message)
    return jsonNoStore({ success: true, submissions: await withSignedAssignmentUrls(data || [], { supabase }) })
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
    const topic = sanitizeStudentText(body?.topic, 240)
    const codeText = sanitizeStudentText(body?.code_text, 50000)
    const fileName = String(body?.file_name || '').trim()
    const originalFileName = String(body?.original_file_name || '').trim().slice(0, 240) || null
    const phase = normalizeAssignmentPhase(body?.phase)

    if (!topic) return jsonNoStore({ error: 'Topic is required' }, { status: 400 })
    if (!phase) return jsonNoStore({ error: 'Assignment phase is required' }, { status: 400 })
    if (!fileName && !codeText) return jsonNoStore({ error: 'Upload a file or paste your code' }, { status: 400 })

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
      submission_type: 'assignment',
      phase,
      detected_assignment_language: sanitizeStudentText(body?.detected_assignment_language, 80) || detected.language,
      detected_assignment_phase: normalizeAssignmentPhase(body?.detected_assignment_phase) || detected.phase,
      detected_assignment_type: assignmentType,
      final_evaluation_phase: phase,
      phase_detection_warning: !phaseMatchesDetectedLanguage(phase, detected),
      ai_status: 'pending',
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
