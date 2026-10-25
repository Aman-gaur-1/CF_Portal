import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { appendActivity } from '@/lib/activity-log'
import { matchParticipantName } from '@/lib/attendance-matching'
import { buildMatchFields, linkUnlinkedAttendance, loadBatchAliases } from '@/lib/attendance-domain'

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
      .select('id,participant_name,original_participant_name,normalized_participant_name,corrected_display_name,batch,attendance_date,uploaded_by_role,uploaded_by_name,status,linked_student_id,linked_at,created_at,import_id,session_id,suggested_student_id,match_score,match_type,match_reason,resolved_by_role,resolved_by_name,resolved_at')
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
    .select('*')
    .in('id', validIds)
    .eq('status', 'waiting')
  if (error) throw error
  if (!unlinked?.length) return jsonNoStore({ error: 'No waiting records found.' }, { status: 404 })

  const scopeError = await assertUnlinkedScope({ supabase, auth, rows: unlinked })
  if (scopeError) return scopeError

  const batches = [...new Set(unlinked.map(u => u.batch))]
  const { data: students, error: studentError } = await supabase
    .from('students').select('id,name,batch').in('batch', batches).eq('status', 'active')
  if (studentError) throw studentError

  const aliasesByBatch = new Map()
  for (const batch of batches) aliasesByBatch.set(batch, await loadBatchAliases(supabase, batch))

  const results = []
  for (const row of unlinked) {
    const match = matchParticipantName({
      participantName: row.original_participant_name || row.participant_name,
      students: (students || []).filter(s => s.batch === row.batch),
      aliases: aliasesByBatch.get(row.batch) || [],
    })
    const { error: updateError } = await supabase.from('unlinked_attendance').update(buildMatchFields(match)).eq('id', row.id).eq('status', 'waiting')
    if (updateError) throw updateError
    results.push({
      unlinkedId: row.id,
      participantName: row.original_participant_name || row.participant_name,
      studentId: match.student?.id || null,
      studentName: match.student?.name || null,
      matchType: match.type,
      confidence: match.type,
      similarity: match.score || 0,
      reason: match.reason,
      candidates: match.candidates || [],
    })
  }

  await appendActivity({
    eventType: 'attendance_participants_rematched',
    description: `re-matched ${results.length} unmatched attendance participant${results.length === 1 ? '' : 's'}`,
    actorName: auth.name,
    actorRole: auth.role,
    action: 'rematch',
    metadata: {
      ids: results.map(result => result.unlinkedId),
      matched_count: results.filter(result => result.studentId).length,
      batch_count: batches.length,
    },
    supabase,
  })

  return jsonNoStore({ success: true, results })
}

async function handleLink({ body, auth }) {
  const links = Array.isArray(body?.links) ? body.links : [{
    id: body?.id,
    studentId: body?.studentId,
    correctedDisplayName: body?.correctedDisplayName,
    rememberAlias: body?.rememberAlias,
  }]
  if (!links.length) return jsonNoStore({ error: 'No links provided.' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const validIds = [...new Set(links.map(link => String(link?.id || '').trim()).filter(Boolean))]
  if (!validIds.length) return jsonNoStore({ success: true, linked: 0, skipped: 0, errors: links.length }, { status: 200 })
  const { data: waitingRows, error: waitingError } = await supabase
    .from('unlinked_attendance')
    .select('*')
    .in('id', validIds)
    .eq('status', 'waiting')
  if (waitingError) throw waitingError

  const scopeError = await assertUnlinkedScope({ supabase, auth, rows: waitingRows || [] })
  if (scopeError) return scopeError

  const rowById = new Map((waitingRows || []).map(row => [String(row.id), row]))
  let linked = 0
  let skipped = 0
  const errors = []

  for (const link of links) {
    const { id, studentId } = link
    if (!id || !studentId) { errors.push({ id, error: 'Missing id or studentId' }); continue }

    const row = rowById.get(String(id))
    if (!row) { skipped++; continue }

    const { data: student } = await supabase
      .from('students').select('id,name,batch').eq('id', studentId).eq('batch', row.batch).eq('status', 'active').single()
    if (!student) { errors.push({ id, error: 'Student not in this batch' }); continue }
    try {
      const result = await linkUnlinkedAttendance({
        supabase,
        row,
        student,
        actor: auth,
        correctedDisplayName: link.correctedDisplayName,
        rememberAlias: Boolean(link.rememberAlias),
      })
      if (result.created) linked++
      else skipped++
      await appendActivity({
        eventType: 'attendance_participant_resolved',
        description: `resolved unmatched participant ${row.original_participant_name || row.participant_name}`,
        actorName: auth.name,
        actorRole: auth.role,
        action: 'resolve',
        metadata: { unlinked_id: id, student_id: studentId, batch: row.batch, alias_created: result.aliasRemembered },
        supabase,
      })
    } catch (error) {
      errors.push({ id, error: error.message || 'Could not link attendance.' })
    }
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

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('unlinked_attendance')
    .update({ status: 'dismissed', resolved_by_role: auth.role, resolved_by_name: auth.name, resolved_at: now })
    .in('id', validIds)
    .eq('status', 'waiting')
    .select('id')
  if (error) throw error

  if (data?.length) {
    await appendActivity({
      eventType: 'attendance_participant_dismissed',
      description: `dismissed ${data.length} unmatched attendance participant${data.length === 1 ? '' : 's'}`,
      actorName: auth.name,
      actorRole: auth.role,
      action: 'dismiss',
      metadata: { ids: data.map(row => row.id) },
      supabase,
    })
  }

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
