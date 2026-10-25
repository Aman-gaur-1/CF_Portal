"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Tabs from "@/components/ui/Tabs"
import AttendanceTab from "@/components/teacher/AttendanceTab"
import StudentsTab from "@/components/teacher/StudentsTab"
import Spinner from "@/components/ui/Spinner"
import { courseworkIdentity } from "@/lib/coursework-identity"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "attendance", label: "Attendance" },
  { id: "students", label: "Students" },
  { id: "coursework", label: "Coursework" },
]

export default function StudentHealthPanel({ teacherToken, initialTab = "overview", hideNavigation = false }) {
  const [tab, setTab] = useState(initialTab)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedBatch, setSelectedBatch] = useState("")
  const [selectedIds, setSelectedIds] = useState([])
  const [activationPhase, setActivationPhase] = useState("")
  const [activationType, setActivationType] = useState("")
  const [activationSearch, setActivationSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/teacher-curriculum", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${teacherToken}` },
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not load Student Health.")
      setData(payload)
      setSelectedBatch(current => current || payload.batchNames?.[0] || "")
      setError("")
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [teacherToken])

  useEffect(() => { load() }, [load])

  const selectedAssignments = useMemo(
    () => (data?.assignments || []).filter(row => row.batch === selectedBatch),
    [data, selectedBatch]
  )
  const activeIds = new Set(selectedAssignments.filter(row => row.active).map(row => String(row.coursework_item_id)))
  const itemById = new Map((data?.items || []).map(item => [String(item.id), item]))
  const activeKeys = new Set(selectedAssignments.filter(row => row.active).map(row => courseworkIdentity(row.item || itemById.get(String(row.coursework_item_id)))).filter(Boolean))
  const available = (data?.items || []).filter(item => item.active && item.batch == null && ["Python", "Data Analytics", "SQL"].includes(item.phase) && (!activationPhase || item.phase === activationPhase) && (!activationType || item.item_type === activationType) && (!activationSearch || `${item.title} ${item.phase} ${item.item_type}`.toLowerCase().includes(activationSearch.trim().toLowerCase())))

  async function activate() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/teacher-curriculum", {
        method: "POST",
        headers: { Authorization: `Bearer ${teacherToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ batch: selectedBatch, courseworkItemIds: selectedIds }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not activate coursework.")
      setSelectedIds([])
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function setActivation(id, active) {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/teacher-curriculum", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${teacherToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, active }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not update coursework activation.")
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="card p-8 flex justify-center"><Spinner size="lg" /></div>
  if (error && !data) return <div className="card p-6"><p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p></div>

  return (
    <div className="grid gap-4">
      <div className="card admin-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-bold">{hideNavigation ? "Coursework activation" : "Student Health"}</h3>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {hideNavigation ? "Choose a batch, then activate or pause catalog items for that batch." : "Assigned batches only. Attendance, students, and activated coursework stay in one focused workspace."}
            </p>
          </div>
          {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
        </div>
        {!hideNavigation && <Tabs tabs={TABS} active={tab} onChange={setTab} />}
      </div>

      {tab === "overview" && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="stat-card"><div className="stat-label">Assigned batches</div><div className="stat-num">{data?.batchNames?.length || 0}</div></div>
          <div className="stat-card"><div className="stat-label">Active assignments</div><div className="stat-num">{selectedAssignments.filter(row => itemById.get(String(row.coursework_item_id))?.item_type === "assignment" && row.active).length}</div></div>
          <div className="stat-card"><div className="stat-label">Active projects</div><div className="stat-num">{selectedAssignments.filter(row => itemById.get(String(row.coursework_item_id))?.item_type === "project" && row.active).length}</div></div>
          <div className="stat-card"><div className="stat-label">Selected batch</div><div className="stat-num text-base">{selectedBatch || "—"}</div></div>
        </section>
      )}

      {!hideNavigation && tab === "attendance" && <AttendanceTab teacherToken={teacherToken} />}
      {!hideNavigation && tab === "students" && <StudentsTab teacherToken={teacherToken} />}

      {tab === "coursework" && (
        <section className="card admin-panel grid gap-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <select className="select" value={selectedBatch} onChange={event => { setSelectedBatch(event.target.value); setSelectedIds([]) }} aria-label="Activation batch">
              <option value="">Select assigned batch</option>
              {(data?.batchNames || []).map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <select className="select" value={activationPhase} onChange={event => { setActivationPhase(event.target.value); setSelectedIds([]) }} aria-label="Activation phase"><option value="">All phases</option><option value="Python">Python</option><option value="Data Analytics">Data Analytics</option><option value="SQL">SQL</option></select>
            <select className="select" value={activationType} onChange={event => { setActivationType(event.target.value); setSelectedIds([]) }} aria-label="Activation type"><option value="">All types</option><option value="assignment">Assignment</option><option value="project">Project</option></select>
            <input className="input" value={activationSearch} onChange={event => { setActivationSearch(event.target.value); setSelectedIds([]) }} placeholder="Search catalog" aria-label="Search global catalog" />
            <button type="button" className="btn btn-primary" onClick={activate} disabled={saving || !selectedIds.length}>
              {saving ? <Spinner size="sm" /> : `Activate selected (${selectedIds.length})`}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Catalog items are not student work until they are active for the selected batch. Pausing an activation removes it from future expected work without deleting the catalog item.
          </p>
          <div className="grid gap-2">
            {available.map(item => {
              const active = activeIds.has(String(item.id)) || activeKeys.has(courseworkIdentity(item))
              return <label className="admin-row" key={item.id}>
                <span className="flex gap-2 items-start">
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} disabled={active} />
                  <span><b>{item.title}</b><small className="block" style={{ color: "var(--text-muted)" }}>{item.item_type} · {item.phase || "No phase"}{active ? " · active for this batch" : ""}</small></span>
                </span>
                <span className={active ? "badge-done" : "badge-pending"}>{active ? "Active" : "Available"}</span>
              </label>
            })}
            {!available.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No compatible catalog items are available for this assigned batch.</p>}
          </div>
          {selectedAssignments.length > 0 && (
            <div className="grid gap-2">
              <div className="section-divider"><span className="text-sm font-semibold">This batch’s activations</span><div className="line" /></div>
              {selectedAssignments.map(row => {
                const item = itemById.get(String(row.coursework_item_id))
                return (
                  <div className="admin-row" key={row.id}>
                    <span><b>{item?.title || "Coursework item"}</b><small className="block" style={{ color: "var(--text-muted)" }}>{item?.item_type || "Coursework"} · {item?.phase || "No phase"}</small></span>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => setActivation(row.id, !row.active)} disabled={saving}>{row.active ? "Pause" : "Reactivate"}</button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
