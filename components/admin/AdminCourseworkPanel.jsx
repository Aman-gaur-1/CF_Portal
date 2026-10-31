"use client"

import { useCallback, useEffect, useState } from "react"
import EmptyState from "@/components/ui/EmptyState"
import RefreshButton from "@/components/ui/RefreshButton"
import Spinner from "@/components/ui/Spinner"
import SearchableBatchSelect from "@/components/ui/SearchableBatchSelect"

const EMPTY_FORM = { title: "", itemType: "assignment", batch: "", phase: "", dueAt: "", active: true }

function dueValue(value) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16)
}

export default function AdminCourseworkPanel({ adminToken, batches = [], success, showError }) {
  const [coursework, setCoursework] = useState([])
  const [filters, setFilters] = useState({ batch: "", type: "", active: "", phase: "" })
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.batch) params.set("batch", filters.batch)
      if (filters.type) params.set("type", filters.type)
      if (filters.active) params.set("active", filters.active)
      if (filters.phase.trim()) params.set("phase", filters.phase.trim())
      const res = await fetch(`/api/admin-coursework?${params.toString()}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load coursework.")
      setCoursework(data.coursework || [])
    } catch (error) {
      showError(error.message || "Could not load coursework.")
    } finally {
      setLoading(false)
    }
  }, [adminToken, filters, showError])

  useEffect(() => { load() }, [load])

  function updateForm(key, value) { setForm(prev => ({ ...prev, [key]: value })) }

  function editItem(item) {
    setEditingId(item.id)
    setForm({ title: item.title || "", itemType: item.item_type || "assignment", batch: item.batch || "", phase: item.phase || "", dueAt: dueValue(item.due_at), active: Boolean(item.active) })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function resetForm() { setEditingId(""); setForm(EMPTY_FORM) }

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/admin-coursework", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(editingId ? { ...form, id: editingId } : form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save coursework.")
      success(editingId ? "Coursework updated." : "Coursework created.")
      resetForm()
      await load()
    } catch (error) {
      showError(error.message || "Could not save coursework.")
    } finally {
      setSaving(false)
    }
  }

  async function setActive(item, active) {
    setSaving(true)
    try {
      const res = await fetch("/api/admin-coursework", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ id: item.id, active }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not update coursework status.")
      success(active ? "Coursework reactivated." : "Coursework deactivated.")
      await load()
    } catch (error) { showError(error.message || "Could not update coursework status.") } finally { setSaving(false) }
  }

  return (
    <div className="grid gap-4">
      <form className="card admin-panel grid gap-3" onSubmit={save}>
        <div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Coursework catalog</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Manage Health Card items without rewriting historical submissions.</p></div>{editingId && <button type="button" className="btn btn-secondary btn-sm" onClick={resetForm}>Cancel edit</button>}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="input" value={form.title} onChange={event => updateForm("title", event.target.value)} placeholder="Coursework title" required />
          <select className="select" value={form.itemType} onChange={event => updateForm("itemType", event.target.value)}><option value="assignment">Assignment</option><option value="project">Project</option></select>
          <SearchableBatchSelect batches={batches} value={form.batch} onChange={value => updateForm("batch", value)} allOption allLabel="All batches" label="Coursework batch" />
          <select className="select" value={form.phase} onChange={event => updateForm("phase", event.target.value)} required><option value="">Select phase</option><option value="Python">Python</option><option value="Data Analytics">Data Analytics</option><option value="SQL">SQL</option></select>
          <label className="grid gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>Due date<input className="input" type="datetime-local" value={form.dueAt} onChange={event => updateForm("dueAt", event.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={form.active} onChange={event => updateForm("active", event.target.checked)} /> Active</label>
        </div>
        <div><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <Spinner size="sm" /> : editingId ? "Save changes" : "Create coursework"}</button></div>
      </form>

      <div className="card admin-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold">Coursework list</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Points are resolved from effective Health Card rules.</p></div><RefreshButton onClick={load} disabled={loading} /></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-4"><SearchableBatchSelect batches={batches} value={filters.batch} onChange={value => setFilters(prev => ({ ...prev, batch: value }))} allOption allLabel="All batches" label="Coursework batch filter" /><select className="select" value={filters.type} onChange={event => setFilters(prev => ({ ...prev, type: event.target.value }))}><option value="">All types</option><option value="assignment">Assignments</option><option value="project">Projects</option></select><select className="select" value={filters.active} onChange={event => setFilters(prev => ({ ...prev, active: event.target.value }))}><option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></select><input className="input" value={filters.phase} onChange={event => setFilters(prev => ({ ...prev, phase: event.target.value }))} placeholder="Filter phase" /></div>
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : coursework.length === 0 ? <EmptyState icon="□" title="No coursework found" message="Create an item or adjust the filters." /> : <div className="grid gap-2 mt-4">{coursework.map(item => <div className="admin-row items-start" key={item.id}><div className="min-w-0"><p className="font-semibold">{item.title}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{item.item_type} · {item.batch || "All batches"} · {item.phase || "No phase"} · {item.due_at ? new Date(item.due_at).toLocaleString() : "No due date"}</p><p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{item.linkedSubmissionCount || 0} linked submission{item.linkedSubmissionCount === 1 ? "" : "s"}</p></div><div className="flex items-center gap-2 flex-wrap justify-end"><span className={item.active ? "badge-done" : "badge-failed"}>{item.active ? "active" : "inactive"}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => editItem(item)} disabled={saving}>Edit</button><button type="button" className={item.active ? "btn btn-danger-outline btn-sm" : "btn btn-primary btn-sm"} onClick={() => setActive(item, !item.active)} disabled={saving}>{item.active ? "Deactivate" : "Reactivate"}</button></div></div>)}</div>}
      </div>
    </div>
  )
}
