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
  supabase = getSupabaseAdmin(),
} = {}) {
  await pruneOldActivity(supabase)
  const safeLimit = Math.min(Math.max(Number(limit) || RECENT_ACTIVITY_LIMIT, 1), 50)
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, event_type, description, actor_name, actor_role, created_at')
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  if (error) throw new Error(error.message)
  return data || []
}

async function pruneOldActivity(supabase) {
  const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('activity_log').delete().lt('created_at', cutoff)
  if (error) console.error('[activity-log] prune failed', error.message)
}
