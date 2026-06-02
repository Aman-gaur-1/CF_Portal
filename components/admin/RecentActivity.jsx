"use client"
import { useCallback, useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"

function relativeTime(value) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return "recently"
  const seconds = Math.max(Math.round((Date.now() - timestamp) / 1000), 0)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export default function RecentActivity({ adminToken, refreshKey = 0 }) {
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!adminToken) return
    try {
      const res = await fetch("/api/admin-activity", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load activity.")
      setActivity(data.activity || [])
    } catch (err) {
      console.warn("[recent-activity] load failed", err.message)
    } finally {
      setLoading(false)
    }
  }, [adminToken])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  return (
    <div className="card admin-panel">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold">Recent Activity</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Recent operational history</p>
        </div>
        <button className="btn btn-secondary btn-xs" onClick={load}>Refresh</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-5"><Spinner size="sm" /></div>
      ) : activity.length === 0 ? (
        <p className="text-sm py-3" style={{ color: "var(--text-secondary)" }}>No recent activity yet.</p>
      ) : (
        <div className="recent-activity-list">
          {activity.map(item => (
            <div className="recent-activity-row" key={item.id}>
              <p className="text-sm">
                <b>{item.actor_name}</b> {item.description}
                <span style={{ color: "var(--text-muted)" }}> {" \u2022 "} {relativeTime(item.created_at)}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
