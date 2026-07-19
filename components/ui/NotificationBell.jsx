"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"

const ROLE_PREFERENCES = {
  student: [
    ["feedback_published", "Feedback Published"],
    ["query_resolved", "Query Response"],
    ["query_resolved", "Query Resolved"],
  ],
  teacher: [
    ["student_queries", "New Student Query"],
    ["student_queries", "High Priority Query"],
    ["student_queries", "Query Reopened"],
  ],
  admin: [
    ["student_queries", "New Student Query"],
    ["admin_alerts", "Pending >24h"],
    ["admin_alerts", "Pending >48h"],
    ["admin_alerts", "System Alerts"],
  ],
}

function timeAgo(value) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ""
  const seconds = Math.max(Math.floor((Date.now() - time) / 1000), 0)
  if (seconds < 60) return "now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function iconFor(item) {
  if (item.icon) return item.icon
  if (String(item.notification_type).includes("query")) return "?"
  if (String(item.notification_type).includes("feedback")) return "F"
  return "!"
}

function targetFor(notification, userType) {
  if (userType === "teacher" && notification.reference_type === "query") return "/teacher?tab=reviews&filter=open-queries"
  if (notification.action_url) return notification.action_url
  if (userType === "student") return "/?tab=feedback"
  if (userType === "teacher") return "/teacher?tab=reviews"
  if (userType === "admin") return notification.reference_type === "query" ? "/admin?tab=queries" : "/admin"
  return null
}

function averageDeliveryLabel(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return "Immediate"
  if (ms < 1000) return `${ms}ms`
  return `${Math.round(ms / 1000)}s`
}

function decodeTokenName(token) {
  try {
    const encoded = String(token || "").split(".")[0]
    if (!encoded) return ""
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=")
    return JSON.parse(atob(padded))?.name || ""
  } catch {
    return ""
  }
}

