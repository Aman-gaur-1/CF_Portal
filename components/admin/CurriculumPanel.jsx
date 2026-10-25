"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"

const EMPTY_FORM = { title: "", itemType: "assignment", phase: "", batch: "", dueAt: "" }

export default function CurriculumPanel({ adminToken, batches = [], success, showError }) {
  const [data, setData] = useState({ items: [], activations: [] })
  const [batch, setBatch] = useState(batches[0]?.name || "")
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedIds, setSelectedIds] = useState([])
  const [activationPhase, setActivationPhase] = useState("")
  const [activationType, setActivationType] = useState("")
  const [bulkText, setBulkText] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin-curriculum${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || "Could not load curriculum.")
      setData({ items: payload.items || [], activations: payload.activations || [] })
    } catch (error) { showError(error.message) } finally { setLoading(false) }
  }, [adminToken, batch, showError])

  useEffect(() => { load() }, [load])

  const activeIds = useMemo(() => new Set(data.activations.filter(row => row.active).map(row => String(row.coursework_item_id))), [data.activations])
  const available = data.items.filter(item => item.active && (!item.batch || item.batch === batch) && (!activationPhase || item.phase === activationPhase) && (!activationType || item.item_type === activationType))

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
        ? bulkText.split(/\r?\n/).map(line => line.split("|").map(value => value.trim())).filter(parts => parts.length >= 3 && parts[2]).map(([itemType, phase, title]) => ({ title, itemType: itemType.toLowerCase() === "project" ? "project" : "assignment", phase, batch: form.batch || null, dueAt: form.dueAt || null, active: true }))
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
    <form className="card admin-panel grid gap-3" onSubmit={save}><div><h3 className="text-lg font-bold">Step 1 · Coursework catalog</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Create reusable assignments and projects with a Phase / Module. These are templates until you activate them for a batch.</p></div><div className="grid grid-cols-1 md:grid-cols-4 gap-2"><select className="select" value={form.itemType} onChange={event => setForm(prev => ({ ...prev, itemType: event.target.value }))}><option value="assignment">Assignment · 5 pts</option><option value="project">Project · 10 pts</option></select><input className="input" value={form.phase} onChange={event => setForm(prev => ({ ...prev, phase: event.target.value }))} placeholder="Phase / Module" /><input className="input md:col-span-2" value={form.title} onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} placeholder="Coursework title" required={!bulkText} /></div><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><select className="select" value={form.batch} onChange={event => setForm(prev => ({ ...prev, batch: event.target.value }))}><option value="">Available to all batches</option>{batches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select><input className="input" type="datetime-local" value={form.dueAt} onChange={event => setForm(prev => ({ ...prev, dueAt: event.target.value }))} /><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Spinner size="sm" /> : "Add to catalog"}</button></div><textarea className="input font-mono text-xs" rows={4} value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder="Optional bulk lines: assignment | Phase 1 | Variables\nproject | Phase 2 | Capstone" /><p className="text-xs" style={{ color: "var(--text-muted)" }}>Bulk lines use Type | Phase / Module | Title. A catalog item alone never becomes student pending work.</p></form>
    <section className="card admin-panel"><div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Step 2 · Activate for a batch</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>Select a batch, phase, and type before bulk activating the work students should see. Only active batch assignments become expected or pending.</p></div><RefreshButton onClick={load} disabled={loading} /></div><div className="grid grid-cols-1 md:grid-cols-5 gap-2 mt-4"><select className="select" value={batch} onChange={event => { setBatch(event.target.value); setSelectedIds([]) }}><option value="">Select batch</option>{batches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select><select className="select" value={activationPhase} onChange={event => { setActivationPhase(event.target.value); setSelectedIds([]) }} aria-label="Activation phase"><option value="">All phases</option><option value="Python">Python</option><option value="Data Analytics">Data Analytics</option><option value="SQL">SQL</option></select><select className="select" value={activationType} onChange={event => { setActivationType(event.target.value); setSelectedIds([]) }} aria-label="Activation type"><option value="">All types</option><option value="assignment">Assignment</option><option value="project">Project</option></select><button className="btn btn-primary" type="button" onClick={activate} disabled={saving || !selectedIds.length}>Activate selected ({selectedIds.length})</button><span className="text-xs self-center" style={{ color: "var(--text-muted)" }}>{available.length} matching catalog item(s)</span></div>{loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : <div className="grid gap-2 mt-4">{available.map(item => <label className="admin-row" key={item.id}><span className="flex items-center gap-2"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} disabled={activeIds.has(String(item.id))} /><span><b>{item.title}</b><small className="block" style={{ color: "var(--text-muted)" }}>{item.item_type} · {item.phase || "No phase"} {activeIds.has(String(item.id)) ? "· active for this batch" : ""}</small></span></span><span className={activeIds.has(String(item.id)) ? "badge-done" : "badge-pending"}>{activeIds.has(String(item.id)) ? "Active" : "Catalog"}</span></label>)}{!available.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No catalog items match this batch, phase, and type.</p>}</div>}</section>
    <section className="card admin-panel"><h3 className="text-lg font-bold">Current batch activations</h3><div className="grid gap-2 mt-3">{data.activations.length ? data.activations.map(row => { const item = data.items.find(candidate => candidate.id === row.coursework_item_id); return <div className="admin-row" key={row.id}><span><b>{item?.title || "Coursework item"}</b><small className="block" style={{ color: "var(--text-muted)" }}>{row.batch} · started {String(row.activated_at || "").slice(0, 10)} · by {row.activated_by_name}</small></span><button className="btn btn-secondary btn-sm" type="button" onClick={() => setActivation(row.id, !row.active)} disabled={saving}>{row.active ? "Pause" : "Reactivate"}</button></div> }) : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No batch activations for this selection yet.</p>}</div></section>
  </div>
}
