"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import EmptyState from "@/components/ui/EmptyState"
import MetricCard from "@/components/ui/MetricCard"
import AttendanceUpload from "@/components/ui/AttendanceUpload"
import AttendanceResolveDialog from "@/components/ui/AttendanceResolveDialog"
import AttendanceImportHistory from "@/components/ui/AttendanceImportHistory"
import AttendanceDetailDrawer from "@/components/ui/AttendanceDetailDrawer"
import SearchableBatchSelect from "@/components/ui/SearchableBatchSelect"

const SOURCE_LABELS = {
  teams_report: "Teams Upload",
  student_attendance_query: "Student Request",
  student_self_mark: "Student Request",
  manual_resolution: "Admin",
  admin: "Admin",
  teacher: "Teacher",
  legacy: "Historical record",
}

function todayValue() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function formatTime(value) {
  return value ? String(value).slice(11, 16) : ""
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || "Attendance record"
}

function statusLabel(status) {
  if (status === "present") return "Present"
  if (status === "pending") return "Pending"
  if (status === "rejected") return "Rejected"
  return "Not recorded"
}

function statusClass(status) {
  if (status === "present") return "badge-done"
  if (status === "rejected") return "badge-failed"
  return "badge-pending"
}

function sessionLabel(session) {
  if (!session) return "Choose a class session"
  const time = formatTime(session.starts_at)
  return `${session.title || "Class session"}${time ? ` · ${time}` : ""}`
}