export default function NotificationBell({ userType, authToken, student }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [preferences, setPreferences] = useState({})
  const [analytics, setAnalytics] = useState(null)
  const [realtimeReady, setRealtimeReady] = useState(false)
  const channelRef = useRef(null)
  const itemsRef = useRef([])
  const panelRef = useRef(null)

  const requestInfo = useMemo(() => {
    const params = new URLSearchParams({ userType })
    const headers = {}
    if (authToken) headers.Authorization = `Bearer ${authToken}`
    if (userType === "student" && student) {
      if (student.token) headers.Authorization = `Bearer ${student.token}`
    }
    return { params, headers }
  }, [authToken, student, userType])

  const visiblePreferences = useMemo(() => ROLE_PREFERENCES[userType] || [], [userType])

  const loadNotifications = useCallback(async ({ append = false } = {}) => {
    const params = new URLSearchParams(requestInfo.params)
    params.set("limit", "20")
    const currentItems = itemsRef.current
    if (append && currentItems.length) params.set("before", currentItems[currentItems.length - 1].created_at)
    const res = await fetch(`/api/notifications?${params}`, {
      headers: requestInfo.headers,
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "Could not load notifications.")
    setItems(prev => {
      const next = append ? [...prev, ...(data.notifications || [])] : (data.notifications || [])
      itemsRef.current = next
      return next
    })
    setUnreadCount(data.unreadCount || 0)
    setHasMore(Boolean(data.hasMore))
    setPreferences(data.preferences || {})
    setAnalytics(data.analytics || null)
  }, [requestInfo])

  useEffect(() => {
    loadNotifications().catch(() => {})
  }, [loadNotifications])

  useEffect(() => {
    function handleRefresh() {
      loadNotifications().catch(() => {})
    }
    window.addEventListener("notifications:refresh", handleRefresh)
    return () => window.removeEventListener("notifications:refresh", handleRefresh)
  }, [loadNotifications])

  useEffect(() => {
    function handleClick(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  useEffect(() => {
    if (!userType) return
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    const identifier = userType === "student" ? student?.id : decodeTokenName(authToken)
    if (!identifier) return
    const channel = supabase
      .channel(`notifications-${userType}-${String(identifier).slice(0, 16)}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_identifier=eq.${identifier}`,
      }, () => {
        loadNotifications().catch(() => {})
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") setRealtimeReady(true)
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeReady(false)
      })
    channelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
      if (channelRef.current === channel) channelRef.current = null
    }
  }, [authToken, loadNotifications, student?.id, userType])

  useAdaptivePolling(
    () => loadNotifications().catch(() => {}),
    { enabled: true, activeMs: realtimeReady ? 120000 : 30000, hiddenMs: realtimeReady ? 300000 : 60000 }
  )

  async function patchNotifications(body) {
    return fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...requestInfo.headers },
      body: JSON.stringify({
        userType,
        ...body,
      }),
    })
  }

  async function markRead(notification, navigate = false) {
    await patchNotifications({ notificationId: notification.id }).catch(() => {})
    setItems(prev => prev.map(item => item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item))
    itemsRef.current = itemsRef.current.map(item => item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item)
    setUnreadCount(count => Math.max(count - (notification.is_read ? 0 : 1), 0))
    if (navigate) {
      const target = targetFor(notification, userType)
      if (target) window.location.href = target
    }
  }

  async function markAllRead() {
    await patchNotifications({ action: "mark_all_read" }).catch(() => {})
    setItems(prev => prev.map(item => ({ ...item, is_read: true, read_at: item.read_at || new Date().toISOString() })))
    itemsRef.current = itemsRef.current.map(item => ({ ...item, is_read: true, read_at: item.read_at || new Date().toISOString() }))
    setUnreadCount(0)
  }

  async function updatePreference(key, value) {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    await patchNotifications({ action: "update_preferences", preferences: next }).catch(() => {})
  }

  return (
    <div className="notification-wrap" ref={panelRef}>
      <button className="notification-bell" type="button" onClick={() => setOpen(value => !value)} aria-label="Notifications">
        <span aria-hidden>!</span>
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <p className="font-semibold">Notifications</p>
            <button className="text-xs font-semibold" type="button" onClick={markAllRead} disabled={!unreadCount}>Mark all read</button>
          </div>
          {userType === "admin" && analytics && (
            <div className="notification-analytics">
              <span>Total {analytics.total || 0}</span>
              <span>Unread {analytics.unread || 0}</span>
              <span>Avg {averageDeliveryLabel(analytics.averageDeliveryMs)}</span>
            </div>
          )}
          <div className="notification-preferences">
            {visiblePreferences.map(([key, label]) => (
              <label key={`${key}-${label}`}>
                <input type="checkbox" checked={preferences[key] !== false} onChange={event => updatePreference(key, event.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          {userType === "admin" && analytics?.byType && (
            <div className="notification-type-summary">
              {Object.entries(analytics.byType).slice(0, 4).map(([type, count]) => <span key={type}>{type}: {count}</span>)}
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm p-4" style={{ color: "var(--text-secondary)" }}>No notifications yet.</p>
          ) : (
            <div className="notification-list">
              {items.map(item => (
                <button key={item.id} type="button" className={item.is_read ? `notification-item severity-${item.severity || 'info'}` : `notification-item notification-unread severity-${item.severity || 'info'}`} onClick={() => markRead(item, true)}>
                  <span className="notification-icon">{iconFor(item)}</span>
                  <span className="min-w-0">
                    <span className="notification-title">{item.title}{item.pinned && !item.is_read ? " - Pinned" : ""}</span>
                    <span className="notification-message">{item.message}</span>
                    <span className="notification-time">{timeAgo(item.created_at)}{item.action_label ? ` - ${item.action_label}` : ""}</span>
                  </span>
                </button>
              ))}
              {hasMore && <button className="notification-load-more" type="button" onClick={() => loadNotifications({ append: true }).catch(() => {})}>Load older</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
