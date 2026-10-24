"use client"

import { useCallback, useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import EmptyState from "@/components/ui/EmptyState"
import MetricCard from "@/components/ui/MetricCard"
import SectionHeading from "@/components/ui/SectionHeading"
import RefreshButton from "@/components/ui/RefreshButton"

function numeric(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function percentage(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : "Not available"
}

function statusClass(status) {
  if (status === "approved") return "badge-done"
  if (status === "rejected") return "badge-failed"
  return "badge-pending"
}

export default function StaffStudentHealthCard({ studentId, token, onClose }) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    if (!studentId || !token) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/staff-student-health/${encodeURIComponent(studentId)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load Student Health Card.")
      setPayload(data)
    } catch (err) {
      setError(err.message || "Could not load Student Health Card.")
    } finally {
      setLoading(false)
    }
  }, [studentId, token])

  useEffect(() => { load() }, [load])

  const student = payload?.student || {}
  const card = payload?.healthCard || {}
  const metrics = card.metrics || {}
  const leaderboard = card.leaderboard || {}
  const top10 = Array.isArray(leaderboard.top10) ? leaderboard.top10 : []
  const attendanceHistory = Array.isArray(card.attendanceHistory) ? card.attendanceHistory : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.45)" }} role="dialog" aria-modal="true" aria-label="Student Health Card">
      <div className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Student Health Card</p>
            <h2 className="text-xl font-bold mt-1">{student.name || "Student"}</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{student.batch || "No batch"} · Coursework points determine leaderboard rank.</p>
          </div>
          <div className="flex gap-2">
            <RefreshButton onClick={load} disabled={loading} />
            <button className="btn btn-secondary btn-sm" type="button" onClick={onClose}>Close</button>
          </div>
        </div>

        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : error ? <EmptyState title="Health Card unavailable" message={error} action={<button className="btn btn-secondary btn-sm" type="button" onClick={load}>Retry</button>} /> : (
          <div className="grid gap-5">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard label="Coursework points" value={numeric(metrics.courseworkPoints, numeric(metrics.assignmentPoints) + numeric(metrics.projectPoints))} hint="Assignment + project" tone="primary" />
              <MetricCard label="Health Card total" value={numeric(metrics.totalPoints)} hint="Coursework + attendance" tone="success" />
              <MetricCard label="Rank" value={metrics.rank ? `#${metrics.rank}` : "—"} hint="Batch rank" />
              <MetricCard label="Assignments" value={`${numeric(metrics.assignmentCompleted)} / ${numeric(metrics.assignmentExpected)}`} hint={`${numeric(metrics.assignmentPending)} pending`} />
              <MetricCard label="Projects" value={`${numeric(metrics.projectCompleted)} / ${numeric(metrics.projectExpected)}`} hint={`${numeric(metrics.projectPending)} pending`} />
              <MetricCard label="Attendance" value={percentage(metrics.attendancePercentage)} hint={`${numeric(metrics.approvedAttendanceDays)} present`} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <section className="card health-card-panel">
                <SectionHeading title="Coursework progress" detail="Assignments are 5 points; projects are 10 points." />
                <div className="grid gap-3 mt-3">
                  <div className="admin-summary-row"><span>Assignment points</span><b>{numeric(metrics.assignmentPoints)}</b></div>
                  <div className="admin-summary-row"><span>Project points</span><b>{numeric(metrics.projectPoints)}</b></div>
                  <div className="admin-summary-row"><span>Assignments pending</span><b>{numeric(metrics.assignmentPending)}</b></div>
                  <div className="admin-summary-row"><span>Projects pending</span><b>{numeric(metrics.projectPending)}</b></div>
                </div>
              </section>
              <section className="card health-card-panel">
                <SectionHeading title="Attendance" detail="Attendance adds to the Health Card total, not leaderboard rank." />
                <div className="grid gap-3 mt-3">
                  <div className="admin-summary-row"><span>Present</span><b>{numeric(metrics.approvedAttendanceDays)}</b></div>
                  <div className="admin-summary-row"><span>Pending review</span><b>{numeric(metrics.pendingAttendanceDays)}</b></div>
                  <div className="admin-summary-row"><span>Eligible days</span><b>{numeric(metrics.eligibleWorkingDays)}</b></div>
                  <div className="admin-summary-row"><span>Percentage</span><b>{percentage(metrics.attendancePercentage)}</b></div>
                </div>
              </section>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <section className="card health-card-panel">
                <SectionHeading title="Batch leaderboard" detail="Top 10 · assignment and project points only." />
                {top10.length === 0 ? <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>No ranked coursework yet.</p> : <div className="grid gap-2 mt-3">{top10.map(row => <div className={`admin-summary-row${String(row.studentId) === String(student.id) ? " is-current" : ""}`} key={row.studentId}><span>#{row.rank} {row.name || row.studentName || "Student"}</span><b>{row.totalPoints} pts</b></div>)}</div>}
              </section>
              <section className="card health-card-panel">
                <SectionHeading title="Attendance history" detail="Recent review status." />
                {attendanceHistory.length === 0 ? <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>No attendance history yet.</p> : <div className="grid gap-2 mt-3">{attendanceHistory.slice(0, 8).map(row => <div className="admin-summary-row" key={row.id}><span>{row.attendance_date}</span><span className={statusClass(row.status)}>{row.status}</span></div>)}</div>}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
