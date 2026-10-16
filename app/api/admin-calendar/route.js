import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { appendActivity } from '@/lib/activity-log'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { isUniqueViolation, normalizeCalendarPayload, parseIsoDate } from '@/lib/health-card-admin'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

function indiaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function validateBatch(supabase, batch) {
  const { data, error } = await supabase.from('batches').select('name').eq('name', batch).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

function applyFilters(query, request) {
  const params = request.nextUrl.searchParams
  const batch = String(params.get('batch') || '').trim()
  const startDate = parseIsoDate(params.get('startDate'))
  const endDate = parseIsoDate(params.get('endDate'))
  const working = params.get('working')
  if (batch) query = query.eq('batch', batch)
  if (startDate) query = query.gte('calendar_date', startDate)
  if (endDate) query = query.lte('calendar_date', endDate)
  if (working === 'true' || working === 'false') query = query.eq('is_working_day', working === 'true')
  return query
}

export async function GET(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    let query = getSupabaseAdmin()
      .from('batch_calendar_days')
      .select('id,batch,calendar_date,is_working_day,label,created_at,updated_at')
      .order('calendar_date', { ascending: false })
      .limit(1000)
    query = applyFilters(query, request)
    const { data, error } = await query
    if (error) throw error
    return jsonNoStore({ success: true, calendar: data || [], today: indiaDate() })
  } catch (error) {
    console.error('[admin-calendar] list failed', error?.message)
    return jsonNoStore({ error: 'Could not load working calendar.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const normalized = normalizeCalendarPayload(body)
    if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
    const supabase = getSupabaseAdmin()
    if (!(await validateBatch(supabase, normalized.value.batch))) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
    const { data, error } = await supabase
      .from('batch_calendar_days')
      .insert(normalized.value)
      .select('id,batch,calendar_date,is_working_day,label,created_at,updated_at')
      .single()
    if (error) {
      if (isUniqueViolation(error)) return jsonNoStore({ error: 'That batch date already exists.' }, { status: 409 })
      throw error
    }
    await appendActivity({
      eventType: 'health_calendar_day_created',
      description: `created ${data.is_working_day ? 'working day' : 'non-working day'} ${data.calendar_date} for ${data.batch}`,
      actorName: admin.name,
      actorRole: 'admin',
      action: 'create',
      metadata: { calendar_day_id: data.id, batch: data.batch, calendar_date: data.calendar_date, is_working_day: data.is_working_day },
      supabase,
    })
    return jsonNoStore({ success: true, calendarDay: data }, { status: 201 })
  } catch (error) {
    console.error('[admin-calendar] create failed', error?.message)
    return jsonNoStore({ error: 'Could not create calendar day.' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const id = String(body.id || body.calendarDayId || '').trim()
    if (!id) return jsonNoStore({ error: 'Calendar day id is required.' }, { status: 400 })
    const normalized = normalizeCalendarPayload(body, { partial: true })
    if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
    const supabase = getSupabaseAdmin()
    if (Object.prototype.hasOwnProperty.call(normalized.value, 'batch') && !(await validateBatch(supabase, normalized.value.batch))) {
      return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('batch_calendar_days')
      .update({ ...normalized.value, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,batch,calendar_date,is_working_day,label,created_at,updated_at')
      .maybeSingle()
    if (error) {
      if (isUniqueViolation(error)) return jsonNoStore({ error: 'That batch date already exists.' }, { status: 409 })
      throw error
    }
    if (!data) return jsonNoStore({ error: 'Calendar day not found.' }, { status: 404 })
    await appendActivity({
      eventType: 'health_calendar_day_updated',
      description: `updated calendar day ${data.calendar_date} for ${data.batch}`,
      actorName: admin.name,
      actorRole: 'admin',
      action: 'update',
      metadata: { calendar_day_id: data.id, batch: data.batch, calendar_date: data.calendar_date, is_working_day: data.is_working_day },
      supabase,
    })
    return jsonNoStore({ success: true, calendarDay: data })
  } catch (error) {
    console.error('[admin-calendar] update failed', error?.message)
    return jsonNoStore({ error: 'Could not update calendar day.' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const id = String(body.id || body.calendarDayId || '').trim()
    if (!id) return jsonNoStore({ error: 'Calendar day id is required.' }, { status: 400 })
    const supabase = getSupabaseAdmin()
    const { data: day, error: dayError } = await supabase.from('batch_calendar_days').select('id,batch,calendar_date').eq('id', id).maybeSingle()
    if (dayError) throw dayError
    if (!day) return jsonNoStore({ error: 'Calendar day not found.' }, { status: 404 })
    if (day.calendar_date <= indiaDate()) return jsonNoStore({ error: 'Only future calendar days can be removed.' }, { status: 409 })
    const { count, error: attendanceError } = await supabase
      .from('student_attendance')
      .select('id', { count: 'exact', head: true })
      .eq('batch', day.batch)
      .eq('attendance_date', day.calendar_date)
    if (attendanceError) throw attendanceError
    if ((count || 0) > 0) return jsonNoStore({ error: 'This day has attendance and cannot be removed.' }, { status: 409 })
    const { error } = await supabase.from('batch_calendar_days').delete().eq('id', id)
    if (error) throw error
    await appendActivity({
      eventType: 'health_calendar_day_removed',
      description: `removed unused future calendar day ${day.calendar_date} for ${day.batch}`,
      actorName: admin.name,
      actorRole: 'admin',
      action: 'remove',
      metadata: { calendar_day_id: day.id, batch: day.batch, calendar_date: day.calendar_date },
      supabase,
    })
    return jsonNoStore({ success: true })
  } catch (error) {
    console.error('[admin-calendar] remove failed', error?.message)
    return jsonNoStore({ error: 'Could not remove calendar day.' }, { status: 500 })
  }
}
