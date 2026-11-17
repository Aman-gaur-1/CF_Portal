import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { createStudentAccount, normalizeManualStudentInput } from '@/lib/student-onboarding'
import { normalizeParticipantName } from '@/lib/attendance-matching'
import { loadBatchAliases, saveAlias } from '@/lib/attendance-domain'
import { reconcileWaitingAttendanceSafely } from '@/lib/attendance-reconciliation'
import { appendActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function POST(request) {
  try {
    const teacher = getTeacherFromRequest(request)
    if (!teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const input = normalizeManualStudentInput(await request.json().catch(() => ({})))
    const supabase = getSupabaseAdmin()
    const scope = await getTeacherScope(supabase, teacher.name)
    if (!scope.batchNames.includes(input.batch)) return jsonNoStore({ error: 'You can only add students to a batch assigned to you.' }, { status: 403 })
    const result = await createStudentAccount({ supabase, input, actorRole: 'teacher', actorName: scope.teacherName })

    let aliasCreated = false
    if (input.teamsDisplayName && normalizeParticipantName(input.teamsDisplayName) !== normalizeParticipantName(result.student.name)) {
      const aliases = await loadBatchAliases(supabase, result.student.batch)
      const aliasResult = await saveAlias({ supabase, student: result.student, alias: input.teamsDisplayName, source: 'manual_onboarding', actor: { role: 'teacher', name: scope.teacherName }, existingAliases: aliases })
      aliasCreated = Boolean(aliasResult.created)
    }
    await reconcileWaitingAttendanceSafely({ supabase, student: result.student })
    await appendActivity({
      eventType: 'student_created',
      description: `Created ${result.student.name} in ${result.student.batch}.`,
      actorName: scope.teacherName,
      actorRole: 'teacher',
      action: 'manual_student_onboarding',
      metadata: { student_id: result.student.id, batch: result.student.batch, login_id: result.student.login_id, alias_created: aliasCreated },
      supabase,
    })
    return jsonNoStore({ success: true, student: result.student, credential: { name: result.student.name, batch: result.student.batch, loginId: result.loginId, password: result.password }, aliasCreated })
  } catch (error) {
    console.error('[teacher-student-onboarding] failed', error?.message)
    return jsonNoStore({ error: error?.message || 'Could not create the student account.' }, { status: error?.status || 500 })
  }
}

