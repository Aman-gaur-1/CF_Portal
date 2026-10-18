"use client"

import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"

function confidenceLabel(match) {
  if (!match) return "No suggestion"
  if (match.matchType === "alias") return "Trusted alias"
  if (match.matchType === "exact") return "Exact match"
  if (match.matchType === "high_confidence") return "High confidence"
  if (match.matchType === "ambiguous") return "Possible matches"
  return "Possible match"
}

export default function AttendanceResolveDialog({ token, row, suggestion, onClose, onResolve, onDismiss }) {
  const [students, setStudents] = useState([])
  const [studentId, setStudentId] = useState(suggestion?.studentId || row?.suggested_student_id || "")
  const [correctedName, setCorrectedName] = useState(row?.corrected_display_name || "")
  const [rememberAlias, setRememberAlias] = useState(false)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function loadStudents() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ batch: row.batch })
        if (search.trim()) params.set("search", search.trim())
        const res = await fetch(`/api/attendance-students?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Could not load students.")
        if (!cancelled) setStudents(data.students || [])
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Could not load students.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadStudents()
    return () => { cancelled = true }
  }, [row.batch, search, token])

  async function resolve() {
    if (!studentId) { setError("Choose a student before linking."); return }
    setSaving(true)
    setError("")
    try {
      await onResolve({ id: row.id, studentId, correctedDisplayName: correctedName.trim() || null, rememberAlias })
    } catch (resolveError) {
      setError(resolveError.message || "Could not link attendance.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="activity-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="activity-drawer" role="dialog" aria-modal="true" aria-label="Resolve attendance participant">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Needs matching</p>
            <h2 className="text-xl font-bold">Resolve participant</h2>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close resolve panel">Close</button>
        </div>
        <div className="activity-drawer-section">
          <h3>Imported identity</h3>
          <p className="font-semibold">{row.original_participant_name || row.participant_name}</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{row.batch} · {row.attendance_date}{row.session_id ? " · session recorded" : ""}</p>
          {!row.session_id && <p className="text-sm mt-2" style={{ color: "var(--warning)" }}>Authoritative class session required before linking and approving.</p>}
        </div>
        <div className="activity-drawer-section">
          <h3>Suggested student</h3>
          <p className="text-sm" style={{ color: suggestion?.studentId ? "var(--success)" : "var(--text-secondary)" }}>
            {suggestion?.studentName || "No safe suggestion"} {suggestion && `· ${Math.round((suggestion.similarity || 0) * 100)}% · ${confidenceLabel(suggestion)}`}
          </p>
          {suggestion?.reason && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{suggestion.reason}</p>}
        </div>
        <div className="activity-drawer-section grid gap-3">
          <label className="text-sm font-semibold" htmlFor="attendance-corrected-name">Corrected display name</label>
          <input id="attendance-corrected-name" className="input" value={correctedName} onChange={event => setCorrectedName(event.target.value)} placeholder="Optional corrected name" />
          <label className="text-sm font-semibold" htmlFor="attendance-student-search">Student</label>
          <input id="attendance-student-search" className="input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search this batch" />
          {loading ? <div className="flex justify-center py-3"><Spinner size="sm" /></div> : (
            <select className="select" value={studentId} onChange={event => setStudentId(event.target.value)} aria-label="Select matching student">
              <option value="">Choose a student</option>
              {students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rememberAlias} onChange={event => setRememberAlias(event.target.checked)} /> Remember this mapping for future reports</label>
        </div>
        {error && <p className="upload-error mt-4">{error}</p>}
        <div className="activity-drawer-section flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={resolve} disabled={saving || !row.session_id}>{saving ? <Spinner size="sm" /> : "Link & approve"}</button>
          <button type="button" className="btn btn-danger-outline" onClick={() => onDismiss(row.id)} disabled={saving}>Dismiss</button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Keep waiting</button>
        </div>
      </aside>
    </div>
  )
}
