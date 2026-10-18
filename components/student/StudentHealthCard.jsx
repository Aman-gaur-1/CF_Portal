"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import EmptyState from "@/components/ui/EmptyState"
import MetricCard from "@/components/ui/MetricCard"
import PageHeader from "@/components/ui/PageHeader"
import SectionHeading from "@/components/ui/SectionHeading"
import RefreshButton from "@/components/ui/RefreshButton"

function numeric(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function percent(value, denominator = null) {
  if (denominator !== null && (!(Number(denominator) > 0))) return "Not available"
  if (value === null || value === undefined || value === "") return "Not available"
  const parsed = Number(value)
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : "Not available"
}

function progress(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : 0
}

function statusClass(status) {
  if (status === "approved") return "badge-done"
  if (status === "rejected") return "badge-failed"
  return "badge-pending"
}

function formatSessionTime(value) {
  if (!value) return "Time to be announced"
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value))
  } catch {
    return "Time to be announced"
  }
}

function sessionWindow(session) {
  if (!session?.startsAt) return session?.title || "Attendance session"
  const start = formatSessionTime(session.startsAt)
  const end = session.endsAt ? ` – ${formatSessionTime(session.endsAt)}` : ""
  return `${session.title || "Attendance session"} · ${start}${end}`
}

function MetricProgress({ label, completed, expected, pending, percentage, emptyMessage }) {
  if (!(Number(expected) > 0)) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{label}</span>
          <span style={{ color: "var(--text-secondary)" }}>{emptyMessage}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span style={{ color: "var(--text-secondary)" }}>{completed} / {expected} · {percent(percentage, expected)} · {pending} pending</span>
      </div>
      <div className="progress-bar-wrap" aria-label={`${label} progress`}>
        <div className="progress-bar-fill" style={{ width: `${progress(percentage)}%` }} />
      </div>
    </div>
  )
}

