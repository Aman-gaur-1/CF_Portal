import { appendActivity } from '@/lib/activity-log'
import { matchParticipantName } from '@/lib/attendance-matching'
import { buildMatchFields, linkUnlinkedAttendance, loadBatchAliases } from '@/lib/attendance-domain'

export async function reconcileWaitingAttendanceForStudent({ supabase, student }) {
  if (!student?.id || !student?.batch) return { linked: 0, suggested: 0, skipped: 0 }

  const [{ data: rows, error: rowError }, { data: students, error: studentError }, aliases] = await Promise.all([
    supabase.from('unlinked_attendance')
      .select('*')
      .eq('batch', student.batch)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(500),
    supabase.from('students').select('id,name,batch').eq('batch', student.batch).eq('status', 'active'),
    loadBatchAliases(supabase, student.batch),
  ])
  if (rowError) throw rowError
  if (studentError) throw studentError

  const allStudents = students || []
  let linked = 0
  let suggested = 0
  let skipped = 0
  for (const row of rows || []) {
    const match = matchParticipantName({ participantName: row.original_participant_name || row.participant_name, students: allStudents, aliases })
    if (match.student?.id && String(match.student.id) === String(student.id) && ['alias', 'exact'].includes(match.type)) {
      await linkUnlinkedAttendance({
        supabase,
        row,
        student,
        actor: { role: 'system', name: 'student registration' },
        source: 'resolved_unmatched',
      })
      linked += 1
      await appendActivity({
        eventType: 'attendance_auto_linked_after_registration',
        description: `auto-linked attendance for ${student.name} after registration`,
        actorName: 'student registration',
        actorRole: 'system',
        action: 'auto_link',
        metadata: { student_id: student.id, unlinked_id: row.id, batch: student.batch },
        supabase,
      })
      continue
    }

    if (match.student?.id && String(match.student.id) === String(student.id) && ['high_confidence', 'suggested', 'ambiguous'].includes(match.type)) {
      const { error } = await supabase.from('unlinked_attendance').update(buildMatchFields(match)).eq('id', row.id).eq('status', 'waiting')
      if (error) throw error
      suggested += 1
    } else {
      skipped += 1
    }
  }

  return { linked, suggested, skipped }
}

export async function reconcileWaitingAttendanceSafely({ supabase, student }) {
  try {
    return await reconcileWaitingAttendanceForStudent({ supabase, student })
  } catch (error) {
    console.error('[attendance-reconciliation] failed', error?.message)
    return { linked: 0, suggested: 0, skipped: 0, error: error?.message || 'reconciliation failed' }
  }
}
