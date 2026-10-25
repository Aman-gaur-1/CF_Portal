"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import BatchProgressControls from "@/components/coursework/BatchProgressControls"
import { courseworkIdentity } from "@/lib/coursework-identity"

const EMPTY_FORM = { title: "", itemType: "assignment", phase: "", dueAt: "", sortOrder: "" }
const HEALTH_CARD_PHASES = ["Python", "Data Analytics", "SQL"]

export default function CurriculumPanel({ adminToken, batches = [], success, showError }) {
  const [data, setData] = useState({ items: [], activations: [], progress: [], activeStudentCount: 0 })
  const [batch, setBatch] = useState(batches[0]?.name || "")
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedIds, setSelectedIds] = useState([])
  const [activationPhase, setActivationPhase] = useState("")
  const [activationType, setActivationType] = useState("")
  const [activationSearch, setActivationSearch] = useState("")
  const [bulkText, setBulkText] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin-curriculum${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not load curriculum.")
      setData({ items: payload.items || [], activations: payload.activations || [], progress: payload.progress || [], activeStudentCount: payload.activeStudentCount || 0 })
    } catch (error) { showError(error.message) } finally { setLoading(false) }
  }, [adminToken, batch, showError])

  useEffect(() => { load() }, [load])

  const activeIds = useMemo(() => new Set(data.activations.filter(row => row.active).map(row => String(row.coursework_item_id))), [data.activations])
  const activeKeys = useMemo(() => new Set(data.activations.filter(row => row.active).map(row => courseworkIdentity(row.item || data.items.find(item => item.id === row.coursework_item_id))).filter(Boolean)), [data.activations, data.items])
  const globalItems = useMemo(() => data.items.filter(item => item.active && item.batch == null && HEALTH_CARD_PHASES.includes(item.phase)), [data.items])
  const phaseSummary = useMemo(() => HEALTH_CARD_PHASES.map(phase => {
    const phaseItems = globalItems.filter(item => item.phase === phase)
    const active = phaseItems.filter(item => activeIds.has(String(item.id)) || activeKeys.has(courseworkIdentity(item))).length
    return { phase, active, available: Math.max(phaseItems.length - active, 0) }
  }), [activeIds, activeKeys, globalItems])
  const available = globalItems.filter(item => (!activationPhase || item.phase === activationPhase) && (!activationType || item.item_type === activationType) && (!activationSearch || `${item.title} ${item.phase} ${item.item_type}`.toLowerCase().includes(activationSearch.trim().toLowerCase())))

  async function createItems(items) {
    for (const item of items) {
      const res = await fetch("/api/admin-curriculum", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify(item) })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not create coursework.")
    }
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const items = bulkText.trim()
        ? bulkText.split(/\r?\n/).map(line => line.split("|").map(value => value.trim())).filter(parts => parts.length >= 3 && parts[2]).map(([itemType, phase, title, sortOrder]) => ({ title, itemType: itemType.toLowerCase() === "project" ? "project" : "assignment", phase, sortOrder: sortOrder || null, dueAt: form.dueAt || null, active: true }))
        : [{ ...form }]
      await createItems(items)
      success(`${items.length} coursework item(s) added.`)
      setForm(EMPTY_FORM); setBulkText(""); await load()
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  async function activate() {
    if (!batch || !selectedIds.length) { showError("Select a batch and at least one coursework item."); return }
    setSaving(true)
    try {
      const res = await fetch("/api/admin-curriculum", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ action: "activate", batch, courseworkItemIds: selectedIds, dueAt: form.dueAt || null }) })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not activate coursework.")
      success("Coursework activated for the selected batch."); setSelectedIds([]); await load()
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  async function setActivation(id, active) {
    setSaving(true)
    try {
      const res = await fetch("/api/admin-curriculum", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ id, active }) })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not update activation.")
      await load()
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  return <div className="grid gap-4">
    <form className="card admin-panel grid gap-3" onSubmit={save}><div><h3 className="text-lg font-bold">Step 1 · Global coursework catalog</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Create reusable assignments and projects with a Phase / Module. Global catalog items are templates until you activate them for a batch.</p></div><div className="grid grid-cols-1 md:grid-cols-5 gap-2"><select className="select" value={form.itemType} onChange={event => setForm(prev => ({ ...prev, itemType: event.target.value }))}><option value="assignment">Assignment · 5 pts</option><option value="project">Project · 10 pts</option></select><input className="input" value={form.phase} onChange={event => setForm(prev => ({ ...prev, phase: event.target.value }))} placeholder="Phase / Module" /><input className="input" type="number" min="0" value={form.sortOrder} onChange={event => setForm(prev => ({ ...prev, sortOrder: event.target.value }))} placeholder="Order (required for release)" /><input className="input md:col-span-2" value={form.title} onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} placeholder="Coursework title" required={!bulkText} /></div><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><input className="input" type="datetime-local" value={form.dueAt} onChange={event => setForm(prev => ({ ...prev, dueAt: event.target.value }))} /><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Spinner size="sm" /> : "Add to global catalog"}</button><span className="text-xs self-center" style={{ color: "var(--text-muted)" }}>Global catalog — activate separately for batches. Explicit order is required for cumulative release; legacy unordered items remain available for manual activation.</span></div><textarea className="input font-mono text-xs" rows={4} value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder="Optional bulk lines: assignment | Python | Variables | 10\nproject | Data Analytics | Capstone | 20" /><p className="text-xs" style={{ color: "var(--text-muted)" }}>Bulk lines use Type | Phase / Module | Title | Sort order. A catalog item alone never becomes student pending work.</p></form>
    <section className="card admin-panel"><div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Step 2 · Activate for a batch</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>Choose a batch and activate reusable global coursework. Active status is relative to this batch; only active batch assignments become expected or pending.</p></div><RefreshButton onClick={load} disabled={loading} /></div><div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4" aria-label="Batch phase summary">{phaseSummary.map(({ phase, active, available: availableCount }) => <button key={phase} type="button" className="stat-card text-left" onClick={() => { setActivationPhase(current => current === phase ? "" : phase); setSelectedIds([]) }}><div className="stat-label">{phase}</div><div className="text-sm mt-1">Active {active} · Available {availableCount}</div></button>)}</div><div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-4"><select className="select" value={batch} onChange={event => { setBatch(event.target.value); setSelectedIds([]) }}><option value="">Select batch</option>{batches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select><select className="select" value={activationPhase} onChange={event => { setActivationPhase(event.target.value); setSelectedIds([]) }} aria-label="Activation phase"><option value="">All phases</option><option value="Python">Python</option><option value="Data Analytics">Data Analytics</option><option value="SQL">SQL</option></select><select className="select" value={activationType} onChange={event => { setActivationType(event.target.value); setSelectedIds([]) }} aria-label="Activation type"><option value="">All types</option><option value="assignment">Assignment</option><option value="project">Project</option></select><input className="input" value={activationSearch} onChange={event => { setActivationSearch(event.target.value); setSelectedIds([]) }} placeholder="Search catalog" aria-label="Search global catalog" /><button className="btn btn-primary" type="button" onClick={activate} disabled={saving || !selectedIds.length || !batch}>Activate selected ({selectedIds.length})</button><span className="text-xs self-center" style={{ color: "var(--text-muted)" }}>{available.length} matching global item(s)</span></div>{loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : <div className="grid gap-2 mt-4">{available.map(item => { const active = activeIds.has(String(item.id)) || activeKeys.has(courseworkIdentity(item)); return <label className="admin-row" key={item.id}><span className="flex items-center gap-2"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} disabled={active} /><span><b>{item.title}</b><small className="block" style={{ color: "var(--text-muted)" }}>{item.item_type} · {item.phase} {active ? "· active for this batch" : ""}</small></span></span><span className={active ? "badge-done" : "badge-pending"}>{active ? "Active" : "Available"}</span></label> })}{!available.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No global catalog items match this batch, phase, type, or search.</p>}</div>}</section>
    <BatchProgressControls endpoint="/api/admin-curriculum" token={adminToken} batch={batch} data={data} onRefresh={load} disabled={!batch || saving} />
    <section className="card admin-panel"><h3 className="text-lg font-bold">Current batch activations</h3><div className="grid gap-2 mt-3">{data.activations.length ? data.activations.map(row => { const item = data.items.find(candidate => candidate.id === row.coursework_item_id); return <div className="admin-row" key={row.id}><span><b>{item?.title || "Coursework item"}</b><small className="block" style={{ color: "var(--text-muted)" }}>{row.batch} · started {String(row.activated_at || "").slice(0, 10)} · by {row.activated_by_name}</small></span><button className="btn btn-secondary btn-sm" type="button" onClick={() => setActivation(row.id, !row.active)} disabled={saving}>{row.active ? "Pause" : "Reactivate"}</button></div> }) : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No batch activations for this selection yet.</p>}</div></section>
  </div>
}