export default function StudentHealthCard({ student, success, showError }) {
  const [healthCard, setHealthCard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [todaySessions, setTodaySessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [selectedSessionId, setSelectedSessionId] = useState("")
  const [marking, setMarking] = useState(false)
  const [showQuery, setShowQuery] = useState(false)
  const [queryDate, setQueryDate] = useState("")
  const [queryReason, setQueryReason] = useState("")
  const [submittingQuery, setSubmittingQuery] = useState(false)
  const showErrorRef = useRef(showError)

  useEffect(() => { showErrorRef.current = showError }, [showError])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/student-health", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${student.token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load Student Health Card.")
      setHealthCard(data.healthCard || null)
    } catch (error) {
      showErrorRef.current(error.message || "Could not load Student Health Card.")
    } finally {
      setLoading(false)
    }
  }, [student.token])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const res = await fetch("/api/student-attendance", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${student.token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load eligible attendance sessions.")
      const sessions = Array.isArray(data.sessions) ? data.sessions : []
      setTodaySessions(sessions)
      setSelectedSessionId(current => {
        if (sessions.some(session => String(session.id) === String(current))) return current
        return String(sessions.find(session => !session.alreadyMarked)?.id || sessions[0]?.id || "")
      })
    } catch (error) {
      showErrorRef.current(error.message || "Could not load eligible attendance sessions.")
      setTodaySessions([])
      setSelectedSessionId("")
    } finally {
      setLoadingSessions(false)
    }
  }, [student.token])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadSessions() }, [loadSessions])

  async function markAttendance() {
    if (marking) return
    setMarking(true)
    try {
      const res = await fetch("/api/student-attendance", {
        method: "POST",
        headers: { Authorization: `Bearer ${student.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: selectedSessionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not mark attendance.")
      success("Attendance marked and sent for mentor approval.")
      await Promise.all([load(), loadSessions()])
    } catch (error) {
      showErrorRef.current(error.message || "Could not mark attendance.")
    } finally {
      setMarking(false)
    }
  }

  async function submitAttendanceQuery(e) {
    e.preventDefault()
    if (submittingQuery || !queryDate) return
    setSubmittingQuery(true)
    try {
      const res = await fetch("/api/student-attendance", {
        method: "POST",
        headers: { Authorization: `Bearer ${student.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ date: queryDate, reason: queryReason.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not submit attendance request.")
      success("Attendance issue submitted for teacher review.")
      setQueryDate("")
      setQueryReason("")
      setShowQuery(false)
      await load()
    } catch (error) {
      showErrorRef.current(error.message || "Could not submit attendance request.")
    } finally {
      setSubmittingQuery(false)
    }
  }

  if (loading) return <div className="card health-card-panel flex justify-center" aria-busy="true"><Spinner size="lg" /></div>
  if (!healthCard) return <EmptyState icon="♥" title="Student Health Card unavailable" message="Please try again shortly." action={<button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>} />

  const metrics = healthCard.metrics || {}
  const leaderboard = healthCard.leaderboard || {}
  const top10 = Array.isArray(leaderboard.top10) ? leaderboard.top10 : []
  const recentActivity = Array.isArray(healthCard.recentActivity) ? healthCard.recentActivity : []
  const attendanceHistory = Array.isArray(healthCard.attendanceHistory) ? healthCard.attendanceHistory : []
  const currentRank = numeric(metrics.rank, 0)
  const assignmentExpected = numeric(metrics.assignmentExpected)
  const projectExpected = numeric(metrics.projectExpected)
  const eligibleWorkingDays = numeric(metrics.eligibleWorkingDays)
  const selectedSession = todaySessions.find(session => String(session.id) === String(selectedSessionId)) || null
  const canMarkSelectedSession = Boolean(selectedSession && !selectedSession.alreadyMarked)

  return (
    <div className="health-card-layout">
      <section className="card health-card-panel health-card-hero">
        <PageHeader
          eyebrow="Student Health Card"
          title={healthCard.student?.name || student.name}
          subtitle="A clear view of coursework progress, attendance, and your standing in the batch."
          meta={<><span className="portal-chip">{healthCard.student?.batch || student.batch}</span><span className="portal-chip">Points tracked from 1 Oct 2026</span></>}
          actions={<RefreshButton onClick={load} disabled={loading} />}
        />
        <div className="health-card-kpis">
          <MetricCard label="Total points" value={numeric(metrics.totalPoints)} hint="Health Card points since 1 Oct 2026" tone="primary" />
          <MetricCard label="Batch rank" value={currentRank ? `#${currentRank}` : "—"} hint="Current position" />
          <MetricCard label="Attendance" value={percent(metrics.attendancePercentage, eligibleWorkingDays)} hint={`${numeric(metrics.approvedAttendanceDays)} approved`} />
          <MetricCard label="Assignments" value={assignmentExpected > 0 ? percent(metrics.assignmentCompletionPercentage, assignmentExpected) : "—"} hint={assignmentExpected > 0 ? `${numeric(metrics.assignmentCompleted)} / ${assignmentExpected}` : "No assignments configured yet"} />
          <MetricCard label="Projects" value={projectExpected > 0 ? percent(metrics.projectCompletionPercentage, projectExpected) : "—"} hint={projectExpected > 0 ? `${numeric(metrics.projectCompleted)} / ${projectExpected}` : "No projects configured yet"} />
        </div>
      </section>

      <section className="card health-card-panel">
        <SectionHeading title="Points breakdown" detail="Earned from coursework and approved attendance." />
        <div className="health-card-points">
          <MetricCard label="Assignment points" value={numeric(metrics.assignmentPoints)} tone="primary" />
          <MetricCard label="Project points" value={numeric(metrics.projectPoints)} />
          <MetricCard label="Attendance points" value={numeric(metrics.attendancePoints)} tone="success" />
        </div>
      </section>

      <div className="health-card-progress-grid">
        <section className="card health-card-panel">
          <SectionHeading title="Assignments" detail="Completion against expected work." />
          <MetricProgress label="Completion" completed={numeric(metrics.assignmentCompleted)} expected={assignmentExpected} pending={numeric(metrics.assignmentPending)} percentage={metrics.assignmentCompletionPercentage} emptyMessage="No assignments configured yet" />
          <p className="text-xs mt-4" style={{ color: "var(--portal-text-secondary)" }}>Points earned: {numeric(metrics.assignmentPoints)} · {numeric(metrics.assignmentPending)} pending</p>
        </section>
        <section className="card health-card-panel">
          <SectionHeading title="Projects" detail="Completion against expected work." />
          <MetricProgress label="Completion" completed={numeric(metrics.projectCompleted)} expected={projectExpected} pending={numeric(metrics.projectPending)} percentage={metrics.projectCompletionPercentage} emptyMessage="No projects configured yet" />
          <p className="text-xs mt-4" style={{ color: "var(--portal-text-secondary)" }}>Points earned: {numeric(metrics.projectPoints)} · {numeric(metrics.projectPending)} pending</p>
        </section>
      </div>

      <section className="card health-card-panel">
        <div className="health-card-attendance-head">
          <SectionHeading title="Attendance" detail="Attendance is based on your eligible class sessions." />
          <span className="portal-chip">Asia/Kolkata</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Approved" value={numeric(metrics.approvedAttendanceDays)} tone="success" />
          <MetricCard label="Pending" value={numeric(metrics.pendingAttendanceDays)} tone="warning" />
          <MetricCard label="Rejected" value={numeric(metrics.rejectedAttendanceDays)} />
          <MetricCard label="Eligible days" value={numeric(metrics.eligibleWorkingDays)} />
        </div>
        <div className="grid gap-2 mt-5">
          <div className="flex items-center justify-between gap-3 text-sm"><span>Attendance percentage</span><b>{percent(metrics.attendancePercentage, eligibleWorkingDays)}</b></div>
          <div className="progress-bar-wrap"><div className="progress-bar-fill" style={{ width: `${progress(metrics.attendancePercentage)}%` }} /></div>
        </div>
        <div className="health-card-attendance-cta">
          <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>New attendance stays pending until a teacher reviews it.</p>
          {loadingSessions ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--portal-text-secondary)" }}><Spinner size="sm" /> Loading eligible sessions…</div>
          ) : todaySessions.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>No eligible class session is available today. Attendance can be marked after a session is scheduled.</p>
          ) : (
            <label className="grid gap-2 text-sm" style={{ color: "var(--portal-text-secondary)" }}>
              Eligible class session
              <select className="input" value={selectedSessionId} onChange={event => setSelectedSessionId(event.target.value)} aria-label="Eligible class session">
                {todaySessions.map(session => <option key={session.id} value={session.id}>{sessionWindow(session)}{session.alreadyMarked ? " · already submitted" : ""}</option>)}
              </select>
            </label>
          )}
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-primary" type="button" onClick={markAttendance} disabled={marking || loadingSessions || !canMarkSelectedSession}>{marking ? <Spinner size="sm" /> : selectedSession?.alreadyMarked ? "Attendance already submitted" : "Mark selected session"}</button>
            <button className="btn btn-secondary" type="button" onClick={() => setShowQuery(v => !v)}>{showQuery ? "Cancel" : "Report attendance issue"}</button>
          </div>
        </div>
        {showQuery && (
          <form className="health-card-query-form" onSubmit={submitAttendanceQuery}>
            <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>Request attendance for a past date (up to 14 days back). Your teacher will review it.</p>
            <div className="health-card-query-fields">
              <input className="input" type="date" value={queryDate} onChange={e => setQueryDate(e.target.value)} required aria-label="Missing attendance date" />
              <input className="input" value={queryReason} onChange={e => setQueryReason(e.target.value)} placeholder="Reason (optional)" maxLength={500} aria-label="Reason for missing attendance" />
              <button type="submit" className="btn btn-primary btn-sm" disabled={submittingQuery || !queryDate}>{submittingQuery ? <Spinner size="sm" /> : "Submit request"}</button>
            </div>
          </form>
        )}
        <div className="health-card-history">
          <SectionHeading title="Attendance history" detail="Recent attendance records and review status." />
          {attendanceHistory.length === 0 ? <p className="text-sm" style={{ color: "var(--portal-text-muted)" }}>No attendance history yet.</p> : (
            <div>
              {attendanceHistory.map(row => (
                <div className="health-card-history-row" key={row.id}>
                  <div><p className="font-semibold">{row.attendance_date}</p><p className="text-xs mt-1" style={{ color: "var(--portal-text-muted)" }}>{row.reviewed_by ? `Reviewed by ${row.reviewed_by}` : "Awaiting teacher review"}</p>{row.review_note && <p className="text-xs mt-1" style={{ color: "var(--portal-text-secondary)" }}>{row.review_note}</p>}</div>
                  <span className={statusClass(row.status)}>{row.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="health-card-lower-grid">
        <section className="card health-card-panel">
          <SectionHeading title="Batch leaderboard" detail="Top 10 in your batch." />
          {top10.length === 0 ? <EmptyState icon="★" title="No ranked activity yet" message="Complete coursework or attendance to appear here." /> : (
            <div className="health-card-list">
              {top10.map(row => {
                const current = String(row.studentId) === String(student.id)
                const displayName = row.name || row.studentName || row.student_name || (current ? "You" : "Student")
                return <div key={row.studentId} className={`health-card-list-row${current ? " is-current" : ""}`}><span className="text-sm"><b>#{row.rank}</b> {displayName}</span><span className="text-sm font-semibold">{row.totalPoints} pts</span></div>
              })}
              {leaderboard.current && currentRank > 10 && <div className="text-sm mt-3" style={{ color: "var(--portal-text-secondary)" }}>Your position: #{currentRank} · {leaderboard.current.totalPoints} pts</div>}
            </div>
          )}
        </section>
        <section className="card health-card-panel">
          <SectionHeading title="Recent activity" detail="Your latest Health Card events." />
          {recentActivity.length === 0 ? <EmptyState icon="◷" title="No activity yet" message="Health Card activity will appear here." /> : (
            <div>
              {recentActivity.map((item, index) => <div key={`${item.type}-${item.occurredAt}-${index}`} className="health-card-activity-row text-sm"><span>{item.type === "attendance" ? "Attendance" : "Coursework"} · {item.title}{item.status ? ` · ${item.status}` : ""}</span><span className="text-xs" style={{ color: "var(--portal-text-muted)" }}>{item.attendanceDate || (item.occurredAt ? String(item.occurredAt).slice(0, 10) : "—")}</span></div>)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
