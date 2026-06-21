"use client"
import { useEffect } from "react"

export function moatAuthHeaders(token, includeJson = false) {
  return includeJson
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { Authorization: `Bearer ${token}` }
}

export function buildMoatQuery(filters) {
  const params = new URLSearchParams()
  Object.entries(filters || {}).forEach(([key, value]) => {
    const normalized = String(value || "").trim()
    if (normalized && normalized !== "all") params.set(key, normalized)
  })
  return params.toString()
}

export function MoatKpiCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-num">{value}</p>
      {hint && <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  )
}

export function moatBadgeClass(value) {
  if (["Critical", "High", "failed", "error", "inactive"].includes(value)) return "badge-failed"
  if (["Medium", "queued", "running", "pending", "disabled"].includes(value)) return "badge-pending"
  return "badge-done"
}

export function MoatStatusBadge({ value, children }) {
  return <span className={moatBadgeClass(value)}>{children || value}</span>
}

export function MoatDrawer({ open, title, eyebrow, label, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="moat-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="moat-drawer" role="dialog" aria-modal="true" aria-label={label || title || "Moat details"} onClick={event => event.stopPropagation()}>
        <div className="moat-drawer-header">
          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{eyebrow}</p>}
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </aside>
    </div>
  )
}
