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
  const [status, setStatus] = useState("pending")
  const [batch, setBatch] = useState("")
  const [date, setDate] = useState("")
  const [search, setSearch] = useState("")
  const [attendance, setAttendance] = useState([])
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState("")
  const [selectedIds, setSelectedIds] = useState([])
  const [confirmReject, setConfirmReject] = useState(false)
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
    } catch (error) {
      showErrorRef.current(error.message || "Could not load attendance.")
    } finally {
      setLoading(false)
    }
  }, [adminToken, batch, date, search, status])

  useEffect(() => { load() }, [load])

  const pendingVisibleIds = useMemo(() => attendance.filter(row => row.status === "pending").map(row => row.id), [attendance])
  const allVisibleSelected = pendingVisibleIds.length > 0 && pendingVisibleIds.every(id => selectedIds.includes(id))

  function toggleSelected(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])
  }

  function toggleAll() {
    setSelectedIds(allVisibleSelected ? [] : pendingVisibleIds)
  }

  async function review(ids, action, reviewNote = null) {
    setReviewingId(ids.join(","))
    try {
      const body = { action, reviewNote }
      if (ids.length === 1) body.attendanceId = ids[0]
      else body.attendanceIds = ids
      const res = await fetch("/api/admin-attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not review attendance.")
      successRef.current(`${data.updated?.length || 1} attendance record${(data.updated?.length || 1) === 1 ? "" : "s"} ${action === "approve" ? "approved" : "rejected"}.`)
      await load()
    } catch (error) {
      showErrorRef.current(error.message || "Could not review attendance.")
    } finally {
      setReviewingId("")
    }
  }

  function rejectIds(ids) {
    const note = window.prompt("Optional rejection note")
    if (note === null) return
    review(ids, "reject", note.trim() || null)
  }

  return (
    <div className="grid gap-4">
      <div className="card admin-panel">
        <SectionHeading
          title="Attendance management"
          detail="Review, upload, and manage attendance across all batches."
          action={<RefreshButton onClick={load} disabled={loading} />}
        />
        <div className="tab-list mt-5 mb-0" role="tablist" aria-label="Attendance sections">
          <button type="button" role="tab" aria-selected={mode === "review"} className={`tab-item ${mode === "review" ? "active" : ""}`} onClick={() => setMode("review")}>Review</button>
          <button type="button" role="tab" aria-selected={mode === "upload"} className={`tab-item ${mode === "upload" ? "active" : ""}`} onClick={() => setMode("upload")}>Upload report</button>
        </div>
      </div>

      {mode === "upload" && <AttendanceUpload token={adminToken} batches={batches.map(b => b.name || b)} role="admin" onUploaded={load} />}

      {mode === "review" && <>
        <div className="card admin-panel">
          <div className="status-summary">
            <MetricCard label="Pending" value={counts.pending || 0} tone="warning" />
            <MetricCard label="Approved" value={counts.approved || 0} tone="success" />
            <MetricCard label="Rejected" value={counts.rejected || 0} />
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
                <button type="button" className="btn btn-primary btn-sm" onClick={() => review(selectedIds, "approve")} disabled={Boolean(reviewingId)}>Approve selected</button>
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
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className={statusClass(row.status)}>{row.status}</span>
                    {row.status === "pending" && <>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => review([row.id], "approve")} disabled={Boolean(reviewingId)}>{reviewingId === row.id ? <Spinner size="sm" /> : "Approve"}</button>
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
