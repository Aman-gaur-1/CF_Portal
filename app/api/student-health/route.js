import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
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

async function requireCurrentStudent(request, supabase) {
  const tokenStudent = getStudentFromRequest(request)
  if (!tokenStudent) return null

  const { data, error } = await supabase
    .from('students')
    .select('id,name,batch')
    .eq('id', tokenStudent.id)
    .eq('name', tokenStudent.name)
    .eq('batch', tokenStudent.batch)
    .maybeSingle()

  if (error) throw error
  return data || null
}

export async function GET(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const student = await requireCurrentStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    const { data, error } = await supabase.rpc('cf_get_student_health_card', {
      p_student_id: student.id,
    })

    if (error) {
      if (isMissingHealthCardSchema(error)) {
        return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      }
      throw error
    }

    const { data: attendanceHistory, error: attendanceError } = await supabase
      .from('student_attendance')
      .select('id,attendance_date,status,marked_at,reviewed_at,reviewed_by,review_note')
      .eq('student_id', student.id)
      .eq('batch', student.batch)
      .order('attendance_date', { ascending: false })
      .order('marked_at', { ascending: false })
      .limit(60)
    if (attendanceError) throw attendanceError

    return jsonNoStore({
      success: true,
      healthCard: {
        ...data,
        attendanceHistory: attendanceHistory || [],
      },
    })
  } catch (error) {
    console.error('[student-health] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load Student Health Card.' }, { status: 500 })
  }
}