export default function AdminAttendancePanel({ adminToken, batches = [], success, showError, focusMode = "" }) {
  const [batch, setBatch] = useState("")
  const [date, setDate] = useState(todayValue)
  const [sessionId, setSessionId] = useState("")
  const [search, setSearch] = useState("")
  const [rosterFilter, setRosterFilter] = useState("all")
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailRow, setDetailRow] = useState(null)
  const [resolvingRow, setResolvingRow] = useState(null)
  const [sessionSelections, setSessionSelections] = useState({})
  const [busyKey, setBusyKey] = useState("")
  const [rematchResults, setRematchResults] = useState({})
  const actionRequiredRef = useRef(null)
  const showErrorRef = useRef(showError)
  const successRef = useRef(success)

  useEffect(() => { showErrorRef.current = showError }, [showError])
  useEffect(() => { successRef.current = success }, [success])

  const batchNames = useMemo(() => batches.map(item => item?.name || item).filter(Boolean), [batches])
  const sessions = overview?.sessions || []
  const selectedSession = overview?.selectedSession || sessions.find(item => String(item.id) === String(sessionId))

  const loadOverview = useCallback(async () => {
    if (!batch || !date) {
      setOverview(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ overview: "1", batch, date })
      if (sessionId) params.set("session", sessionId)
      const res = await fetch(`/api/admin-attendance?${params.toString()}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "We couldn't load this class attendance.")
      setOverview(data)
      if (data.selectedSessionId && data.selectedSessionId !== sessionId) setSessionId(data.selectedSessionId)
      if (!data.selectedSessionId && sessionId && !(data.sessions || []).some(item => String(item.id) === String(sessionId))) setSessionId("")
      setRematchResults({})
    } catch (error) {
      setOverview(null)
      showErrorRef.current(error.message || "We couldn't load this class attendance.")
    } finally {
      setLoading(false)
    }
  }, [adminToken, batch, date, sessionId])

  useEffect(() => { loadOverview() }, [loadOverview])

  useEffect(() => {
    if (focusMode !== "needs") return
    setRosterFilter("all")
    requestAnimationFrame(() => actionRequiredRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }, [focusMode])

  const filteredRoster = useMemo(() => {
    const rows = overview?.roster || []
    const query = search.trim().toLowerCase()
    return rows.filter(row => {
      const matchesFilter = rosterFilter === "all"
        || (rosterFilter === "not_recorded" && row.status === "not_recorded")
        || row.status === rosterFilter
      const matchesSearch = !query || String(row.student?.name || "").toLowerCase().includes(query)
      return matchesFilter && matchesSearch
    })
  }, [overview, rosterFilter, search])

  function selectBatch(value) {
    setBatch(value)
    setSessionId("")
    setOverview(null)
    setRosterFilter("all")
  }

  function selectDate(event) {
    setDate(event.target.value)
    setSessionId("")
    setOverview(null)
    setRosterFilter("all")
  }

  async function reviewAttendance(row, action, explicitSessionId = "") {
    const attendance = row.attendance || row
    const id = attendance.id || row.id
    const session = explicitSessionId || sessionSelections[id] || attendance.session_id || sessionId
    if (action === "approve" && !session) {
      showErrorRef.current("Choose the class session before approving this request.")
      return
    }
    let reviewNote = null
    if (action === "reject") {
      reviewNote = window.prompt("Optional reason for rejecting this request")
      if (reviewNote === null) return
      reviewNote = reviewNote.trim() || null
    }
    setBusyKey(`${action}:${id}`)
    try {
      const body = { action, attendanceId: id, reviewNote }
      if (session) body.sessionId = session
      const res = await fetch("/api/admin-attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "We couldn't update this attendance request.")
      successRef.current(action === "approve" ? "Attendance marked Present." : action === "reject" ? "Attendance request rejected." : "Class session resolved.")
      setDetailRow(null)
      await loadOverview()
    } catch (error) {
      showErrorRef.current(error.message || "We couldn't update this attendance request.")
    } finally {
      setBusyKey("")
    }
  }

  async function markPresent(row) {
    const student = row.student
    if (!student?.id || !sessionId) {
      showErrorRef.current("Choose a class session before marking attendance.")
      return
    }
    setBusyKey(`mark:${student.id}`)
    try {
      const res = await fetch("/api/admin-attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "mark_present", studentId: student.id, batch, date, sessionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "We couldn't mark this student present.")
      successRef.current(`${student.name} marked Present.`)
      setDetailRow(null)
      await loadOverview()
    } catch (error) {
      showErrorRef.current(error.message || "We couldn't mark this student present.")
    } finally {
      setBusyKey("")
    }
  }

  async function rematchAll() {
    const rows = overview?.unlinked || []
    if (!rows.length) return
    setBusyKey("rematch-all")
    try {
      const res = await fetch("/api/admin-attendance/unlinked", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "rematch", ids: rows.map(row => row.id) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "We couldn't check these names again.")
      const next = {}
      for (const result of data.results || []) next[result.unlinkedId] = result
      setRematchResults(next)
      const matched = (data.results || []).filter(result => result.studentId).length
      successRef.current(matched ? `${matched} name${matched === 1 ? "" : "s"} now have a suggested student.` : "No safe new matches were found.")
    } catch (error) {
      showErrorRef.current(error.message || "We couldn't check these names again.")
    } finally {
      setBusyKey("")
    }
  }

  async function linkOne({ id, studentId, correctedDisplayName, rememberAlias }) {
    setBusyKey(`link:${id}`)
    try {
      const res = await fetch("/api/admin-attendance/unlinked", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "link", id, studentId, correctedDisplayName, rememberAlias }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "We couldn't save this match.")
      successRef.current("Attendance linked and marked Present.")
      setResolvingRow(null)
      await loadOverview()
    } catch (error) {
      showErrorRef.current(error.message || "We couldn't save this match.")
    } finally {
      setBusyKey("")
    }
  }

  async function dismissOne(id) {
    setBusyKey(`dismiss:${id}`)
    try {
      const res = await fetch("/api/admin-attendance/unlinked", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: "dismiss", ids: [id] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "We couldn't dismiss this name.")
      successRef.current("Name left out of the class attendance.")
      setResolvingRow(null)
      await loadOverview()
    } catch (error) {
      showErrorRef.current(error.message || "We couldn't dismiss this name.")
    } finally {
      setBusyKey("")
    }
  }

  function handleUploadDone(result) {
    setUploadOpen(false)
    if (result?.batch) setBatch(result.batch)
    if (result?.date) setDate(result.date)
    if (result?.sessionId) setSessionId(result.sessionId)
    successRef.current("Attendance uploaded. The class overview is refreshed.")
  }

  const counts = overview?.counts || { present: 0, pendingRequests: 0, needsAttention: 0, notRecorded: 0, registered: 0, recorded: 0 }
  const requests = overview?.requests || []
  const needsAttention = overview?.unlinked || []
  const hasIssues = requests.length > 0 || needsAttention.length > 0
  const hasClass = Boolean(batch && date)
  const hasSelectedSession = Boolean(overview?.selectedSessionId)

  return (
    <div className="attendance-workspace">
      <header className="portal-page-header attendance-page-header">
        <div className="portal-page-header-copy">
          <p className="portal-eyebrow">Daily class view</p>
          <h1 className="portal-page-title">Attendance</h1>
          <p className="portal-page-subtitle">View class attendance, upload Teams reports, and resolve attendance issues.</p>
        </div>
        <div className="portal-page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>Upload Attendance</button>
          <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>History</button>
        </div>
      </header>

      <section className="card admin-panel attendance-filter-bar" aria-label="Attendance filters">
        <div className="attendance-filter-heading">
          <div><h2 className="section-heading-title">Choose a class</h2><p className="section-heading-detail">Select the batch and date you want to check.</p></div>
          {hasSelectedSession && <span className="portal-chip">{sessionLabel(selectedSession)}</span>}
        </div>
        <div className="attendance-filter-grid attendance-filter-grid-primary">
          <label className="attendance-field-label">Batch *<SearchableBatchSelect batches={batchNames} value={batch} onChange={selectBatch} placeholder="Select batch" label="Batch" required /></label>
          <label className="attendance-field-label">Date *<input className="input" type="date" value={date} onChange={selectDate} aria-label="Attendance date" required /></label>
          {sessions.length > 1 && <label className="attendance-field-label">Session<select className="select" value={sessionId} onChange={event => { setSessionId(event.target.value); setRosterFilter("all") }} aria-label="Attendance session"><option value="">Choose a class session</option>{sessions.map(session => <option key={session.id} value={session.id}>{sessionLabel(session)}</option>)}</select></label>}
        </div>
      </section>

      {!hasClass ? (
        <div className="card admin-panel"><EmptyState icon="◷" title="Select a batch and date to view attendance." message="Your class overview will appear here." /></div>
      ) : loading && !overview ? (
        <div className="card admin-panel flex justify-center"><Spinner size="lg" /></div>
      ) : overview && !hasSelectedSession && sessions.length > 1 ? (
        <div className="card admin-panel"><EmptyState icon="◷" title="Choose a class session." message="This batch has more than one class on this date." /></div>
      ) : overview && !hasSelectedSession && sessions.length === 0 ? (
        <div className="card admin-panel"><EmptyState icon="◷" title="No class session found for this date." message="Upload a Teams report to create the class session and start the attendance record." action={<button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>Upload Attendance</button>} /></div>
      ) : overview ? (
        <>
          <section className="attendance-summary-grid" aria-label="Attendance summary">
            <MetricCard label="Present" value={counts.present} hint={`${counts.recorded} of ${counts.registered} recorded`} tone="success" onClick={() => setRosterFilter("present")} />
            <MetricCard label="Pending Requests" value={counts.pendingRequests} hint="Student requests to review" tone="warning" onClick={() => setRosterFilter("pending")} />
            <MetricCard label="Needs Attention" value={counts.needsAttention} hint="Names or requests to resolve" tone="warning" onClick={() => { setRosterFilter("all"); requestAnimationFrame(() => actionRequiredRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })) }} />
            <MetricCard label="Not Recorded" value={counts.notRecorded} hint={`${counts.recorded} of ${counts.registered} recorded`} onClick={() => setRosterFilter("not_recorded")} />
          </section>

          <section className="card admin-panel" aria-labelledby="attendance-roster-heading">
            <div className="section-heading">
              <div className="section-heading-copy"><h2 id="attendance-roster-heading" className="section-heading-title">Class attendance</h2><p className="section-heading-detail">{counts.recorded} of {counts.registered} registered students recorded for {sessionLabel(selectedSession)}.</p></div>
              <div className="attendance-roster-tools"><input className="input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search student..." aria-label="Search student" /><button type="button" className="btn btn-secondary btn-sm" onClick={loadOverview} disabled={loading}>{loading ? <Spinner size="sm" /> : "Refresh"}</button></div>
            </div>
            {filteredRoster.length === 0 ? <EmptyState icon="✓" title={rosterFilter === "all" ? "No attendance has been recorded for this class yet." : "No students match this view."} message={rosterFilter === "all" ? "Upload a Teams report or mark a student Present." : "Try another summary card or search."} /> : (
              <div className="attendance-roster" role="list" aria-label="Student attendance roster">
                {filteredRoster.map(row => {
                  const attendance = row.attendance || {}
                  const busy = busyKey === `mark:${row.student?.id}` || busyKey === `approve:${attendance.id}` || busyKey === `reject:${attendance.id}`
                  return (
                    <div className="attendance-roster-row" key={row.student.id} role="listitem">
                      <button type="button" className="attendance-roster-main" onClick={() => setDetailRow(row)} aria-label={`View attendance details for ${row.student?.name || "student"}`}>
                        <span className="attendance-student-name">{row.student?.name || "Inactive student"}</span>
                        <span className={`${statusClass(row.status)} attendance-status`}>{statusLabel(row.status)}</span>
                        <span className="attendance-source">{attendance.source ? sourceLabel(attendance.source) : "—"}</span>
                      </button>
                      <div className="attendance-roster-actions">
                        {row.status === "pending" && <><button type="button" className="btn btn-primary btn-xs" onClick={() => reviewAttendance(row, "approve")} disabled={busy || !attendance.session_id} title={!attendance.session_id ? "Resolve the class session first" : undefined}>Approve</button><button type="button" className="btn btn-danger-outline btn-xs" onClick={() => reviewAttendance(row, "reject")} disabled={busy}>Reject</button></>}
                        {row.status === "not_recorded" && <button type="button" className="btn btn-primary btn-xs" onClick={() => markPresent(row)} disabled={busy || !sessionId}>Mark Present</button>}
                        {row.status !== "pending" && row.status !== "not_recorded" && <button type="button" className="btn btn-secondary btn-xs" onClick={() => setDetailRow(row)}>View</button>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="card admin-panel attendance-action-required" ref={actionRequiredRef} aria-labelledby="attendance-action-heading">
            <div className="section-heading"><div className="section-heading-copy"><h2 id="attendance-action-heading" className="section-heading-title">Action Required</h2><p className="section-heading-detail">Only attendance that needs a decision appears here.</p></div>{hasIssues && <button type="button" className="btn btn-secondary btn-sm" onClick={rematchAll} disabled={busyKey === "rematch-all" || !needsAttention.length}>{busyKey === "rematch-all" ? <Spinner size="sm" /> : "Check names again"}</button>}</div>
            {!hasIssues ? <EmptyState icon="✓" title="No attendance issues require attention." message="Everything is matched and up to date." /> : <div className="attendance-action-groups">
              {requests.length > 0 && <div className="attendance-action-group"><h3>Student Requests <span className="portal-chip">{requests.length}</span></h3>{requests.map(row => <div className="attendance-action-row" key={row.id}><div className="min-w-0"><p className="font-semibold">{row.student?.name || "Student"}</p><p className="text-xs mt-1" style={{ color: "var(--portal-text-muted)" }}>{row.attendance_date} · {row.session_id ? sessionLabel(sessions.find(item => String(item.id) === String(row.session_id))) : "Session required"}</p><p className="text-sm mt-2" style={{ color: "var(--portal-text-secondary)" }}>{row.review_note || "Student requested attendance review."}</p></div><div className="flex items-center gap-2 flex-wrap justify-end"><button type="button" className="btn btn-secondary btn-xs" onClick={() => setDetailRow({ ...row, status: "pending", student: row.student })}>View</button>{!row.session_id && <select className="select attendance-action-session" value={sessionSelections[row.id] || ""} onChange={event => setSessionSelections(previous => ({ ...previous, [row.id]: event.target.value }))} aria-label={`Choose session for ${row.student?.name || "student"}`}><option value="">Resolve Session</option>{(row.available_sessions || sessions).map(item => <option key={item.id} value={item.id}>{sessionLabel(item)}</option>)}</select>}<button type="button" className="btn btn-primary btn-xs" onClick={() => reviewAttendance(row, "approve")} disabled={Boolean(busyKey) || (!row.session_id && !sessionSelections[row.id])}>Approve</button><button type="button" className="btn btn-danger-outline btn-xs" onClick={() => reviewAttendance(row, "reject")} disabled={Boolean(busyKey)}>Reject</button></div></div>)}</div>}
              {needsAttention.length > 0 && <div className="attendance-action-group"><h3>Unmatched Participants <span className="portal-chip">{needsAttention.length}</span></h3>{needsAttention.map(row => { const suggestion = rematchResults[row.id]; return <div className="attendance-action-row" key={row.id}><div className="min-w-0"><p className="font-semibold">{row.original_participant_name || row.participant_name}</p><p className="text-xs mt-1" style={{ color: "var(--portal-text-muted)" }}>{row.batch} · {row.attendance_date}</p><p className="text-sm mt-2" style={{ color: suggestion?.studentId ? "var(--portal-success)" : "var(--portal-text-secondary)" }}>{suggestion?.studentId ? `Suggested student: ${suggestion.studentName}` : "This participant could not be safely matched to a registered student."}</p></div><div className="flex items-center gap-2 flex-wrap justify-end">{suggestion?.studentId && <button type="button" className="btn btn-primary btn-xs" onClick={() => linkOne({ id: row.id, studentId: suggestion.studentId })} disabled={Boolean(busyKey) || !row.session_id}>Accept Match</button>}<button type="button" className="btn btn-secondary btn-xs" onClick={() => setResolvingRow({ ...row, suggestion })} disabled={Boolean(busyKey)}>Choose Student</button><button type="button" className="btn btn-secondary btn-xs" onClick={() => dismissOne(row.id)} disabled={Boolean(busyKey)}>Dismiss</button>{!row.session_id && <span className="badge-pending">Session required</span>}</div></div> })}</div>}
            </div>}
          </section>
        </>
      ) : null}

      {uploadOpen && <div className="attendance-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setUploadOpen(false) }}><div className="attendance-modal" role="dialog" aria-modal="true" aria-label="Upload attendance"><div className="attendance-modal-header"><div><p className="portal-eyebrow">Attendance upload</p><h2 className="portal-page-title">Upload Attendance</h2></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setUploadOpen(false)}>Close</button></div><AttendanceUpload token={adminToken} batches={batchNames} initialBatch={batch} initialDate={date} role="admin" onUploaded={() => {}} onNeedsAttention={() => { setUploadOpen(false); setRosterFilter("needs"); requestAnimationFrame(() => actionRequiredRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })) }} onDone={handleUploadDone} /></div></div>}
      {historyOpen && <div className="attendance-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setHistoryOpen(false) }}><div className="attendance-modal attendance-history-modal" role="dialog" aria-modal="true" aria-label="Attendance history"><div className="attendance-modal-header"><div><p className="portal-eyebrow">Secondary view</p><h2 className="portal-page-title">History</h2></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setHistoryOpen(false)}>Close</button></div><AttendanceImportHistory token={adminToken} batches={batchNames} /></div></div>}
      <AttendanceDetailDrawer row={detailRow} sessions={sessions} sessionSelection={detailRow ? (sessionSelections[detailRow.id] || sessionId) : ""} onSessionChange={value => detailRow && setSessionSelections(previous => ({ ...previous, [detailRow.id]: value }))} onApprove={() => detailRow && reviewAttendance(detailRow, "approve")} onReject={() => detailRow && reviewAttendance(detailRow, "reject")} onResolveSession={() => detailRow && reviewAttendance(detailRow, "resolve_session")} onMarkPresent={() => detailRow && markPresent(detailRow)} onClose={() => setDetailRow(null)} busy={Boolean(busyKey)} />
      {resolvingRow && <AttendanceResolveDialog token={adminToken} row={resolvingRow} suggestion={resolvingRow.suggestion} onClose={() => setResolvingRow(null)} onResolve={linkOne} onDismiss={dismissOne} />}
    </div>
  )
}
