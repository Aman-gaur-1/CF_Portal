import { getSupabaseAdmin } from '@/lib/supabase-server'

export const ACTIVITY_RETENTION_DAYS = 30
export const RECENT_ACTIVITY_LIMIT = 20

const ALLOWED_ROLES = new Set(['teacher', 'admin', 'system'])

export async function appendActivity({
  eventType,
  description,
  actorName,
  actorRole,
  supabase = getSupabaseAdmin(),
}) {
  if (!eventType || !description || !actorName || !ALLOWED_ROLES.has(actorRole)) return

  try {
    const { error } = await supabase.from('activity_log').insert({
      event_type: String(eventType),
      description: String(description),
      actor_name: String(actorName),
      actor_role: actorRole,
    })

    if (error) console.error('[activity-log] append failed', error.message)
  } catch (err) {
    console.error('[activity-log] append failed', err?.message)
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
    .select('id, event_type, description, actor_name, actor_role, created_at')
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

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

export async function loadActivityTimelines({
  limit = 100,
  supabase = getSupabaseAdmin(),
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const { data, error } = await supabase
    .from('submissions')
    .select('id, student_name, topic, batch, phase, submitted_at, ai_feedback_at, feedback_at, reviewed_at, feedback_by, ai_status, ai_model, ai_evaluation')
    .order('submitted_at', { ascending: false })
    .limit(safeLimit)
  if (error) throw new Error(error.message)
  return data || []
}

function escapeLike(value) {
  return String(value || '').replace(/[%_]/g, '')
}

export async function pruneOldActivity(supabase = getSupabaseAdmin()) {
  const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('activity_log').delete().lt('created_at', cutoff)
  if (error) console.error('[activity-log] prune failed', error.message)
}
