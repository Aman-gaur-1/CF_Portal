import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { appendActivity } from '@/lib/activity-log'
import { createNotification, NOTIFICATION_TYPE, NOTIFICATION_USER_TYPE } from '@/lib/notifications'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { isSupportedHealthCardPhase, isUniqueViolation, normalizeCourseworkPayload } from '@/lib/health-card-admin'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

function filtersFrom(request) {
  const params = request.nextUrl.searchParams
  const active = params.get('active')
  return {
    batch: String(params.get('batch') || '').trim(),
    itemType: String(params.get('type') || '').trim().toLowerCase(),
    phase: String(params.get('phase') || '').trim(),
    active: active === 'true' || active === 'false' ? active === 'true' : null,
  }
}

async function validateBatch(supabase, batch) {
  if (!batch) return true
  const { data, error } = await supabase.from('batches').select('name').eq('name', batch).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

async function notifyNewCoursework({ supabase, item }) {
  let query = supabase.from('students').select('id,name,batch').eq('status', 'active')
  if (item.batch) query = query.eq('batch', item.batch)
  const { data: students, error } = await query.limit(2000)
  if (error) throw error
  await Promise.all((students || []).map(student => createNotification({
    userType: NOTIFICATION_USER_TYPE.STUDENT,
    userIdentifier: student.id,
    notificationType: NOTIFICATION_TYPE.NEW_COURSEWORK,
    title: 'New Health Card coursework',
    message: `${item.item_type === 'project' ? 'Project' : 'Assignment'}: ${item.title}`,
    referenceType: 'coursework_item',
    referenceId: item.id,
    icon: item.item_type === 'project' ? 'P' : 'A',
    severity: 'info',
    actionLabel: 'View Health Card',
    actionUrl: '/',
    supabase,
  })))
}

export async function GET(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    const filters = filtersFrom(request)
    let query = supabase
      .from('coursework_items')
      .select('id,item_type,title,phase,batch,due_at,active,created_at,updated_at,submissions(count)')
      .order('active', { ascending: false })
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(500)
    if (filters.batch) query = query.eq('batch', filters.batch)
    if (filters.itemType && ['assignment', 'project'].includes(filters.itemType)) query = query.eq('item_type', filters.itemType)
    if (filters.phase) query = query.ilike('phase', `%${filters.phase.replace(/[%_]/g, '')}%`)
    if (filters.active !== null) query = query.eq('active', filters.active)
    const { data, error } = await query
    if (error) throw error
    const items = (data || []).map(item => ({
      ...item,
      linkedSubmissionCount: Number(item.submissions?.[0]?.count || 0),
      submissions: undefined,
    }))
    return jsonNoStore({ success: true, coursework: items, filters })
  } catch (error) {
    console.error('[admin-coursework] list failed', error?.message)
    return jsonNoStore({ error: 'Could not load coursework.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const normalized = normalizeCourseworkPayload(body)
    if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
    const supabase = getSupabaseAdmin()
    if (!(await validateBatch(supabase, normalized.value.batch))) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
    const { data, error } = await supabase
      .from('coursework_items')
      .insert(normalized.value)
      .select('id,item_type,title,phase,batch,due_at,active,created_at,updated_at')
      .single()
    if (error) {
      if (isUniqueViolation(error)) return jsonNoStore({ error: 'Coursework already exists.' }, { status: 409 })
      throw error
    }
    await appendActivity({
      eventType: 'health_coursework_created',
      description: `created ${data.item_type} coursework: ${data.title}`,
      actorName: admin.name,
      actorRole: 'admin',
      action: 'create',
      metadata: { coursework_item_id: data.id, batch: data.batch, item_type: data.item_type },
      supabase,
    })
    try {
      await notifyNewCoursework({ supabase, item: data })
    } catch (notificationError) {
      console.error('[admin-coursework] notification fanout failed', notificationError?.message)
    }
    return jsonNoStore({ success: true, coursework: data }, { status: 201 })
  } catch (error) {
    console.error('[admin-coursework] create failed', error?.message)
    return jsonNoStore({ error: 'Could not create coursework.' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const id = String(body.id || body.courseworkId || '').trim()
    if (!id) return jsonNoStore({ error: 'Coursework id is required.' }, { status: 400 })
    const normalized = normalizeCourseworkPayload(body, { partial: true })
    if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
    const supabase = getSupabaseAdmin()
    if (normalized.value.active === true) {
      const { data: existing, error: existingError } = await supabase.from('coursework_items').select('phase').eq('id', id).maybeSingle()
      if (existingError) throw existingError
      if (!existing || !isSupportedHealthCardPhase(normalized.value.phase ?? existing.phase)) return jsonNoStore({ error: 'Coursework cannot be activated without a valid Python, Data Analytics, or SQL phase.' }, { status: 400 })
    }
    if (Object.prototype.hasOwnProperty.call(normalized.value, 'batch') && !(await validateBatch(supabase, normalized.value.batch))) {
      return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('coursework_items')
      .update({ ...normalized.value, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,item_type,title,phase,batch,due_at,active,created_at,updated_at')
      .maybeSingle()
    if (error) throw error
    if (!data) return jsonNoStore({ error: 'Coursework not found.' }, { status: 404 })
    const action = Object.prototype.hasOwnProperty.call(normalized.value, 'active')
      ? (normalized.value.active ? 'reactivate' : 'deactivate')
      : 'update'
    const eventType = action === 'reactivate'
      ? 'health_coursework_reactivated'
      : action === 'deactivate'
        ? 'health_coursework_deactivated'
        : 'health_coursework_updated'
    const actionDescription = action === 'reactivate' ? 'reactivated' : `${action}d`
    await appendActivity({
      eventType,
      description: `${actionDescription} coursework: ${data.title}`,
      actorName: admin.name,
      actorRole: 'admin',
      action,
      metadata: { coursework_item_id: data.id, batch: data.batch, active: data.active },
      supabase,
    })
    return jsonNoStore({ success: true, coursework: data })
  } catch (error) {
    console.error('[admin-coursework] update failed', error?.message)
    return jsonNoStore({ error: 'Could not update coursework.' }, { status: 500 })
  }
}

export async function DELETE(request) {
  const admin = getAdminFromRequest(request)
  if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
  return jsonNoStore({ error: 'Coursework is archived by setting active=false; hard delete is disabled.' }, { status: 409 })
}
