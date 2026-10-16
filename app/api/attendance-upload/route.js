import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { appendActivity } from '@/lib/activity-log'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { HEALTH_CARD_EPOCH, isMissingHealthCardSchema, isUniqueViolation } from '@/lib/student-health-card'
import { parseIsoDate } from '@/lib/health-card-admin'
import { parseTeamsReport, buildUploadPreview, stripTeamsSuffix } from '@/lib/attendance-upload'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 5 * 1024 * 1024

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

function resolveAuth(request) {
  const admin = getAdminFromRequest(request)
  if (admin) return { role: 'admin', name: admin.name, batchFilter: null }
  const teacher = getTeacherFromRequest(request)
  if (teacher) return { role: 'teacher', name: teacher.name, batchFilter: 'scope' }
  return null
}

export async function POST(request) {
  try {
    noStore()
    const auth = resolveAuth(request)
    if (!auth) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()

    let allowedBatches = null
    let resolvedName = auth.name
    if (auth.batchFilter === 'scope') {
      const scope = await getTeacherScope(supabase, auth.name)
      allowedBatches = scope.batchNames
      resolvedName = scope.teacherName || auth.name
      if (!allowedBatches.length) return jsonNoStore({ error: 'No batches assigned to this teacher.' }, { status: 403 })
    }

    const formData = await request.formData().catch(() => null)
    if (!formData) return jsonNoStore({ error: 'Invalid form data.' }, { status: 400 })

    const action = String(formData.get('action') || 'preview').trim().toLowerCase()
    const batch = String(formData.get('batch') || '').trim()
    const date = String(formData.get('date') || '').trim()

    if (!batch) return jsonNoStore({ error: 'Batch is required.' }, { status: 400 })
    if (!date || !parseIsoDate(date)) return jsonNoStore({ error: 'A valid date (YYYY-MM-DD) is required.' }, { status: 400 })
    if (date < HEALTH_CARD_EPOCH) return jsonNoStore({ error: `Date must be on or after ${HEALTH_CARD_EPOCH}.` }, { status: 400 })
    if (allowedBatches && !allowedBatches.includes(batch)) {
      return jsonNoStore({ error: 'This batch is not assigned to you.' }, { status: 403 })
    }

    if (action === 'preview') return handlePreview({ formData, supabase, batch, date })
    if (action === 'confirm') return handleConfirm({ formData, supabase, batch, date, auth, resolvedName })
    return jsonNoStore({ error: 'Invalid action. Use "preview" or "confirm".' }, { status: 400 })
  } catch (error) {
    console.error('[attendance-upload] failed', error?.message)
    return jsonNoStore({ error: 'Could not process attendance upload.' }, { status: 500 })
  }
}

