"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { formatDate } from "@/lib/utils"

function hoursBetween(start, end = new Date()) {
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null
  return Math.max(0, Math.floor((endTime - startTime) / 36e5))
}

function formatDuration(start, end) {
  const hours = hoursBetween(start, end)
  if (hours === null) return "-"
  if (hours < 1) return "<1h"
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return days > 0 ? `${days}d ${rest}h` : `${hours}h`
}

function ageTone(query) {
  if (query.status === "resolved") return { label: `Resolved in ${formatDuration(query.created_at, query.resolved_at)}`, className: "badge-query-resolved" }
  const hours = hoursBetween(query.created_at)
  if (hours === null) return { label: "-", className: "badge-pending" }
  if (hours >= 48) return { label: `${hours}h old`, className: "badge-failed" }
  if (hours >= 24) return { label: `${hours}h old`, className: "badge-query-open" }
  return { label: `${hours}h old`, className: "badge-pending" }
}

function uniqueOptions(items, getter) {
  return [...new Set(items.map(getter).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function matchesDate(query, dateMode, customDate) {
  if (dateMode === "all") return true
  const created = new Date(query.created_at)
  if (!Number.isFinite(created.getTime())) return false
  const now = new Date()
  if (dateMode === "today") return created.toDateString() === now.toDateString()
  if (dateMode === "7d") return now.getTime() - created.getTime() <= 7 * 24 * 36e5
  if (dateMode === "30d") return now.getTime() - created.getTime() <= 30 * 24 * 36e5
  if (dateMode === "custom") return customDate && created.toISOString().slice(0, 10) === customDate
  return true
}

function csvEscape(value) {
  const text = String(value ?? "")
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function statusClass(status) {
  return status === "resolved" ? "badge-query-resolved" : "badge-query-open"
}

function timelineEvents(query) {
  const submission = query.submission || {}
  return [
    { label: "Assignment Submitted", at: submission.submitted_at },
    { label: "AI Feedback Generated", at: submission.ai_feedback_at },
    { label: "Feedback Published", at: submission.feedback_at },
    { label: "Query Raised", at: query.created_at },
    { label: "Trainer Response", at: query.trainer_response ? query.resolved_at : null },
    { label: "Query Resolved", at: query.resolved_at },
  ]
    .filter(event => event.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>{value || "-"}</p>
    </div>
  )
}

export default function AdminQueriesPanel({ adminToken, showError }) {
  const [enabled, setEnabled] = useState(false)
  const [queries, setQueries] = useState([])
  const [counts, setCounts] = useState({ total: 0, open: 0, resolved: 0 })
  const [status, setStatus] = useState("all")
  const [trainer, setTrainer] = useState("all")
  const [batch, setBatch] = useState("all")
  const [phase, setPhase] = useState("all")
  const [dateMode, setDateMode] = useState("all")
  const [customDate, setCustomDate] = useState("")
  const [search, setSearch] = useState("")
  const [selectedQuery, setSelectedQuery] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadQueries()
  }, [status])

  async function loadQueries() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      const res = await fetch(`/api/admin-queries?${params}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load student queries.")
      setEnabled(Boolean(data.enabled))
      setQueries(data.queries || [])
      setCounts(data.counts || { total: 0, open: 0, resolved: 0 })
    } catch (err) {
      showError?.(err.message || "Could not load student queries.")
    } finally {
      setLoading(false)
    }
  }

  const filters = useMemo(() => ({
    trainers: uniqueOptions(queries, query => query.submission?.trainer_name),
    batches: uniqueOptions(queries, query => query.submission?.batch),
    phases: uniqueOptions(queries, query => query.submission?.phase),
  }), [queries])

  const visibleQueries = useMemo(() => {
    const term = search.trim().toLowerCase()
    return queries.filter(query => {
      const submission = query.submission || {}
      const matchesSearch = !term
        || String(submission.student_name || "").toLowerCase().includes(term)
        || String(submission.topic || "").toLowerCase().includes(term)
      return matchesSearch
        && (trainer === "all" || submission.trainer_name === trainer)
        && (batch === "all" || submission.batch === batch)
        && (phase === "all" || submission.phase === phase)
        && matchesDate(query, dateMode, customDate)
    })
  }, [queries, search, trainer, batch, phase, dateMode, customDate])

  function copyText(label, value) {
    const text = String(value || "").trim()
    if (!text) {
      showError?.(`${label} is empty.`)
      return
    }
    navigator.clipboard?.writeText(text).catch(() => showError?.(`Could not copy ${label.toLowerCase()}.`))
  }

  function exportCsv() {
    const headers = ["Student", "Batch", "Trainer", "Assignment", "Phase", "Status", "Raised At", "Resolved At", "Resolution Time"]
    const rows = visibleQueries.map(query => {
      const submission = query.submission || {}
      return [
        submission.student_name || "",
        submission.batch || "",
        submission.trainer_name || "",
        submission.topic || "",
        submission.phase || "",
        query.status || "",
        query.created_at || "",
        query.resolved_at || "",
        query.resolved_at ? formatDuration(query.created_at, query.resolved_at) : "",
      ]
    })
    const csv = [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `student-queries-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  function openSubmission(query) {
    const id = query?.submission?.id || query?.submission_id
    if (!id) return
    window.open(`/teacher?submissionId=${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="card admin-panel">
      <div className="section-divider">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Student Queries</span>
        <div className="line" />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{enabled ? `${counts.open || 0} open` : "Disabled"}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="stat-card"><div className="stat-num">{counts.total || 0}</div><div className="stat-label">Total</div></div>
        <div className="stat-card"><div className="stat-num">{counts.open || 0}</div><div className="stat-label">Open</div></div>
        <div className="stat-card"><div className="stat-num">{counts.resolved || 0}</div><div className="stat-label">Resolved</div></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <input className="input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search student or topic" />
        <select className="select" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select className="select" value={trainer} onChange={event => setTrainer(event.target.value)}>
          <option value="all">All trainers</option>
          {filters.trainers.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="select" value={batch} onChange={event => setBatch(event.target.value)}>
          <option value="all">All batches</option>
          {filters.batches.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="select" value={phase} onChange={event => setPhase(event.target.value)}>
          <option value="all">All phases</option>
          {filters.phases.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <div className="flex gap-2">
          <select className="select" value={dateMode} onChange={event => setDateMode(event.target.value)}>
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Exact date</option>
          </select>
          {dateMode === "custom" && <input className="input" type="date" value={customDate} onChange={event => setCustomDate(event.target.value)} />}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{visibleQueries.length} queries in current view</p>
        <button className="btn btn-secondary btn-sm" type="button" onClick={exportCsv} disabled={!visibleQueries.length}>Export CSV</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !enabled ? (
        <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>Student queries are currently disabled.</p>
      ) : visibleQueries.length === 0 ? (
        <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No queries found.</p>
      ) : (
        <div className="grid gap-3">
          {visibleQueries.map(query => {
            const age = ageTone(query)
            return (
              <button key={query.id} type="button" className="admin-row items-start text-left" onClick={() => setSelectedQuery(query)}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={statusClass(query.status)}>{query.status === "resolved" ? "RESOLVED" : "OPEN"}</span>
                    <span className={age.className}>{age.label}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{formatDate(query.created_at)}</span>
                  </div>
                  <p className="font-semibold truncate">{query.submission?.student_name || "Student"} - {query.submission?.topic || "Assignment"}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {query.submission?.batch || "No batch"} - {query.submission?.phase || "No phase"} - {query.submission?.trainer_name || "Unassigned"}
                  </p>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{query.query_text}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedQuery && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(15,23,42,0.42)" }} role="dialog" aria-modal="true" aria-label="Query details">
          <div className="h-full w-full max-w-2xl overflow-y-auto p-5 sm:p-6" style={{ background: "var(--bg-card)", borderLeft: "1px solid var(--border)" }}>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Query Details</p>
                <h2 className="text-xl font-bold mt-1">{selectedQuery.submission?.student_name || "Student"}</h2>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => openSubmission(selectedQuery)}>Open Submission</button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSelectedQuery(null)}>Close</button>
              </div>
            </div>

            <div className="flex gap-2 mb-5 flex-wrap">
              <span className={statusClass(selectedQuery.status)}>{selectedQuery.status === "resolved" ? "RESOLVED" : "OPEN"}</span>
              <span className={ageTone(selectedQuery).className}>{ageTone(selectedQuery).label}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <DetailRow label="Student name" value={selectedQuery.submission?.student_name} />
              <DetailRow label="Student batch" value={selectedQuery.submission?.batch} />
              <DetailRow label="Student email" value={selectedQuery.student?.email || "Not stored"} />
              <DetailRow label="Student phone" value={selectedQuery.student?.phone || "Not stored"} />
              <DetailRow label="Assignment topic" value={selectedQuery.submission?.topic} />
              <DetailRow label="Phase" value={selectedQuery.submission?.phase} />
              <DetailRow label="Assigned trainer" value={selectedQuery.submission?.trainer_name || "Unassigned"} />
              <DetailRow label="Submission date" value={formatDate(selectedQuery.submission?.submitted_at)} />
              <DetailRow label="Status" value={selectedQuery.status} />
              <DetailRow label="Raised at" value={formatDate(selectedQuery.created_at)} />
              <DetailRow label="Resolved at" value={selectedQuery.resolved_at ? formatDate(selectedQuery.resolved_at) : "-"} />
              <DetailRow label="Resolved by" value={selectedQuery.resolved_by || "-"} />
              <DetailRow label="Resolution time" value={selectedQuery.resolved_at ? formatDuration(selectedQuery.created_at, selectedQuery.resolved_at) : "-"} />
              <DetailRow label="Query age" value={formatDuration(selectedQuery.created_at, new Date())} />
              <DetailRow label="Time to first trainer response" value={selectedQuery.trainer_response && selectedQuery.resolved_at ? formatDuration(selectedQuery.created_at, selectedQuery.resolved_at) : "-"} />
            </div>

            <div className="mb-5 p-4 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold mb-3">Activity Timeline</p>
              <div className="grid gap-2">
                {timelineEvents(selectedQuery).map(event => (
                  <div key={`${event.label}-${event.at}`} className="flex items-center justify-between gap-3 text-sm">
                    <span>{event.label}</span>
                    <span style={{ color: "var(--text-muted)" }}>{formatDate(event.at)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <DetailRow label="Published feedback" value={selectedQuery.submission?.feedback || "No published feedback found."} />
              <DetailRow label="Student query" value={selectedQuery.query_text} />
              <DetailRow label="Trainer response" value={selectedQuery.trainer_response || "No response yet."} />
            </div>

            <div className="flex gap-2 mt-5 flex-wrap">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => copyText("Student Query", selectedQuery.query_text)}>Copy Student Query</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => copyText("Trainer Response", selectedQuery.trainer_response)}>Copy Trainer Response</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => copyText("Published Feedback", selectedQuery.submission?.feedback)}>Copy Published Feedback</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
