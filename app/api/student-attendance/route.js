import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getStudentFromRequest } from '@/lib/student-auth'
import { appendActivity } from '@/lib/activity-log'
import { sanitizeStudentText } from '@/lib/ai/sanitize'
import {
  HEALTH_CARD_EPOCH,
  getIndiaDateString,
  isMissingHealthCardSchema,
  isUniqueViolation,
} from '@/lib/student-health-card'
import { parseIsoDate } from '@/lib/health-card-admin'

const MAX_QUERY_DAYS_BACK = 14

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

export async function POST(request) {
  try {
    noStore()
    const supabase = getSupabaseAdmin()
    const student = await requireCurrentStudent(request, supabase)
    if (!student) return jsonNoStore({ error: 'Student authorization required' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const queryDate = body?.date ? String(body.date).trim() : null
    const reason = sanitizeStudentText(body?.reason, 500) || null
    const today = getIndiaDateString()

    let attendanceDate = today
    let reviewNote = null
    let eventType = 'health_attendance_marked'
    let description = ''

    if (queryDate) {
      if (!parseIsoDate(queryDate)) return jsonNoStore({ error: 'Invalid date format.' }, { status: 400 })
      if (queryDate >= today) return jsonNoStore({ error: 'Missing attendance queries are for past dates only.' }, { status: 400 })
      if (queryDate < HEALTH_CARD_EPOCH) return jsonNoStore({ error: `Date must be on or after ${HEALTH_CARD_EPOCH}.` }, { status: 400 })
      const daysDiff = Math.floor((new Date(today) - new Date(queryDate)) / (1000 * 60 * 60 * 24))
      if (daysDiff > MAX_QUERY_DAYS_BACK) return jsonNoStore({ error: `Missing attendance can only be requested for the last ${MAX_QUERY_DAYS_BACK} days.` }, { status: 400 })
      attendanceDate = queryDate
      reviewNote = `Missing attendance request${reason ? `: ${reason}` : ''}`
      eventType = 'health_attendance_query'
      description = `student requested missing attendance for ${queryDate}`
    } else {
      if (today < HEALTH_CARD_EPOCH) return jsonNoStore({ error: 'Health Card attendance has not started yet.' }, { status: 400 })
      description = `student marked attendance for ${today}`
    }

    const { data, error } = await supabase
      .from('student_attendance')
      .insert({
        student_id: student.id,
        batch: student.batch,
        attendance_date: attendanceDate,
        status: 'pending',
        marked_at: new Date().toISOString(),
        review_note: reviewNote,
      })
      .select('id,student_id,batch,attendance_date,status,marked_at,reviewed_at,reviewed_by,review_note')
      .single()

    if (error) {
      if (isUniqueViolation(error)) {
        const msg = queryDate
          ? `Attendance already exists for ${queryDate}.`
          : 'Attendance has already been marked for today.'
        return jsonNoStore({ error: msg }, { status: 409 })
      }
      if (isMissingHealthCardSchema(error)) {
        return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      }
      throw error
    }

    await appendActivity({
      eventType,
      description,
      actorName: 'Student Health Card',
      actorRole: 'system',
      action: queryDate ? 'query' : 'mark',
      metadata: { attendance_id: data.id, student_id: data.student_id, batch: data.batch },
      supabase,
    })

    return jsonNoStore({ success: true, attendance: data, isQuery: Boolean(queryDate) })
  } catch (error) {
    console.error('[student-attendance] create failed', error?.message)
    return jsonNoStore({ error: 'Could not mark attendance.' }, { status: 500 })
  }
}

