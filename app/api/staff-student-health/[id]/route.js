import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function GET(request, { params }) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    const teacher = admin ? null : getTeacherFromRequest(request)
    if (!admin && !teacher) return jsonNoStore({ error: 'Staff authorization required' }, { status: 401 })

    const studentId = String(params?.id || '').trim()
    if (!studentId) return jsonNoStore({ error: 'Student id is required' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const scope = teacher ? await getTeacherScope(supabase, teacher.name) : null
    const studentQuery = supabase
      .from('students')
      .select('id,name,batch,login_id')
      .eq('id', studentId)

    if (scope) studentQuery.in('batch', scope.batchNames)
    const { data: student, error: studentError } = await studentQuery.maybeSingle()
    if (studentError) throw studentError
    if (!student) return jsonNoStore({ error: 'Student is outside your access scope' }, { status: 403 })

    const { data: healthCard, error: healthError } = await supabase.rpc('cf_get_student_health_card', {
      p_student_id: student.id,
    })
    if (healthError) {
      if (isMissingHealthCardSchema(healthError)) {
        return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      }
      throw healthError
    }

    const { data: attendanceHistory, error: attendanceError } = await supabase
      .from('student_attendance')
      .select('id,attendance_date,status,marked_at,reviewed_at,reviewed_by')
      .eq('student_id', student.id)
      .eq('batch', student.batch)
      .order('attendance_date', { ascending: false })
      .order('marked_at', { ascending: false })
      .limit(60)
    if (attendanceError) throw attendanceError

    return jsonNoStore({
      success: true,
      student,
      healthCard: {
        ...healthCard,
        attendanceHistory: attendanceHistory || [],
      },
    })
  } catch (error) {
    console.error('[staff-student-health] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load Student Health Card.' }, { status: 500 })
  }
}
