"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import ConfirmDialog from "@/components/ui/ConfirmDialog"
import EmptyState from "@/components/ui/EmptyState"
import MetricCard from "@/components/ui/MetricCard"
import SectionHeading from "@/components/ui/SectionHeading"
import AttendanceUpload from "@/components/ui/AttendanceUpload"

function statusClass(status) {
  if (status === "approved") return "badge-done"
  if (status === "rejected") return "badge-failed"
  return "badge-pending"
}

export default function AdminAttendancePanel({ adminToken, batches = [], success, showError }) {
  const [mode, setMode] = useState("review")
  const [status, setStatus] = useState("all")
  const [batch, setBatch] = useState("")
  const [date, setDate] = useState("")
  const [search, setSearch] = useState("")
  const [attendance, setAttendance] = useState([])
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState("")
  const [selectedIds, setSelectedIds] = useState([])
  const [sessionSelections, setSessionSelections] = useState({})
  const [confirmReject, setConfirmReject] = useState(false)
  const [unlinked, setUnlinked] = useState([])
  const [unlinkedLoading, setUnlinkedLoading] = useState(false)
  const [rematchResults, setRematchResults] = useState({})
  const [actioningId, setActioningId] = useState("")
  const showErrorRef = useRef(showError)
  const successRef = useRef(success)

  useEffect(() => { showErrorRef.current = showError }, [showError])
  useEffect(() => { successRef.current = success }, [success])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (batch) params.set("batch", batch)
      if (date) params.set("date", date)
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`/api/admin-attendance?${params.toString()}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load attendance.")
      setAttendance(data.attendance || [])
      setCounts(data.counts || { pending: 0, approved: 0, rejected: 0 })
      setSelectedIds([])
      setSessionSelections({})
    } catch (error) {
      showErrorRef.current(error.message || "Could not load attendance.")
    } finally {
      setLoading(false)
    }
  }, [adminToken, batch, date, search, status])

  useEffect(() => { load() }, [load])

  const loadUnlinked = useCallback(async () => {
    setUnlinkedLoading(true)
    try {
      const params = new URLSearchParams()
      if (batch) params.set("batch", batch)
      if (date) params.set("date", date)
      const res = await fetch(`/api/admin-attendance/unlinked?${params.toString()}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load unlinked records.")
      setUnlinked(data.unlinked || [])
      setRematchResults({})
    } catch (error) {
      showErrorRef.current(error.message || "Could not load unlinked records.")
    } finally {
      setUnlinkedLoading(false)
    }
  }, [adminToken, batch, date])

  useEffect(() => { if (mode === "unlinked") loadUnlinked() }, [mode, loadUnlinked])

  const pendingVisibleIds = useMemo(() => attendance.filter(row => row.status === "pending").map(row => row.id), [attendance])
  const allVisibleSelected = pendingVisibleIds.length > 0 && pendingVisibleIds.every(id => selectedIds.includes(id))
  const selectedSessionless = attendance.some(row => selectedIds.includes(row.id) && row.status === "pending" && !row.session_id)

  function toggleSelected(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])
  }

  function toggleAll() {
    setSelectedIds(allVisibleSelected ? [] : pendingVisibleIds)
  }

  async function review(ids, action, reviewNote = null, { sessionId = "" } = {}) {
    setReviewingId(ids.join(","))
    try {
      const body = { action, reviewNote }
      if (sessionId) body.sessionId = sessionId
      if (ids.length === 1) body.attendanceId = ids[0]
      else body.attendanceIds = ids
      const res = await fetch("/api/admin-attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not review attendance.")
      const result = action === "approve" ? "approved" : action === "reject" ? "rejected" : "linked to the authoritative session"
      successRef.current(`${data.updated?.length || 1} attendance record${(data.updated?.length || 1) === 1 ? "" : "s"} ${result}.`)
      await load()
    } catch (error) {
      showErrorRef.current(error.message || "Could not review attendance.")
    } finally {
      setReviewingId("")
    }
  }

  function resolveSession(row) {
    const sessionId = sessionSelections[row.id]
    if (sessionId) review([row.id], "resolve_session", null, { sessionId })
  }

  function rejectIds(ids) {
    const note = window.prompt("Optional rejection note")
    if (note === null) return
    review(ids, "reject", note.trim() || null)
  }

  async function rematchAll() {
    if (!unlinked.length) return
    setActioningId("rematch-all")
    try {
      const res = await fetch("/api/admin-attendance/unlinked", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "rematch", ids: unlinked.map(u => u.id) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Re-match failed.")
      const map = {}
      for (const r of (data.results || [])) map[r.unlinkedId] = r
      setRematchResults(map)
      const matched = (data.results || []).filter(r => r.studentId)
      if (matched.length) successRef.current(`${matched.length} name${matched.length === 1 ? "" : "s"} matched to registered students.`)
      else successRef.current("No new matches found. Students may not have registered yet.")
    } catch (error) {
      showErrorRef.current(error.message || "Re-match failed.")
    } finally {
      setActioningId("")
    }
  }

  async function linkOne(unlinkedId, studentId) {
    setActioningId(unlinkedId)
    try {
      const res = await fetch("/api/admin-attendance/unlinked", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "link", id: unlinkedId, studentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Link failed.")
      successRef.current(`Attendance linked and approved.`)
      await loadUnlinked()
      await load()
    } catch (error) {
      showErrorRef.current(error.message || "Link failed.")
    } finally {
      setActioningId("")
    }
  }

  async function dismissIds(ids) {
    setActioningId(ids.join(","))
    try {
      const res = await fetch("/api/admin-attendance/unlinked", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "dismiss", ids }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Dismiss failed.")
      successRef.current(`${data.dismissed || ids.length} record${(data.dismissed || ids.length) === 1 ? "" : "s"} dismissed.`)
      await loadUnlinked()
    } catch (error) {
      showErrorRef.current(error.message || "Dismiss failed.")
    } finally {
      setActioningId("")
    }
  }

  return (
    <div className="grid gap-4">
      <div className="card admin-panel">
        <SectionHeading
          title="Attendance management"
          detail="Review, upload, and manage attendance across all batches."
          action={<RefreshButton onClick={mode === "unlinked" ? loadUnlinked : load} disabled={loading || unlinkedLoading} />}
        />
        <div className="tab-list mt-5 mb-0" role="tablist" aria-label="Attendance sections">
          <button type="button" role="tab" aria-selected={mode === "review"} className={`tab-item ${mode === "review" ? "active" : ""}`} onClick={() => setMode("review")}>Review</button>
          <button type="button" role="tab" aria-selected={mode === "upload"} className={`tab-item ${mode === "upload" ? "active" : ""}`} onClick={() => setMode("upload")}>Upload report</button>
          <button type="button" role="tab" aria-selected={mode === "unlinked"} className={`tab-item ${mode === "unlinked" ? "active" : ""}`} onClick={() => setMode("unlinked")}>Unlinked</button>
        </div>
      </div>

      {mode === "upload" && <AttendanceUpload token={adminToken} batches={batches.map(b => b.name || b)} role="admin" onUploaded={() => { setStatus("all"); load() }} />}

      {mode === "unlinked" && (
        <div className="grid gap-4">
          <div className="card admin-panel">
            <div className="attendance-filter-grid">
              <select className="select" value={batch} onChange={e => setBatch(e.target.value)} aria-label="Batch filter">
                <option value="">All batches</option>
                {batches.map(b => { const name = b.name || b; return <option key={name} value={name}>{name}</option> })}
              </select>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date filter" />
              <button type="button" className="btn btn-primary btn-sm" onClick={rematchAll} disabled={Boolean(actioningId) || !unlinked.length}>
                {actioningId === "rematch-all" ? <Spinner size="sm" /> : "Re-match all"}
              </button>
            </div>
          </div>

          <div className="card admin-panel">
            {unlinkedLoading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : unlinked.length === 0 ? (
              <EmptyState icon="✓" title="No unlinked records" message="All uploaded attendance has been matched to registered students." />
            ) : (
              <div className="attendance-list">
                <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{unlinked.length} name{unlinked.length === 1 ? "" : "s"} waiting for student registration</p>
                {unlinked.map(row => {
                  const match = rematchResults[row.id]
                  return (
                    <div key={row.id} className="attendance-row">
                      <div className="min-w-0">
                        <p className="font-semibold">{row.participant_name}</p>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{row.batch} · {row.attendance_date} · uploaded {String(row.created_at || "").slice(0, 16).replace("T", " ")}</p>
                        {match && match.studentId && (
                          <p className="text-xs mt-2" style={{ color: "var(--success)" }}>Matched: <b>{match.studentName}</b> ({Math.round(match.similarity * 100)}% {match.confidence})</p>
                        )}
                        {match && !match.studentId && (
                          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>Still no match — student may not have registered yet</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="badge-pending">Waiting</span>
                        {match && match.studentId && row.session_id && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => linkOne(row.id, match.studentId)} disabled={Boolean(actioningId)}>
                            {actioningId === row.id ? <Spinner size="sm" /> : "Link & approve"}
                          </button>
                        )}
                        {!row.session_id && <span className="badge-pending">Session required</span>}
                        <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => dismissIds([row.id])} disabled={Boolean(actioningId)}>Dismiss</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "review" && <>
        <div className="card admin-panel">
          <div className="status-summary">
            <MetricCard label="Pending" value={counts.pending || 0} tone="warning" onClick={() => setStatus("pending")} style={{ cursor: "pointer", outline: status === "pending" ? "2px solid var(--warning)" : "none" }} />
            <MetricCard label="Approved" value={counts.approved || 0} tone="success" onClick={() => setStatus("approved")} style={{ cursor: "pointer", outline: status === "approved" ? "2px solid var(--success)" : "none" }} />
            <MetricCard label="Rejected" value={counts.rejected || 0} onClick={() => setStatus("rejected")} style={{ cursor: "pointer", outline: status === "rejected" ? "2px solid var(--danger)" : "none" }} />
          </div>
          <div className="attendance-filter-grid">
            <select className="select" value={batch} onChange={e => setBatch(e.target.value)} aria-label="Attendance batch filter">
              <option value="">All batches</option>
              {batches.map(b => { const name = b.name || b; return <option key={name} value={name}>{name}</option> })}
            </select>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Attendance date filter" />
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student" aria-label="Search student" />
            <select className="select" value={status} onChange={e => setStatus(e.target.value)} aria-label="Attendance status filter">
              {["pending", "approved", "rejected", "all"].map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div className="card admin-panel">
          {status === "pending" && selectedIds.length > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4 p-3 rounded-lg" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <span className="text-sm">{selectedIds.length} pending selected</span>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => review(selectedIds, "approve")} disabled={Boolean(reviewingId) || selectedSessionless} title={selectedSessionless ? "Remove sessionless rows before approving." : undefined}>Approve selected</button>
                <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => { if (selectedIds.length) setConfirmReject(true) }} disabled={Boolean(reviewingId)}>Reject selected</button>
              </div>
            </div>
          )}
          {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : attendance.length === 0 ? (
            <EmptyState icon="✓" title="No attendance records" message="Try a different status, batch, date, or student search." />
          ) : (
            <div className="attendance-list">
              {status === "pending" && pendingVisibleIds.length > 0 && <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /> Select all visible pending</label>}
              {attendance.map(row => (
                <div key={row.id} className="attendance-row">
                  <div className="flex items-start gap-3 min-w-0">
                    {row.status === "pending" && <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} aria-label={`Select ${row.student?.name || "attendance"}`} />}
                    <div className="min-w-0">
                      <p className="font-semibold">{row.student?.name || "Inactive student"}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{row.batch} · {row.attendance_date} · marked {String(row.marked_at || "").slice(0, 16).replace("T", " ")}</p>
                      {row.review_note && <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>{row.review_note}</p>}
                      {row.status === "pending" && !row.session_id && <div className="flex flex-wrap items-center gap-2 mt-2"><span className="badge-pending">Legacy attendance request</span><span className="badge-pending">Session required</span><select className="select" value={sessionSelections[row.id] || ""} onChange={event => setSessionSelections(prev => ({ ...prev, [row.id]: event.target.value }))} aria-label={`Authoritative session for ${row.student?.name || "attendance"}`}><option value="">{row.available_sessions?.length ? "Choose authoritative session" : "No authoritative session available"}</option>{(row.available_sessions || []).map(session => <option key={session.id} value={session.id}>{session.title}{session.starts_at ? ` · ${String(session.starts_at).slice(11, 16)}` : ""}</option>)}</select><button type="button" className="btn btn-secondary btn-sm" onClick={() => resolveSession(row)} disabled={Boolean(reviewingId) || !sessionSelections[row.id]}>{reviewingId === row.id ? <Spinner size="sm" /> : "Resolve session"}</button></div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className={statusClass(row.status)}>{row.status}</span>
                    {row.status === "pending" && <>
                      {row.session_id && <button type="button" className="btn btn-primary btn-sm" onClick={() => review([row.id], "approve")} disabled={Boolean(reviewingId)}>{reviewingId === row.id ? <Spinner size="sm" /> : "Approve"}</button>}
                      <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => rejectIds([row.id])} disabled={Boolean(reviewingId)}>Reject</button>
                    </>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </>}

      {confirmReject && <ConfirmDialog message={`Reject ${selectedIds.length} selected attendance record${selectedIds.length === 1 ? "" : "s"}?`} confirmLabel="Reject selected" onCancel={() => setConfirmReject(false)} onConfirm={() => { setConfirmReject(false); rejectIds(selectedIds) }} />}
    </div>
  )
}
