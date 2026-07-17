import { getAdminFromRequest } from '@/lib/admin-auth'
import { getStudentFromRequest } from '@/lib/student-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { assertSubmissionInTeacherScope } from '@/lib/teacher-scope'

export async function authorizeEvaluationRequest(request, submissionId, supabase) {
  const secretResult = authorizeEvaluateSecret(request)
  if (secretResult.authorized) return { authorized: true, actor: 'secret' }

  const admin = getAdminFromRequest(request)
  if (admin) return { authorized: true, actor: 'admin', name: admin.name }

  const teacher = getTeacherFromRequest(request)
  if (teacher) {
    try {
      await assertSubmissionInTeacherScope(supabase, teacher.name, submissionId)
      return { authorized: true, actor: 'teacher', name: teacher.name }
    } catch (err) {
      return { authorized: false, status: err?.status || 403, error: 'Submission is outside this teacher scope' }
    }
  }

  const student = getStudentFromRequest(request)
  if (student) {
    const { data, error } = await supabase
      .from('submissions')
      .select('id')
      .eq('id', submissionId)
      .eq('student_id', student.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data?.id) return { authorized: true, actor: 'student', name: student.name }
    return { authorized: false, status: 403, error: 'Submission is outside this student account' }
  }

  if (secretResult.missingSecret && process.env.NODE_ENV === 'production') {
    return { authorized: false, status: 401, error: 'Authorization required' }
  }
  return { authorized: false, status: 401, error: 'Authorization required' }
}

function authorizeEvaluateSecret(request) {
  const secret = process.env.EVALUATE_SECRET
  if (!secret) return { authorized: false, missingSecret: true }

  const provided =
    request.headers.get('x-evaluate-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  return { authorized: provided === secret, missingSecret: false }
}
