"use client"

import Spinner from "@/components/ui/Spinner"

const SOURCE_LABELS = {
  teams_report: "Teams Upload",
  student_attendance_query: "Student Request",
  student_self_mark: "Student Request",
  manual_resolution: "Admin",
  admin: "Admin",
  teacher: "Teacher",
  legacy: "Historical record",
}

function formatDateTime(value) {
  return String(value || "").slice(0, 16).replace("T", " ") || "—"
}

function statusLabel(status) {
  if (status === "approved" || status === "present") return "Present"
  if (status === "pending") return "Pending"
  if (status === "rejected") return "Rejected"
  return "Not recorded"
}

export default function AttendanceDetailDrawer({
  row,
  sessions = [],
  sessionSelection = "",
  onSessionChange,
  onApprove,
  onReject,
  onResolveSession,
  onMarkPresent,
  onClose,
  busy = false,
}) {
  if (!row) return null

  const attendance = row.attendance || row
  const student = row.student || attendance.student || {}
  const status = row.status || attendance.status
  const source = SOURCE_LABELS[attendance.source] || "Attendance record"
  const session = sessions.find(item => String(item.id) === String(attendance.session_id))
  const needsSession = status === "pending" && !attendance.session_id

  return (
    <div className="activity-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="activity-drawer" role="dialog" aria-modal="true" aria-label="Attendance details">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Attendance details</p>
            <h2 className="text-xl font-bold">{student.name || "Student"}</h2>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="activity-drawer-section grid gap-2 text-sm">
          <div><b>Student:</b> {student.name || "—"}</div>
          <div><b>Batch:</b> {attendance.batch || student.batch || "—"}</div>
          <div><b>Date:</b> {attendance.attendance_date || "—"}</div>
          <div><b>Session:</b> {session?.title || (attendance.session_id ? "Class session" : "Session required")}</div>
          <div><b>Status:</b> <span className={status === "approved" || status === "present" ? "badge-done" : status === "rejected" ? "badge-failed" : "badge-pending"}>{statusLabel(status)}</span></div>
          <div><b>Source:</b> {source}</div>
          <div><b>Marked at:</b> {formatDateTime(attendance.marked_at)}</div>
          <div><b>Reviewed by:</b> {attendance.reviewed_by || "—"}</div>
        </div>

        {attendance.original_participant_name && attendance.source === "teams_report" && (
          <div className="activity-drawer-section">
            <h3>Uploaded participant</h3>
            <p className="text-sm">{attendance.original_participant_name}</p>
          </div>
        )}

        {attendance.review_note && (
          <div className="activity-drawer-section">
            <h3>Note</h3>
            <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>{attendance.review_note}</p>
          </div>
        )}

        {needsSession && (
          <div className="activity-drawer-section grid gap-3">
            <div>
              <h3>Choose class session</h3>
              <p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>This student request cannot be approved until it is connected to the correct class.</p>
            </div>
            <select className="select" value={sessionSelection} onChange={event => onSessionChange?.(event.target.value)} aria-label="Authoritative class session">
              <option value="">Choose a class session</option>
              {(attendance.available_sessions || sessions).map(item => <option key={item.id} value={item.id}>{item.title}{item.starts_at ? ` · ${String(item.starts_at).slice(11, 16)}` : ""}</option>)}
            </select>
          </div>
        )}

        <div className="activity-drawer-section flex flex-wrap gap-2">
          {status === "pending" && !needsSession && <>
            <button type="button" className="btn btn-primary" onClick={onApprove} disabled={busy}>{busy ? <Spinner size="sm" /> : "Approve"}</button>
            <button type="button" className="btn btn-danger-outline" onClick={onReject} disabled={busy}>Reject</button>
          </>}
          {needsSession && <button type="button" className="btn btn-secondary" onClick={onResolveSession} disabled={busy || !sessionSelection}>{busy ? <Spinner size="sm" /> : "Resolve Session"}</button>}
          {status === "not_recorded" && <button type="button" className="btn btn-primary" onClick={onMarkPresent} disabled={busy}>{busy ? <Spinner size="sm" /> : "Mark Present"}</button>}
        </div>
      </aside>
    </div>
  )
}
