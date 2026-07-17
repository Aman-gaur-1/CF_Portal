import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getSetting, setSetting, getNumber } from '@/lib/system-settings'

export const NOTIFICATION_USER_TYPE = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  ADMIN: 'admin',
}

export const NOTIFICATION_TYPE = {
  FEEDBACK_PUBLISHED: 'feedback_published',
  TRAINER_RESPONDED_TO_QUERY: 'trainer_responded_to_query',
  QUERY_RESOLVED: 'query_resolved',
  NEW_STUDENT_QUERY: 'new_student_query',
  QUERY_REOPENED: 'query_reopened',
  HIGH_PRIORITY_QUERY: 'high_priority_query',
  QUERIES_PENDING_24H: 'queries_pending_24h',
  QUERIES_PENDING_48H: 'queries_pending_48h',
  DAILY_SUMMARY: 'daily_summary',
}

const RECENT_LIMIT = 30
const DEFAULT_RETENTION_DAYS = 30

export const NOTIFICATION_PREFERENCE = {
  FEEDBACK_PUBLISHED: 'feedback_published',
  STUDENT_QUERIES: 'student_queries',
  QUERY_RESOLVED: 'query_resolved',
  ADMIN_ALERTS: 'admin_alerts',
}

const DEFAULT_PREFERENCES = {
  [NOTIFICATION_PREFERENCE.FEEDBACK_PUBLISHED]: true,
  [NOTIFICATION_PREFERENCE.STUDENT_QUERIES]: true,
  [NOTIFICATION_PREFERENCE.QUERY_RESOLVED]: true,
  [NOTIFICATION_PREFERENCE.ADMIN_ALERTS]: true,
}

const TYPE_PREFERENCE = {
  [NOTIFICATION_TYPE.FEEDBACK_PUBLISHED]: NOTIFICATION_PREFERENCE.FEEDBACK_PUBLISHED,
  [NOTIFICATION_TYPE.TRAINER_RESPONDED_TO_QUERY]: NOTIFICATION_PREFERENCE.QUERY_RESOLVED,
  [NOTIFICATION_TYPE.QUERY_RESOLVED]: NOTIFICATION_PREFERENCE.QUERY_RESOLVED,
  [NOTIFICATION_TYPE.NEW_STUDENT_QUERY]: NOTIFICATION_PREFERENCE.STUDENT_QUERIES,
  [NOTIFICATION_TYPE.QUERY_REOPENED]: NOTIFICATION_PREFERENCE.STUDENT_QUERIES,
  [NOTIFICATION_TYPE.HIGH_PRIORITY_QUERY]: NOTIFICATION_PREFERENCE.STUDENT_QUERIES,
  [NOTIFICATION_TYPE.QUERIES_PENDING_24H]: NOTIFICATION_PREFERENCE.ADMIN_ALERTS,
  [NOTIFICATION_TYPE.QUERIES_PENDING_48H]: NOTIFICATION_PREFERENCE.ADMIN_ALERTS,
  [NOTIFICATION_TYPE.DAILY_SUMMARY]: NOTIFICATION_PREFERENCE.ADMIN_ALERTS,
}

export function normalizeUserIdentifier(value) {
  return String(value || '').trim()
}

export async function getNotificationPreferences({
  userType,
  userIdentifier,
  supabase = getSupabaseAdmin(),
} = {}) {
  const type = normalizeUserIdentifier(userType)
  const identifier = normalizeUserIdentifier(userIdentifier)
  const all = await getSetting('NOTIFICATION_PREFERENCES', {}, { supabase })
  return {
    ...DEFAULT_PREFERENCES,
    ...((all?.[type]?.[identifier]) || {}),
  }
}

export async function setNotificationPreferences({
  userType,
  userIdentifier,
  preferences,
  supabase = getSupabaseAdmin(),
} = {}) {
  const type = normalizeUserIdentifier(userType)
  const identifier = normalizeUserIdentifier(userIdentifier)
  if (!type || !identifier) throw new Error('Notification recipient is required')
  const all = await getSetting('NOTIFICATION_PREFERENCES', {}, { supabase }) || {}
  const current = all?.[type]?.[identifier] || {}
  const next = { ...DEFAULT_PREFERENCES, ...current }
  for (const key of Object.values(NOTIFICATION_PREFERENCE)) {
    if (Object.prototype.hasOwnProperty.call(preferences || {}, key)) next[key] = Boolean(preferences[key])
  }
  const payload = {
    ...all,
    [type]: {
      ...(all[type] || {}),
      [identifier]: next,
    },
  }
  await setSetting('NOTIFICATION_PREFERENCES', payload, 'Per-user notification preferences by user type and identifier.', { supabase })
  return next
}

async function shouldCreateNotification({ userType, userIdentifier, notificationType, supabase }) {
  const preferenceKey = TYPE_PREFERENCE[notificationType]
  if (!preferenceKey) return true
  const preferences = await getNotificationPreferences({ userType, userIdentifier, supabase })
  return preferences[preferenceKey] !== false
}

