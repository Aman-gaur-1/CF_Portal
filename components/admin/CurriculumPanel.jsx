"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import BatchProgressControls from "@/components/coursework/BatchProgressControls"
import { courseworkIdentity } from "@/lib/coursework-identity"

const PHASES = ["Python", "Data Analytics", "SQL"]
const EMPTY_DATA = { items: [], canonicalItems: [], activations: [], assignments: [], progress: [], extras: [], canonicalSummary: {}, activeStudentCount: 0 }

export default function CurriculumPanel({ adminToken, batches = [], success, showError }) {
  const [data, setData] = useState(EMPTY_DATA)
  const [batch, setBatch] = useState(batches[0]?.name || "")
  const [activationPhase, setActivationPhase] = useState("")
  const [activationType, setActivationType] = useState("")
  const [activationSearch, setActivationSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState([])
  const [mappingSelection, setMappingSelection] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin-curriculum${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not load curriculum.")
      setData({ ...EMPTY_DATA, ...payload })
    } catch (error) {
      showError(error.message)
    } finally {
      setLoading(false)
    }
  }, [adminToken, batch, showError])

  useEffect(() => { load() }, [load])

  const canonicalItems = useMemo(() => (data.canonicalItems || data.items || []).filter(item => item.catalog_status === "canonical" && item.active && item.batch == null), [data.canonicalItems, data.items])
  const activeIds = useMemo(() => new Set((data.activations || []).filter(row => row.active).map(row => String(row.coursework_item_id))), [data.activations])
  const activeKeys = useMemo(() => new Set((data.activations || []).filter(row => row.active).map(row => courseworkIdentity(row.item || data.items.find(item => item.id === row.coursework_item_id))).filter(Boolean)), [data.activations, data.items])
  const phaseSummary = useMemo(() => PHASES.map(phase => {
    const phaseItems = canonicalItems.filter(item => item.phase === phase)
    const active = phaseItems.filter(item => activeIds.has(String(item.id)) || activeKeys.has(courseworkIdentity(item))).length
    return { phase, active, available: Math.max(phaseItems.length - active, 0), assignments: phaseItems.filter(item => item.item_type === "assignment").length, projects: phaseItems.filter(item => item.item_type === "project").length }
  }), [activeIds, activeKeys, canonicalItems])
  const available = canonicalItems.filter(item => (!activationPhase || item.phase === activationPhase) && (!activationType || item.item_type === activationType) && (!activationSearch || `${item.title} ${item.phase} ${item.item_type}`.toLowerCase().includes(activationSearch.trim().toLowerCase())))

  async function activate() {
    if (!batch || !selectedIds.length) { showError("Select a batch and at least one canonical item."); return }
    setSaving(true)
    try {
      const response = await fetch("/api/admin-curriculum", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ action: "activate", batch, courseworkItemIds: selectedIds }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not activate coursework.")
      success("Canonical coursework activated for the selected batch.")
      setSelectedIds([])
      await load()
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  async function updateExtra(aliasId, action, canonicalCourseworkItemId = "") {
    if (action === "map-extra" && !canonicalCourseworkItemId) { showError("Select a canonical target before mapping."); return }
    setSaving(true)
    try {
      const response = await fetch("/api/admin-curriculum", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ action, aliasId, canonicalCourseworkItemId }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not update the Extra.")
      success(action === "map-extra" ? "Legacy alias mapped to canonical coursework." : "Extra retained for review.")
      await load()
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  async function setActivation(id, active) {
    setSaving(true)
    try {
      const response = await fetch("/api/admin-curriculum", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ id, active }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not update activation.")
      await load()
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  return <div className="grid gap-4">
    <section className="card admin-panel grid gap-3">
      <div>
        <h3 className="text-lg font-bold">Canonical curriculum · 47 items</h3>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>The supplied curriculum is authoritative. Legacy titles remain preserved as historical evidence and are reviewed separately under Extras.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2" aria-label="Canonical curriculum summary">
        {phaseSummary.map(summary => <div className="stat-card" key={summary.phase}><div className="stat-label">{summary.phase}</div><div className="text-sm mt-1">{summary.assignments} Assignments · {summary.projects} Projects</div><div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Active for batch: {summary.active}</div></div>)}
      </div>
    </section>

    <section className="card admin-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Activate canonical coursework for a batch</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>Only canonical items can create expected or pending student work. Existing legacy activations remain visible for continuity.</p></div><RefreshButton onClick={load} disabled={loading} /></div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-4">
        <select className="select" value={batch} onChange={event => { setBatch(event.target.value); setSelectedIds([]) }}><option value="">Select batch</option>{batches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
        <select className="select" value={activationPhase} onChange={event => { setActivationPhase(event.target.value); setSelectedIds([]) }} aria-label="Activation phase"><option value="">All phases</option>{PHASES.map(phase => <option key={phase} value={phase}>{phase}</option>)}</select>
        <select className="select" value={activationType} onChange={event => { setActivationType(event.target.value); setSelectedIds([]) }} aria-label="Activation type"><option value="">All types</option><option value="assignment">Assignment</option><option value="project">Project</option></select>
        <input className="input" value={activationSearch} onChange={event => { setActivationSearch(event.target.value); setSelectedIds([]) }} placeholder="Search canonical curriculum" aria-label="Search canonical curriculum" />
        <button className="btn btn-primary" type="button" onClick={activate} disabled={saving || !selectedIds.length || !batch}>Activate selected ({selectedIds.length})</button>
        <span className="text-xs self-center" style={{ color: "var(--text-muted)" }}>{available.length} canonical item(s)</span>
      </div>
      {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : <div className="grid gap-2 mt-4">{available.map(item => { const active = activeIds.has(String(item.id)) || activeKeys.has(courseworkIdentity(item)); return <label className="admin-row" key={item.id}><span className="flex items-center gap-2"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} disabled={active} /><span><b>{item.title}</b><small className="block" style={{ color: "var(--text-muted)" }}>{item.item_type} · {item.phase} · #{item.sort_order} {active ? "· active for this batch" : ""}</small></span></span><span className={active ? "badge-done" : "badge-pending"}>{active ? "Active" : "Available"}</span></label> })}{!available.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No canonical items match this filter.</p>}</div>}
    </section>

    <BatchProgressControls endpoint="/api/admin-curriculum" token={adminToken} batch={batch} data={data} onRefresh={load} disabled={!batch || saving} />

    <section className="card admin-panel">
      <div><h3 className="text-lg font-bold">Extras · Needs Review</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>Legacy topics are never deleted or shown as new student coursework. Map only when the phase, type, and historical evidence are defensible.</p></div>
      <div className="grid gap-2 mt-3">{(data.extras || []).map(extra => <div className="admin-row grid gap-2" key={extra.alias_id}><div className="flex items-start justify-between gap-3 flex-wrap"><span><b>{extra.original_alias}</b><small className="block" style={{ color: "var(--text-muted)" }}>{extra.suggested_phase || "Phase needs review"} · {extra.suggested_item_type || "type needs review"} · {extra.confidence}</small></span><span className="badge-pending">{extra.mapping_status}</span></div><p className="text-xs" style={{ color: "var(--text-secondary)" }}>Mapping this alias would recognize {extra.submission_count} historical submissions from {extra.student_count} students across {extra.batch_count} batches. Original titles and submissions remain unchanged.</p><div className="flex gap-2 flex-wrap"><select className="select" value={mappingSelection[extra.alias_id] || extra.suggested_canonical_coursework_item_id || ""} onChange={event => setMappingSelection(current => ({ ...current, [extra.alias_id]: event.target.value }))}><option value="">Select canonical target</option>{canonicalItems.map(item => <option key={item.id} value={item.id}>{item.phase} · {item.item_type} · {item.title}</option>)}</select><button type="button" className="btn btn-primary btn-sm" disabled={saving || extra.mapping_status === "ignored"} onClick={() => updateExtra(extra.alias_id, "map-extra", mappingSelection[extra.alias_id] || extra.suggested_canonical_coursework_item_id)}>Map to Canonical</button><button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => updateExtra(extra.alias_id, "ignore-extra")}>Ignore / Keep as Extra</button></div></div>)}{!(data.extras || []).length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No unresolved Extras.</p>}</div>
    </section>

    <section className="card admin-panel"><h3 className="text-lg font-bold">Current batch activations</h3><div className="grid gap-2 mt-3">{data.activations.length ? data.activations.map(row => { const item = data.items.find(candidate => candidate.id === row.coursework_item_id); return <div className="admin-row" key={row.id}><span><b>{item?.title || "Coursework item"}</b><small className="block" style={{ color: "var(--text-muted)" }}>{row.batch} · {item?.catalog_status === "canonical" ? "Canonical" : "Legacy continuity"} · started {String(row.activated_at || "").slice(0, 10)} · by {row.activated_by_name}</small></span><button className="btn btn-secondary btn-sm" type="button" onClick={() => setActivation(row.id, !row.active)} disabled={saving}>{row.active ? "Pause" : "Reactivate"}</button></div> }) : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No batch activations for this selection yet.</p>}</div></section>
  </div>
}
