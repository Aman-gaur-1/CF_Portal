import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function GET(request, { params }) {
  try {
    const supabase = getSupabaseAdmin()
    const admin = getAdminFromRequest(request)
    const teacher = getTeacherFromRequest(request)
    if (!admin && !teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const { data: importRow, error: importError } = await supabase.from('attendance_imports').select('*').eq('id', params.id).maybeSingle()
    if (importError) throw importError
    if (!importRow) return jsonNoStore({ error: 'Import not found.' }, { status: 404 })

    if (teacher) {
      const scope = await getTeacherScope(supabase, teacher.name)
      if (!scope.batchNames.includes(importRow.batch)) return jsonNoStore({ error: 'Import is outside this teacher scope.' }, { status: 403 })
    }

    const [{ data: attendance, error: attendanceError }, { data: unlinked, error: unlinkedError }] = await Promise.all([
      supabase.from('student_attendance')
        .select('id,student_id,batch,attendance_date,session_id,status,source,original_participant_name,marked_at,reviewed_at,reviewed_by,review_note,resolved_by_role,resolved_by_name,resolved_at')
        .eq('import_id', importRow.id)
        .order('marked_at', { ascending: false }),
      supabase.from('unlinked_attendance')
        .select('id,participant_name,original_participant_name,corrected_display_name,batch,attendance_date,session_id,status,linked_student_id,linked_at,suggested_student_id,match_score,match_type,match_reason,resolved_by_role,resolved_by_name,resolved_at')
        .eq('import_id', importRow.id)
        .order('created_at', { ascending: false }),
    ])
    if (attendanceError) throw attendanceError
    if (unlinkedError) throw unlinkedError

    const studentIds = [...new Set((attendance || []).map(row => row.student_id).filter(Boolean))]
    const { data: students, error: studentError } = studentIds.length
      ? await supabase.from('students').select('id,name,batch').in('id', studentIds)
      : { data: [], error: null }
    if (studentError) throw studentError
    const studentById = new Map((students || []).map(student => [String(student.id), student]))
    return jsonNoStore({
      success: true,
      import: importRow,
      attendance: (attendance || []).map(row => ({ ...row, student: studentById.get(String(row.student_id)) || null })),
      unlinked: unlinked || [],
    })
  } catch (error) {
    console.error('[attendance-import-detail] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load attendance import detail.' }, { status: 500 })
  }
}