export async function createNotification({
  userType,
  userIdentifier,
  notificationType,
  title,
  message,
  referenceType = null,
  referenceId = null,
  icon = null,
  severity = 'info',
  actionLabel = null,
  actionUrl = null,
  expiresAt = null,
  pinned = false,
  supabase = getSupabaseAdmin(),
} = {}) {
  if (!(await shouldCreateNotification({ userType, userIdentifier, notificationType, supabase }))) return null
  const payload = {
    user_type: normalizeUserIdentifier(userType),
    user_identifier: normalizeUserIdentifier(userIdentifier),
    notification_type: normalizeUserIdentifier(notificationType),
    title: String(title || '').trim(),
    message: String(message || '').trim(),
    reference_type: referenceType ? String(referenceType) : null,
    reference_id: referenceId === null || referenceId === undefined ? null : String(referenceId),
    icon: icon ? String(icon) : null,
    severity: ['info', 'success', 'warning', 'error'].includes(String(severity)) ? String(severity) : 'info',
    action_label: actionLabel ? String(actionLabel) : null,
    action_url: actionUrl ? String(actionUrl) : null,
    expires_at: expiresAt || null,
    pinned: Boolean(pinned),
  }
  if (!payload.user_type || !payload.user_identifier || !payload.notification_type || !payload.title || !payload.message) return null

  const { data, error } = await supabase
    .from('notifications')
    .upsert(payload, {
      onConflict: 'user_type,user_identifier,notification_type,reference_type,reference_id',
      ignoreDuplicates: true,
    })
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[notifications] create failed', { message: error.message, code: error.code, details: error.details })
    return null
  }
  return data || null
}

export async function pruneExpiredNotifications(supabase = getSupabaseAdmin()) {
  const retentionDays = await getNumber('NOTIFICATION_RETENTION_DAYS', DEFAULT_RETENTION_DAYS, { supabase })
  const safeDays = Math.min(Math.max(Number(retentionDays) || DEFAULT_RETENTION_DAYS, 1), 365)
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
  const { error: explicitError } = await supabase
    .from('notifications')
    .delete()
    .lte('expires_at', now)
    .or('pinned.eq.false,is_read.eq.true')
  if (explicitError) console.error('[notifications] explicit expiry prune failed', explicitError.message)

  const { error } = await supabase
    .from('notifications')
    .delete()
    .lt('created_at', cutoff)
    .or('pinned.eq.false,is_read.eq.true')
  if (error) console.error('[notifications] prune failed', error.message)
}

export async function listNotifications({
  userType,
  userIdentifier,
  limit = RECENT_LIMIT,
  before = null,
  supabase = getSupabaseAdmin(),
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || RECENT_LIMIT, 1), 50)
  const type = normalizeUserIdentifier(userType)
  const identifier = normalizeUserIdentifier(userIdentifier)
  if (!type || !identifier) return { notifications: [], unreadCount: 0 }

  await pruneExpiredNotifications(supabase)

  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_type', type)
    .eq('user_identifier', identifier)
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  if (before) query = query.lt('created_at', before)

  const [{ count, error: countError }, { data, error }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_type', type)
      .eq('user_identifier', identifier)
      .eq('is_read', false),
    query,
  ])

  if (countError) throw new Error(countError.message)
  if (error) throw new Error(error.message)
  const notifications = data || []
  return {
    notifications,
    unreadCount: count || 0,
    hasMore: notifications.length === safeLimit,
  }
}

export async function markNotificationRead({
  userType,
  userIdentifier,
  notificationId,
  all = false,
  supabase = getSupabaseAdmin(),
} = {}) {
  const type = normalizeUserIdentifier(userType)
  const identifier = normalizeUserIdentifier(userIdentifier)
  const now = new Date().toISOString()
  if (!type || !identifier) return []

  let query = supabase
    .from('notifications')
    .update({ is_read: true, read_at: now })
    .eq('user_type', type)
    .eq('user_identifier', identifier)
    .eq('is_read', false)

  if (!all) query = query.eq('id', String(notificationId || '').trim())

  const { data, error } = await query.select('*')
  if (error) throw new Error(error.message)
  return data || []
}

export async function loadNotificationAnalytics({
  userType,
  userIdentifier,
  supabase = getSupabaseAdmin(),
} = {}) {
  const type = normalizeUserIdentifier(userType)
  const identifier = normalizeUserIdentifier(userIdentifier)
  if (!type || !identifier) return null
  const { data, error } = await supabase
    .from('notifications')
    .select('notification_type,is_read,created_at,delivered_at')
    .eq('user_type', type)
    .eq('user_identifier', identifier)
    .limit(500)
  if (error) throw new Error(error.message)
  const rows = data || []
  const byType = {}
  let deliveryTotalMs = 0
  let deliveryCount = 0
  for (const row of rows) {
    byType[row.notification_type] = (byType[row.notification_type] || 0) + 1
    const created = new Date(row.created_at).getTime()
    const delivered = new Date(row.delivered_at || row.created_at).getTime()
    if (Number.isFinite(created) && Number.isFinite(delivered)) {
      deliveryTotalMs += Math.max(delivered - created, 0)
      deliveryCount += 1
    }
  }
  return {
    total: rows.length,
    unread: rows.filter(row => !row.is_read).length,
    byType,
    averageDeliveryMs: deliveryCount ? Math.round(deliveryTotalMs / deliveryCount) : 0,
  }
}

export async function getAdminNotificationRecipients(supabase = getSupabaseAdmin()) {
  const raw = process.env.ADMIN_CREDENTIALS
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.keys(parsed)
    } catch {}
  }

  const { data } = await supabase.from('activity_log').select('actor_name').eq('actor_role', 'admin').limit(20)
  const names = [...new Set((data || []).map(row => row.actor_name).filter(Boolean))]
  return names.length ? names : ['admin']
}
