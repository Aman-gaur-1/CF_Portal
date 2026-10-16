"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import AdminCalendarPanel from "@/components/admin/AdminCalendarPanel"
import AdminCourseworkPanel from "@/components/admin/AdminCourseworkPanel"
import AdminAttendancePanel from "@/components/admin/AdminAttendancePanel"
import RefreshButton from "@/components/ui/RefreshButton"
import Spinner from "@/components/ui/Spinner"
import MetricCard from "@/components/ui/MetricCard"
import SectionHeading from "@/components/ui/SectionHeading"

const TABS = [
  ["overview", "Overview"],
  ["attendance", "Attendance"],
  ["coursework", "Coursework"],
  ["calendar", "Working Calendar"],
  ["rules", "Point Rules"],
]

export default function AdminHealthPanel({ adminToken, showError, success, batches = [] }) {
  const [tab, setTab] = useState("overview")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
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
      <div className="card admin-panel">
        <SectionHeading
          title="Student Health"
          detail="Health Card catalog, calendar, scoring, and attendance operations."
          action={<RefreshButton onClick={load} disabled={loading} />}
        />
        <div className="tab-list mt-5 mb-0" role="tablist" aria-label="Student Health sections">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      </div>
      {tab === "attendance" && <AdminAttendancePanel adminToken={adminToken} batches={batches} success={success} showError={showError} />}
      {tab === "coursework" && <AdminCourseworkPanel adminToken={adminToken} batches={batches} success={success} showError={showError} />}
      {tab === "calendar" && <AdminCalendarPanel adminToken={adminToken} batches={batches} success={success} showError={showError} />}
      {tab === "overview" && (loading ? <div className="card admin-panel flex justify-center"><Spinner size="lg" /></div> : data && <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Total coursework" value={data.counts?.courseworkItems || 0} />
          <MetricCard label="Assignments" value={data.counts?.activeAssignments || 0} hint="Active" tone="primary" />
          <MetricCard label="Projects" value={data.counts?.activeProjects || 0} hint="Active" />
          <MetricCard label="Working days" value={data.counts?.workingCalendarDays || 0} />
          <MetricCard label="Attendance pending" value={data.counts?.pendingAttendance || 0} tone="warning" />
          <MetricCard label="Approved attendance" value={data.counts?.approvedAttendance || 0} tone="success" />
        </div>
        <div className="card admin-panel">
          <SectionHeading title="Health Card overview" detail="Configuration currently used by scoring and attendance." />
          <div className="grid gap-2"><div className="admin-summary-row"><span>Epoch start</span><b>{data.epochStart}</b></div><div className="admin-summary-row"><span>Calendar entries</span><b>{data.counts?.calendarDays || 0}</b></div><div className="admin-summary-row"><span>Active point rules</span><b>{data.counts?.activePointRules || 0}</b></div><div className="admin-summary-row"><span>Timezone</span><b>{data.timezone}</b></div></div>
          <p className="text-xs mt-4" style={{ color: "var(--portal-text-muted)" }}>AI evaluation scores remain separate from Health Card points.</p>
        </div>
      </>)}
      {tab === "rules" && (loading ? <div className="card admin-panel flex justify-center"><Spinner size="lg" /></div> : data && <div className="card admin-panel"><SectionHeading title="Effective point rules" detail="Rules are applied by activity type and effective date." /><div className="grid gap-2">{(data.pointRules || []).map(rule => <div className="admin-row" key={rule.id}><span className="font-semibold">{rule.activity_type}</span><span className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>{rule.points} pts · from {rule.effective_from}{rule.effective_to ? ` to ${rule.effective_to}` : " onward"}{rule.active ? " · active" : " · inactive"}</span></div>)}</div></div>)}
    </div>
  )
}