async function handlePreview({ formData, supabase, batch, date }) {
  const file = formData.get('file')
  if (!file || typeof file === 'string') return jsonNoStore({ error: 'An attendance file is required.' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return jsonNoStore({ error: 'File size exceeds 5 MB limit.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = parseTeamsReport(buffer, file.name)
  if (parsed.meta?.error) return jsonNoStore({ error: parsed.meta.error }, { status: 400 })
  if (!parsed.names.length) return jsonNoStore({ error: 'No names found in the uploaded file.' }, { status: 400 })

  const [{ data: students, error: studentError }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from('students').select('id,name,batch').eq('batch', batch),
    supabase.from('student_attendance').select('id,student_id,status').eq('batch', batch).eq('attendance_date', date),
  ])

  if (studentError) {
    if (isMissingHealthCardSchema(studentError)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
    throw studentError
  }
  if (existingError) throw existingError

  const preview = buildUploadPreview({
    fileNames: parsed.names,
    students: students || [],
    existingAttendance: existing || [],
    date,
    batch,
  })

  return jsonNoStore({ success: true, preview, fileMeta: parsed.meta })
}

async function handleConfirm({ formData, supabase, batch, date, auth, resolvedName }) {
  const rawRecords = formData.get('records')
  let records
  try {
    records = JSON.parse(rawRecords)
    if (!Array.isArray(records) || !records.length) throw new Error()
  } catch {
    return jsonNoStore({ error: 'Records must be a non-empty JSON array of { studentId, fileName }.' }, { status: 400 })
  }

  if (records.length > 200) return jsonNoStore({ error: 'Cannot process more than 200 records at once.' }, { status: 400 })

  const studentIds = [...new Set(records.map(r => String(r.studentId || '').trim()).filter(Boolean))]
  if (!studentIds.length) return jsonNoStore({ error: 'No valid student IDs in records.' }, { status: 400 })

  const { data: students, error: verifyError } = await supabase
    .from('students').select('id,name,batch').in('id', studentIds).eq('batch', batch)
  if (verifyError) throw verifyError

  const validStudentIds = new Set((students || []).map(s => String(s.id)))
  const verified = records.filter(r => validStudentIds.has(String(r.studentId || '').trim()))
  if (!verified.length) return jsonNoStore({ error: 'None of the submitted student IDs belong to this batch.' }, { status: 400 })

  const now = new Date().toISOString()
  const rows = verified.map(r => ({
    student_id: String(r.studentId).trim(),
    batch,
    attendance_date: date,
    status: 'approved',
    marked_at: now,
    reviewed_at: now,
    reviewed_by: resolvedName,
    review_note: `Uploaded from Teams report by ${auth.role}`,
  }))

  let created = 0
  let skipped = 0
  const errors = []

  for (const row of rows) {
    const { error: insertError } = await supabase
      .from('student_attendance')
      .insert(row)
      .select('id')
      .single()

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        skipped++
      } else {
        errors.push({ studentId: row.student_id, error: insertError.message })
      }
    } else {
      created++
    }
  }

  if (created > 0) {
    await appendActivity({
      eventType: 'attendance_bulk_upload',
      description: `bulk uploaded ${created} attendance record${created === 1 ? '' : 's'} for ${batch} on ${date}`,
      actorName: resolvedName,
      actorRole: auth.role === 'admin' ? 'admin' : 'teacher',
      action: 'upload',
      metadata: { batch, date, created, skipped, errors: errors.length },
      supabase,
    })

    const studentById = new Map((students || []).map(s => [String(s.id), s]))
    await Promise.allSettled(verified.map(r => {
      const sid = String(r.studentId).trim()
      return createNotification({
        userType: NOTIFICATION_USER_TYPE.STUDENT,
        userIdentifier: sid,
        notificationType: NOTIFICATION_TYPE.HEALTH_ATTENDANCE_APPROVED,
        title: 'Attendance recorded',
        message: `Your attendance for ${date} has been recorded and approved.`,
        referenceType: 'student_attendance',
        referenceId: sid,
        icon: '✓',
        severity: 'success',
        actionLabel: 'View Health Card',
        actionUrl: '/',
        supabase,
      })
    }))
  }

  const studentById = new Map((students || []).map(s => [String(s.id), s]))
  const createdNames = verified
    .filter(r => !errors.some(e => e.studentId === String(r.studentId).trim()))
    .map(r => {
      const s = studentById.get(String(r.studentId).trim())
      return { studentId: r.studentId, studentName: s?.name || 'Unknown', fileName: r.fileName }
    })

  const rawUnmatched = formData.get('unmatched')
  let unmatchedNames = []
  try { unmatchedNames = JSON.parse(rawUnmatched) || [] } catch {}
  let savedUnlinked = 0
  if (Array.isArray(unmatchedNames) && unmatchedNames.length) {
    const unlinkedRows = unmatchedNames
      .filter(n => typeof n === 'string' && n.trim())
      .slice(0, 200)
      .map(name => ({
        participant_name: stripTeamsSuffix(name),
        batch,
        attendance_date: date,
        uploaded_by_role: auth.role,
        uploaded_by_name: resolvedName,
      }))
    if (unlinkedRows.length) {
      const { data: inserted } = await supabase
        .from('unlinked_attendance')
        .upsert(unlinkedRows, { onConflict: 'participant_name,batch,attendance_date', ignoreDuplicates: true })
        .select('id')
      savedUnlinked = inserted?.length || 0
    }
  }

  return jsonNoStore({
    success: true,
    result: { created, skipped, errors: errors.length, total: verified.length, createdNames, savedUnlinked },
  })
}
