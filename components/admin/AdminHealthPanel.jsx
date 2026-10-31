"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import AdminCalendarPanel from "@/components/admin/AdminCalendarPanel"
import AdminCourseworkPanel from "@/components/admin/AdminCourseworkPanel"
import AdminCourseworkSetupPanel from "@/components/admin/AdminCourseworkSetupPanel"
import AdminAttendancePanel from "@/components/admin/AdminAttendancePanel"
import RefreshButton from "@/components/ui/RefreshButton"
import Spinner from "@/components/ui/Spinner"
import MetricCard from "@/components/ui/MetricCard"
import SectionHeading from "@/components/ui/SectionHeading"

const TABS = [
  ["overview", "Overview"],
  ["attendance", "Attendance"],
  ["advanced", "Optional Advanced"],
]

export default function AdminHealthPanel({ adminToken, showError, success, batches = [], initialTab = "overview", hideNavigation = false }) {
  const [tab, setTab] = useState(initialTab)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [attendanceFocus, setAttendanceFocus] = useState("")
  const showErrorRef = useRef(showError)

  useEffect(() => { showErrorRef.current = showError }, [showError])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin-health", { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not load Health Card configuration.")
      setData(payload)
    } catch (error) { showErrorRef.current(error.message || "Could not load Health Card configuration.") } finally { setLoading(false) }
  }, [adminToken])

  useEffect(() => { load() }, [load])

  return (
    <div className="grid gap-5">
      {!hideNavigation && <div className="card admin-panel">
        <SectionHeading
          title={hideNavigation ? "Attendance" : "Student Health"}
          detail={hideNavigation ? "Upload class attendance, review student requests, and resolve unmatched names." : "Health Card catalog, calendar, scoring, and attendance operations."}
          action={<RefreshButton onClick={load} disabled={loading} />}
        />
        {!hideNavigation && <div className="tab-list mt-5 mb-0" role="tablist" aria-label="Student Health sections">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>)}</div>}
      </div>}
      {tab === "attendance" && <AdminAttendancePanel adminToken={adminToken} batches={batches} success={success} showError={showError} focusMode={attendanceFocus} />}
      {tab === "advanced" && <div className="grid gap-4"><AdminCourseworkSetupPanel adminToken={adminToken} success={success} showError={showError} /><AdminCourseworkPanel adminToken={adminToken} batches={batches} success={success} showError={showError} /><AdminCalendarPanel adminToken={adminToken} batches={batches} success={success} showError={showError} /></div>}
      {tab === "overview" && (loading ? <div className="card admin-panel flex justify-center"><Spinner size="lg" /></div> : data && <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Total coursework" value={data.counts?.courseworkItems || 0} />
          <MetricCard label="Assignments" value={data.counts?.activeAssignments || 0} hint="Active" tone="primary" />
          <MetricCard label="Projects" value={data.counts?.activeProjects || 0} hint="Active" />
           <MetricCard label="Tracked attendance dates" value={data.counts?.trackedAttendanceDates || 0} />
          <MetricCard label="Needs matching" value={data.counts?.needsMatching || 0} tone="warning" onClick={() => { setAttendanceFocus("needs"); setTab("attendance") }} style={{ cursor: "pointer" }} />
          <MetricCard label="Attendance pending" value={data.counts?.pendingAttendance || 0} tone="warning" onClick={() => { setAttendanceFocus(""); setTab("attendance") }} style={{ cursor: "pointer" }} />
          <MetricCard label="Approved attendance" value={data.counts?.approvedAttendance || 0} tone="success" />
        </div>
        <div className="card admin-panel">
          <SectionHeading title="Health Card overview" detail="Configuration currently used by scoring and attendance." />
           <div className="grid gap-2"><div className="admin-summary-row"><span>Tracked attendance dates</span><b>{data.counts?.trackedAttendanceDates || 0}</b></div><div className="admin-summary-row"><span>Active point rules</span><b>{data.counts?.activePointRules || 0}</b></div><div className="admin-summary-row"><span>Timezone</span><b>{data.timezone}</b></div></div>
          <p className="text-xs mt-4" style={{ color: "var(--portal-text-muted)" }}>AI evaluation scores remain separate from Health Card points.</p>
        </div>
      </>)}
    </div>
  )
}
