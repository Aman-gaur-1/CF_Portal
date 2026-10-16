import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { buildUploadPreview } from '@/lib/attendance-upload'
import { HEALTH_CARD_EPOCH } from '@/lib/student-health-card'

export const dynamic = 'force-dynamic'

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

export async function GET(request) {
  try {
    noStore()
    const auth = resolveAuth(request)
    if (!auth) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const params = request.nextUrl.searchParams
    const batch = String(params.get('batch') || '').trim()
    const date = String(params.get('date') || '').trim()

    let allowedBatches = null
    if (auth.batchFilter === 'scope') {
      const scope = await getTeacherScope(supabase, auth.name)
      allowedBatches = scope.batchNames
      if (!allowedBatches.length) return jsonNoStore({ error: 'No batches assigned.' }, { status: 403 })
    }

    let query = supabase
      .from('unlinked_attendance')
      .select('id,participant_name,batch,attendance_date,uploaded_by_role,uploaded_by_name,status,linked_student_id,linked_at,created_at')
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })
      .limit(500)

    if (batch) {
      if (allowedBatches && !allowedBatches.includes(batch)) return jsonNoStore({ error: 'Batch not assigned.' }, { status: 403 })
      query = query.eq('batch', batch)
    } else if (allowedBatches) {
      query = query.in('batch', allowedBatches)
    }
    if (date) query = query.eq('attendance_date', date)

    const { data: rows, error } = await query
    if (error) throw error

    return jsonNoStore({ success: true, unlinked: rows || [], count: (rows || []).length })
  } catch (error) {
    console.error('[unlinked-attendance] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load unlinked attendance.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    noStore()
    const auth = resolveAuth(request)
    if (!auth) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').trim()

    if (action === 'rematch') return handleRematch({ body, auth, request })
    if (action === 'dismiss') return handleDismiss({ body, auth })
    if (action === 'link') return handleLink({ body, auth })
    return jsonNoStore({ error: 'Invalid action. Use "rematch", "dismiss", or "link".' }, { status: 400 })
  } catch (error) {
    console.error('[unlinked-attendance] action failed', error?.message)
    return jsonNoStore({ error: 'Could not process unlinked attendance action.' }, { status: 500 })
  }
}

async function handleRematch({ body, auth }) {
  const ids = Array.isArray(body?.ids) ? body.ids : [body?.id]
  const validIds = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))]
  if (!validIds.length) return jsonNoStore({ error: 'No IDs provided.' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data: unlinked, error } = await supabase
    .from('unlinked_attendance')
    .select('id,participant_name,batch,attendance_date')
    .in('id', validIds)
    .eq('status', 'waiting')
  if (error) throw error
  if (!unlinked?.length) return jsonNoStore({ error: 'No waiting records found.' }, { status: 404 })

  const scopeError = await assertUnlinkedScope({ supabase, auth, rows: unlinked })
  if (scopeError) return scopeError

  const batches = [...new Set(unlinked.map(u => u.batch))]
  const { data: students, error: studentError } = await supabase
    .from('students').select('id,name,batch').in('batch', batches)
  if (studentError) throw studentError

  const results = []
  for (const row of unlinked) {
    const batchStudents = (students || []).filter(s => s.batch === row.batch)
    const preview = buildUploadPreview({
      fileNames: [row.participant_name],
      students: batchStudents,
      existingAttendance: [],
      date: row.attendance_date,
      batch: row.batch,
    })

    const match = preview.matched[0] || preview.uncertain[0]
    if (match) {
      results.push({
        unlinkedId: row.id,
        participantName: row.participant_name,
        studentId: match.studentId,
        studentName: match.studentName,
        confidence: match.confidence,
        similarity: match.similarity || 1,
      })
    } else {
      results.push({
        unlinkedId: row.id,
        participantName: row.participant_name,
        studentId: null,
        studentName: null,
        confidence: null,
        similarity: 0,
      })
    }
  }

  return jsonNoStore({ success: true, results })
}

async function handleLink({ body, auth }) {
  const links = Array.isArray(body?.links) ? body.links : [{ id: body?.id, studentId: body?.studentId }]
  if (!links.length) return jsonNoStore({ error: 'No links provided.' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const validIds = [...new Set(links.map(link => String(link?.id || '').trim()).filter(Boolean))]
  if (!validIds.length) return jsonNoStore({ success: true, linked: 0, skipped: 0, errors: links.length }, { status: 200 })
  const { data: waitingRows, error: waitingError } = await supabase
    .from('unlinked_attendance')
    .select('id,participant_name,batch,attendance_date')
    .in('id', validIds)
    .eq('status', 'waiting')
  if (waitingError) throw waitingError

  const scopeError = await assertUnlinkedScope({ supabase, auth, rows: waitingRows || [] })
  if (scopeError) return scopeError

  const rowById = new Map((waitingRows || []).map(row => [String(row.id), row]))
  const now = new Date().toISOString()
  let linked = 0
  let skipped = 0
  const errors = []

  for (const { id, studentId } of links) {
    if (!id || !studentId) { errors.push({ id, error: 'Missing id or studentId' }); continue }

    const row = rowById.get(String(id))
    if (!row) { skipped++; continue }

    const { data: student } = await supabase
      .from('students').select('id,name,batch').eq('id', studentId).eq('batch', row.batch).single()
    if (!student) { errors.push({ id, error: 'Student not in this batch' }); continue }

    const { error: insertError } = await supabase
      .from('student_attendance')
      .insert({
        student_id: studentId,
        batch: row.batch,
        attendance_date: row.attendance_date,
        status: 'approved',
        marked_at: now,
        reviewed_at: now,
        reviewed_by: auth.name,
        review_note: `Linked from unmatched upload (${row.participant_name})`,
      })

    if (insertError) {
      if (insertError.code === '23505') skipped++
      else { errors.push({ id, error: insertError.message }); continue }
    } else {
      linked++
    }

    await supabase
      .from('unlinked_attendance')
      .update({ status: 'linked', linked_student_id: studentId, linked_at: now })
      .eq('id', id)
  }

  return jsonNoStore({ success: true, linked, skipped, errors: errors.length })
}

async function handleDismiss({ body, auth }) {
  const ids = Array.isArray(body?.ids) ? body.ids : [body?.id]
  const validIds = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))]
  if (!validIds.length) return jsonNoStore({ error: 'No IDs provided.' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data: waitingRows, error: waitingError } = await supabase
    .from('unlinked_attendance')
    .select('id,batch')
    .in('id', validIds)
    .eq('status', 'waiting')
  if (waitingError) throw waitingError

  const scopeError = await assertUnlinkedScope({ supabase, auth, rows: waitingRows || [] })
  if (scopeError) return scopeError

  const { data, error } = await supabase
    .from('unlinked_attendance')
    .update({ status: 'dismissed' })
    .in('id', validIds)
    .eq('status', 'waiting')
    .select('id')
  if (error) throw error

  return jsonNoStore({ success: true, dismissed: data?.length || 0 })
}

async function assertUnlinkedScope({ supabase, auth, rows }) {
  if (auth?.batchFilter !== 'scope') return null

  const scope = await getTeacherScope(supabase, auth.name)
  if (!scope.batchNames.length || rows.some(row => !scope.batchNames.includes(row.batch))) {
    return jsonNoStore({ error: 'Attendance is outside this teacher scope.' }, { status: 403 })
  }

  return null
}
