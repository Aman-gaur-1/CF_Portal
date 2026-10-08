"use client"
import { useEffect, useMemo, useState } from "react"
import EmptyState from "@/components/ui/EmptyState"
import LoadingSkeleton from "@/components/ui/LoadingSkeleton"
import RefreshButton from "@/components/ui/RefreshButton"
import { useRefreshAction } from "@/lib/use-refresh-action"

const CATEGORY_OPTIONS = ["All", "AI Events", "Workflow Events", "Provider Events", "Admin Events", "Authentication"]
const STATUS_OPTIONS = ["All", "Succeeded", "Failed", "Warning"]
const QUICK_DATES = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "Custom"]

function categoryFor(eventType = "") {
  if (/ai_draft|bulk_ai/.test(eventType)) return "AI Events"
  if (/fallback|provider|test/.test(eventType)) return "Provider Events"
  if (/approved|feedback|workflow|published/.test(eventType)) return "Workflow Events"
  if (/login|logout|auth/.test(eventType)) return "Authentication"
  return "Admin Events"
}

function statusFor(eventType = "", description = "") {
  const text = `${eventType} ${description}`.toLowerCase()
  if (/failed|error|timeout/.test(text)) return "Failed"
  if (/fallback|deactivated|deleted|warning/.test(text)) return "Warning"
  return "Succeeded"
}

function iconFor(eventType = "", status = "") {
  const text = eventType.toLowerCase()
  if (status === "Failed") return "❌"
  if (status === "Warning") return "🟡"
  if (/regenerated|retry|retried/.test(text)) return "🔁"
  if (/ai_draft_generated/.test(text)) return "🤖"
  if (/approved/.test(text)) return "✅"
  if (/published|feedback/.test(text)) return "🚀"
  if (/settings|phase|workflow/.test(text)) return "⚙"
  if (/login/.test(text)) return "🔑"
  if (/logout/.test(text)) return "🚪"
  if (/student|teacher/.test(text)) return "👤"
  return "•"
}

function toneFor(status = "") {
  if (status === "Failed") return "failure"
  if (status === "Warning") return "warning"
  if (status === "Succeeded") return "success"
  return "info"
}

function titleFor(eventType = "") {
  return String(eventType || "activity").replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase())
}

function formatDateTime(value) {
  if (!value) return "Not Available"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not Available"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--"
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function dayLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown"
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
}

function extractTopic(description = "") {
  const match = String(description).match(/\b(?:for|approved|submitted manual feedback for|auto approved)\s+(.+)$/i)
  return match?.[1]?.trim().toLowerCase() || ""
}

function timelineFor(activity, timelines = []) {
  const topic = extractTopic(activity?.description)
  if (!topic) return null
  return timelines.find(row => String(row.topic || "").trim().toLowerCase() === topic) || null
}

function providerFrom(row) {
  return row?.ai_evaluation?.diagnostics?.ai_provider || {}
}

function modelFrom(row) {
  return row?.ai_model || providerFrom(row).model || ""
}

function enrichActivity(item, timelines) {
  const row = timelineFor(item, timelines)
  const provider = providerFrom(row)
  const status = statusFor(item.event_type, item.description)
  return {
    ...item,
    category: categoryFor(item.event_type),
    status,
    icon: iconFor(item.event_type, status),
    tone: toneFor(status),
    title: titleFor(item.event_type),
    timeline: row,
    student: row?.student_name || "",
    assignment: row?.topic || extractTopic(item.description),
    trainer: row?.feedback_by || "",
    batch: row?.batch || "",
    phase: row?.phase || "",
    provider: provider.final_provider_used || provider.provider || "",
    model: modelFrom(row),
  }
}

function isWithinQuickDate(value, quickDate, customDate) {
  if (!quickDate || quickDate === "Custom") {
    if (!customDate) return true
    return new Date(value).toDateString() === new Date(`${customDate}T00:00:00`).toDateString()
  }
  const eventTime = new Date(value).getTime()
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (quickDate === "Today") return eventTime >= start.getTime()
  if (quickDate === "Yesterday") {
    const yesterday = new Date(start)
    yesterday.setDate(start.getDate() - 1)
    return eventTime >= yesterday.getTime() && eventTime < start.getTime()
  }
  if (quickDate === "Last 7 Days") return eventTime >= Date.now() - 7 * 24 * 60 * 60 * 1000
  if (quickDate === "Last 30 Days") return eventTime >= Date.now() - 30 * 24 * 60 * 60 * 1000
  return true
}

