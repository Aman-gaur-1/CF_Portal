"use client"

import { useCallback, useEffect, useState } from "react"
import EmptyState from "@/components/ui/EmptyState"
import Spinner from "@/components/ui/Spinner"
import SectionHeading from "@/components/ui/SectionHeading"

function formatDateTime(value) {
  return String(value || "").slice(0, 16).replace("T", " ") || "—"
}

export default function AttendanceImportHistory({ token, batches = [] }) {
  const [imports, setImports] = useState([])
  const [batch, setBatch] = useState("")
  const [date, setDate] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (batch) params.set("batch", batch)
      if (date) params.set("date", date)
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`/api/attendance-imports?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load import history.")
      setImports(data.imports || [])
    } catch (loadError) {
      setError(loadError.message || "Could not load import history.")
    } finally {
      setLoading(false)
    }
  }, [batch, date, search, token])

  useEffect(() => { load() }, [load])

  async function openDetail(id) {
    setDetailLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/attendance-imports/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load import detail.")
      setDetail(data)
    } catch (detailError) {
      setError(detailError.message || "Could not load import detail.")
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="card admin-panel">
        <SectionHeading title="History" detail="Review attendance reports, counts, and later resolutions." action={<button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>} />
        <div className="attendance-filter-grid mt-4">
          <select className="select" value={batch} onChange={event => setBatch(event.target.value)} aria-label="Import batch filter"><option value="">All batches</option>{batches.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <input className="input" type="date" value={date} onChange={event => setDate(event.target.value)} aria-label="Import date filter" />
          <input className="input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search filename" aria-label="Search import filename" />
        </div>
      </div>
      <div className="card admin-panel">
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : error ? <p className="upload-error">{error}</p> : imports.length === 0 ? <EmptyState icon="↥" title="No imports yet" message="Completed attendance reports will appear here." /> : (
          <div className="attendance-list">
            {imports.map(item => <button type="button" className="attendance-row text-left w-full" key={item.id} onClick={() => openDetail(item.id)}>
              <div className="min-w-0"><p className="font-semibold">{item.original_filename}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{item.batch} · {item.attendance_date} · {item.session?.title || "Attendance session"} · {item.uploaded_by_name} · {formatDateTime(item.created_at)}</p></div>
              <div className="flex items-center gap-2 flex-wrap justify-end text-xs"><span className="badge-done">{item.matched_count || 0} marked</span><span className="badge-pending">{item.needs_matching_count || 0} needs attention</span><span>{item.already_marked_count || 0} already existing</span></div>
            </button>)}
          </div>
        )}
      </div>
      {detailLoading && <div className="card admin-panel flex justify-center"><Spinner size="lg" /></div>}
      {detail && <div className="activity-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDetail(null) }}><aside className="activity-drawer" role="dialog" aria-modal="true" aria-label="Attendance import detail"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Import detail</p><h2 className="text-xl font-bold">{detail.import.original_filename}</h2></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>Close</button></div><div className="activity-drawer-section grid gap-2 text-sm"><div><b>Batch:</b> {detail.import.batch}</div><div><b>Date:</b> {detail.import.attendance_date}</div><div><b>Session:</b> {detail.session?.title || "Attendance session"}</div><div><b>Uploaded by:</b> {detail.import.uploaded_by_name}</div><div><b>Participants:</b> {detail.import.total_participants}</div><div><b>Marked:</b> {detail.import.matched_count} · <b>Needs attention:</b> {detail.import.needs_matching_count} · <b>Already existing:</b> {detail.import.already_marked_count}</div></div><div className="activity-drawer-section"><h3>Marked students</h3>{detail.attendance.length ? detail.attendance.map(row => <div className="admin-summary-row" key={row.id}><span>{row.student?.name || "Inactive student"}</span><span>{row.status}</span></div>) : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>None.</p>}</div><div className="activity-drawer-section"><h3>Needs attention / resolved later</h3>{detail.unlinked.length ? detail.unlinked.map(row => <div className="admin-summary-row" key={row.id}><span>{row.original_participant_name || row.participant_name}</span><span>{row.status}{row.corrected_display_name ? ` · ${row.corrected_display_name}` : ""}</span></div>) : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>None.</p>}</div></aside></div>}
    </div>
  )
}
