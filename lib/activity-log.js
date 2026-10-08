import { getSupabaseAdmin } from '@/lib/supabase-server'

export const ACTIVITY_RETENTION_DAYS = 30
export const RECENT_ACTIVITY_LIMIT = 20

const ALLOWED_ROLES = new Set(['teacher', 'admin', 'system'])

export async function appendActivity({
  eventType,
  description,
  actorName,
  actorRole,
  action = null,
  reason = null,
  metadata = {},
  required = false,
  supabase = getSupabaseAdmin(),
}) {
  if (!eventType || !description || !actorName || !ALLOWED_ROLES.has(actorRole)) return

  try {
    const payload = {
      event_type: String(eventType),
      description: String(description),
      actor_name: String(actorName),
      actor_role: actorRole,
      action: action ? String(action) : String(eventType),
      reason: reason ? String(reason) : null,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    }
    let { error } = await supabase.from('activity_log').insert(payload)

    // Keep the core activity log usable when the optional audit columns have
    // not been deployed yet. The later migration adds these fields.
    if (error && /column .*does not exist|schema cache/i.test(error.message || '')) {
      const { action: _action, reason: _reason, metadata: _metadata, ...corePayload } = payload
      ;({ error } = await supabase.from('activity_log').insert(corePayload))
    }

    if (error) {
      console.error('[activity-log] append failed', error.message)
      if (required) throw new Error(error.message)
    }
  } catch (err) {
    console.error('[activity-log] append failed', err?.message)
    if (required) throw err
  }
}

export async function loadRecentActivity({
  limit = RECENT_ACTIVITY_LIMIT,
  filters = {},
  supabase = getSupabaseAdmin(),
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || RECENT_ACTIVITY_LIMIT, 1), 500)
  let query = supabase
    .from('activity_log')
    .select('id, event_type, description, actor_name, actor_role, action, reason, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  if (filters.date) {
    const start = new Date(`${filters.date}T00:00:00.000Z`)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)
    query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
  }
  if (filters.actor) query = query.ilike('actor_name', `%${escapeLike(filters.actor)}%`)
  if (filters.role) query = query.eq('actor_role', filters.role)
  if (filters.search) {
    const search = escapeLike(filters.search)
    query = query.or(`description.ilike.%${search}%,event_type.ilike.%${search}%,actor_name.ilike.%${search}%`)
  }

  const result = await query
  if (!result.error) return result.data || []

  // The activity log was originally created with only the core fields. Fall
  // back so older deployments still show operational history.
  if (/column .*does not exist|schema cache/i.test(result.error.message || '')) {
    let coreQuery = supabase
      .from('activity_log')
      .select('id, event_type, description, actor_name, actor_role, created_at')
      .order('created_at', { ascending: false })
      .limit(safeLimit)
    if (filters.date) {
      const start = new Date(`${filters.date}T00:00:00.000Z`)
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 1)
      coreQuery = coreQuery.gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
    }
    if (filters.actor) coreQuery = coreQuery.ilike('actor_name', `%${escapeLike(filters.actor)}%`)
    if (filters.role) coreQuery = coreQuery.eq('actor_role', filters.role)
    if (filters.search) {
      const search = escapeLike(filters.search)
      coreQuery = coreQuery.or(`description.ilike.%${search}%,event_type.ilike.%${search}%,actor_name.ilike.%${search}%`)
    }
    const fallback = await coreQuery
    if (!fallback.error) return fallback.data || []
  }
  throw new Error(result.error.message)
}

export async function loadActivityTimelines({
  limit = 100,
  supabase = getSupabaseAdmin(),
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const result = await supabase
    .from('submissions')
    .select('id, student_name, topic, batch, phase, submitted_at, ai_feedback_at, feedback_at, reviewed_at, feedback_by, ai_status, ai_model, ai_evaluation')
    .order('submitted_at', { ascending: false })
    .limit(safeLimit)
  if (!result.error) return result.data || []

  // reviewed_at is not present in older portal schemas; feedback_at is the
  // available publication timestamp there, so keep timelines readable.
  if (/column .*reviewed_at.*does not exist|schema cache/i.test(result.error.message || '')) {
    const fallback = await supabase
      .from('submissions')
      .select('id, student_name, topic, batch, phase, submitted_at, ai_feedback_at, feedback_at, feedback_by, ai_status, ai_model, ai_evaluation')
      .order('submitted_at', { ascending: false })
      .limit(safeLimit)
    if (!fallback.error) return (fallback.data || []).map(row => ({ ...row, reviewed_at: null }))
  }
  throw new Error(result.error.message)
}

function escapeLike(value) {
  return String(value || '').replace(/[%_]/g, '')
}

export async function pruneOldActivity(supabase = getSupabaseAdmin()) {
  const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('activity_log').delete().lt('created_at', cutoff)
  if (error) console.error('[activity-log] prune failed', error.message)
}