function fieldButton(label, value, onClick) {
  if (!value) return null
  return (
    <button className="activity-entity" type="button" onClick={event => { event.stopPropagation(); onClick(value) }}>
      {label}: {value}
    </button>
  )
}

function Timeline({ row }) {
  if (!row) return <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Timeline is not linked to a submission yet.</p>
  const steps = [
    ["Submission", row.submitted_at, "info"],
    ["AI Generated", row.ai_feedback_at, row.ai_status === "failed" ? "failure" : "success"],
    ["Trainer Edited", row.feedback_at && row.feedback_by ? row.feedback_at : null, "info"],
    ["Published", row.feedback_at || row.reviewed_at, "success"],
    ["Student Viewed", null, "warning"],
  ]
  return (
    <div className="activity-timeline">
      <p className="font-semibold">{row.student_name || "Student"} - {row.topic || "Assignment"}</p>
      <div className="activity-timeline-steps">
        {steps.map(([label, timestamp, tone]) => (
          <div className={timestamp ? `activity-step is-done tone-${tone}` : "activity-step"} key={label}>
            <span />
            <div>
              <b>{label}</b>
              <p>{timestamp ? formatDateTime(timestamp) : "Not Available"}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminActivityLog({ adminToken, success, showError, globalSearch = "" }) {
  const [activity, setActivity] = useState([])
  const [timelines, setTimelines] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [viewMode, setViewMode] = useState("list")
  const [quickDate, setQuickDate] = useState("Last 30 Days")
  const [filters, setFilters] = useState({
    date: "",
    category: "All",
    actor: "",
    role: "",
    trainer: "",
    student: "",
    assignment: "",
    batch: "",
    phase: "",
    provider: "",
    model: "",
    status: "All",
    search: "",
  })
  useEffect(() => updateFilter("search", globalSearch), [globalSearch])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    const res = await fetch("/api/admin-activity?mode=log", {
      headers: { Authorization: `Bearer ${adminToken}` },
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "Could not load activity log.")
    setActivity(data.activity || [])
    setTimelines(data.timelines || [])
    setLoading(false)
  }

  const refreshAction = useRefreshAction({
    onRefresh: load,
    onSuccess: success,
    onError: showError,
  })

  useEffect(() => {
    load().catch(err => {
      showError(err.message || "Could not load activity log.")
      setLoading(false)
    })
  }, [adminToken])

  const enriched = useMemo(() => activity.map(item => enrichActivity(item, timelines)), [activity, timelines])

  const filtered = useMemo(() => {
    return enriched.filter(item => {
      const searchable = [
        item.description,
        item.event_type,
        item.actor_name,
        item.actor_role,
        item.student,
        item.trainer,
        item.assignment,
        item.provider,
        item.model,
        item.batch,
        item.phase,
        item.status,
        item.category,
      ].join(" ").toLowerCase()
      if (!isWithinQuickDate(item.created_at, quickDate, filters.date)) return false
      if (filters.category !== "All" && item.category !== filters.category) return false
      if (filters.status !== "All" && item.status !== filters.status) return false
      for (const key of ["actor", "role", "trainer", "student", "assignment", "batch", "phase", "provider", "model"]) {
        const filter = String(filters[key] || "").toLowerCase()
        if (filter && !String(key === "actor" ? item.actor_name : key === "role" ? item.actor_role : item[key] || "").toLowerCase().includes(filter)) return false
      }
      if (filters.search && !searchable.includes(filters.search.toLowerCase())) return false
      return true
    })
  }, [enriched, filters, quickDate])

  const grouped = useMemo(() => {
    return filtered.reduce((acc, item) => {
      const label = dayLabel(item.created_at)
      acc[label] ||= []
      acc[label].push(item)
      return acc
    }, {})
  }, [filtered])

  function updateFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  function applyEntityFilter(key, value) {
    updateFilter(key, value)
    success(`Filtered by ${value}.`)
  }

  function exportCsv() {
    const rows = [["Timestamp", "Actor", "Role", "Category", "Action", "Student", "Trainer", "Phase", "Provider", "Model", "Status", "Description"]]
    for (const item of filtered) {
      rows.push([formatDateTime(item.created_at), item.actor_name || "", item.actor_role || "", item.category, item.title, item.student, item.trainer, item.phase, item.provider, item.model, item.status, item.description || ""])
    }
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `cf-activity-log-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function copyValue(label, value) {
    if (!value) return
    navigator.clipboard.writeText(String(value)).then(() => success(`${label} copied.`)).catch(() => showError(`Could not copy ${label}.`))
  }

  return (
    <div className="grid gap-4">
      <div className="card admin-panel activity-filter-panel">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold">Activity Log</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Operational history, timelines, filters, and export.</p>
          </div>
          <div className="queue-actions">
            <div className="admin-segmented" role="tablist" aria-label="Activity view mode">
              <button type="button" className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")} aria-selected={viewMode === "list"}>List</button>
              <button type="button" className={viewMode === "timeline" ? "is-active" : ""} onClick={() => setViewMode("timeline")} aria-selected={viewMode === "timeline"}>Timeline</button>
            </div>
            <RefreshButton onClick={refreshAction.refresh} refreshing={refreshAction.refreshing} updatedLabel={refreshAction.updatedLabel} disabled={loading} />
            <button className="btn btn-secondary btn-sm queue-action-btn" type="button" onClick={exportCsv} disabled={loading || filtered.length === 0}>Export CSV</button>
          </div>
        </div>

        <div className="activity-quick-filters" aria-label="Quick date filters">
          {QUICK_DATES.map(option => (
            <button
              className={quickDate === option ? "activity-chip is-active" : "activity-chip"}
              key={option}
              type="button"
              onClick={() => setQuickDate(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="activity-filters mt-3">
          {quickDate === "Custom" && <input className="input" type="date" value={filters.date} onChange={event => updateFilter("date", event.target.value)} aria-label="Custom date" />}
          <select className="select" value={filters.category} onChange={event => updateFilter("category", event.target.value)} aria-label="Category">
            {CATEGORY_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
          <select className="select" value={filters.status} onChange={event => updateFilter("status", event.target.value)} aria-label="Status">
            {STATUS_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
          <input className="input" value={filters.actor} onChange={event => updateFilter("actor", event.target.value)} placeholder="Actor" />
          <input className="input" value={filters.trainer} onChange={event => updateFilter("trainer", event.target.value)} placeholder="Trainer" />
          <input className="input" value={filters.student} onChange={event => updateFilter("student", event.target.value)} placeholder="Student" />
          <input className="input" value={filters.phase} onChange={event => updateFilter("phase", event.target.value)} placeholder="Phase" />
          <input className="input activity-search" value={filters.search} onChange={event => updateFilter("search", event.target.value)} placeholder="Search students, trainers, assignments, providers..." />
        </div>
      </div>

      <div className="card admin-panel">
        {loading ? <LoadingSkeleton rows={6} label="Loading activity log" /> : filtered.length === 0 ? (
          <EmptyState icon="📋" title="No activity found" message="Try changing filters or searching another user." />
        ) : viewMode === "timeline" ? (
          <div className="activity-day-list">
            {Object.entries(grouped).map(([label, items]) => (
              <section className="activity-day-group" key={label}>
                <h3>{label}</h3>
                <div className="activity-timeline-list">
                  {items.map(item => <ActivityTimelineItem key={item.id} item={item} setSelected={setSelected} applyEntityFilter={applyEntityFilter} />)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="activity-log-list">
            {filtered.map(item => <ActivityCard key={item.id} item={item} setSelected={setSelected} applyEntityFilter={applyEntityFilter} />)}
          </div>
        )}
      </div>

      {selected && (
        <div className="activity-drawer-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <aside className="activity-drawer" role="dialog" aria-modal="true" aria-label="Activity details" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{selected.icon} {selected.title}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{formatDateTime(selected.created_at)}</p>
              </div>
              <button className="btn btn-secondary btn-xs" type="button" onClick={() => setSelected(null)}>Close</button>
            </div>
            <DrawerSection title="Summary" rows={[
              ["Actor", selected.actor_name],
              ["Role", selected.actor_role],
              ["Category", selected.category],
              ["Status", selected.status],
              ["Description", selected.description],
            ]} />
            <DrawerSection title="Timeline"><Timeline row={selected.timeline} /></DrawerSection>
            <DrawerSection title="Diagnostics" rows={[
              ["Diagnostics", selected.timeline?.ai_evaluation ? "Stored on linked submission" : "Not Available"],
              ["Duration", selected.timeline?.ai_evaluation?.diagnostics?.evaluation_ms ? `${selected.timeline.ai_evaluation.diagnostics.evaluation_ms} ms` : "Not Available"],
              ["Request ID", "Not Available"],
            ]}>
              <button className="btn btn-secondary btn-xs mt-2" type="button" disabled>Copy Request ID</button>
            </DrawerSection>
            <DrawerSection title="Provider" rows={[
              ["Provider", selected.provider || "Not Available"],
              ["Model", selected.model || "Not Available"],
            ]} />
            <DrawerSection title="Metadata" rows={[
              ["Student", selected.student || "Not Available"],
              ["Trainer", selected.trainer || "Not Available"],
              ["Assignment", selected.assignment || "Not Available"],
              ["Batch", selected.batch || "Not Available"],
              ["Phase", selected.phase || "Not Available"],
              ["Submission ID", selected.timeline?.id || "Not Available"],
            ]}>
              <button className="btn btn-secondary btn-xs mt-2" type="button" onClick={() => copyValue("Submission ID", selected.timeline?.id)} disabled={!selected.timeline?.id}>Copy Submission ID</button>
            </DrawerSection>
          </aside>
        </div>
      )}
    </div>
  )
}

function ActivityCard({ item, setSelected, applyEntityFilter }) {
  return (
    <button className={`activity-log-row tone-${item.tone}`} type="button" onClick={() => setSelected(item)}>
      <div className="activity-main">
        <span className="activity-event-icon" aria-hidden>{item.icon}</span>
        <div>
          <p className="activity-title">{item.title}</p>
          <p className="activity-description">{item.description}</p>
          <EntityLinks item={item} applyEntityFilter={applyEntityFilter} />
        </div>
      </div>
      <div className="activity-log-meta">
        <span>{formatDateTime(item.created_at)}</span>
        <span>{item.actor_name} / {item.actor_role}</span>
        <span className={item.status === "Failed" ? "badge-failed" : item.status === "Warning" ? "badge-pending" : "badge-done"}>{item.status}</span>
      </div>
    </button>
  )
}

function ActivityTimelineItem({ item, setSelected, applyEntityFilter }) {
  return (
    <button className={`activity-timeline-item tone-${item.tone}`} type="button" onClick={() => setSelected(item)}>
      <time>{formatTime(item.created_at)}</time>
      <span className="activity-timeline-marker" aria-hidden>{item.icon}</span>
      <div>
        <p className="activity-title">{item.title}</p>
        <p className="activity-description">{item.description}</p>
        <EntityLinks item={item} applyEntityFilter={applyEntityFilter} />
      </div>
    </button>
  )
}

function EntityLinks({ item, applyEntityFilter }) {
  return (
    <div className="activity-entities">
      {fieldButton("Student", item.student, value => applyEntityFilter("student", value))}
      {fieldButton("Trainer", item.trainer || item.actor_name, value => applyEntityFilter("trainer", value))}
      {fieldButton("Assignment", item.assignment, value => applyEntityFilter("assignment", value))}
      {fieldButton("Batch", item.batch, value => applyEntityFilter("batch", value))}
      {fieldButton("Phase", item.phase, value => applyEntityFilter("phase", value))}
      {fieldButton("Provider", item.provider, value => applyEntityFilter("provider", value))}
      {fieldButton("Model", item.model, value => applyEntityFilter("model", value))}
    </div>
  )
}

function DrawerSection({ title, rows = [], children }) {
  return (
    <section className="activity-drawer-section">
      <h3>{title}</h3>
      {rows.map(([label, value]) => (
        <div className="admin-summary-row" key={label}><span>{label}</span><b>{value || "Not Available"}</b></div>
      ))}
      {children}
    </section>
  )
}
