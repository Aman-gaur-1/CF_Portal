"use client"

import { useCallback, useEffect, useState } from "react"
import EmptyState from "@/components/ui/EmptyState"
import RefreshButton from "@/components/ui/RefreshButton"
import Spinner from "@/components/ui/Spinner"
import SearchableBatchSelect from "@/components/ui/SearchableBatchSelect"

const EMPTY_FORM = { batch: "", calendarDate: "", isWorkingDay: true, label: "" }

export default function AdminCalendarPanel({ adminToken, batches = [], success, showError }) {
  const [calendar, setCalendar] = useState([])
  const [filters, setFilters] = useState({ batch: "", startDate: "", endDate: "", working: "" })
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const res = await fetch(`/api/admin-calendar?${params.toString()}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load calendar.")
      setCalendar(data.calendar || [])
    } catch (error) { showError(error.message || "Could not load calendar.") } finally { setLoading(false) }
  }, [adminToken, filters, showError])

  useEffect(() => { load() }, [load])
  function updateForm(key, value) { setForm(prev => ({ ...prev, [key]: value })) }
  function resetForm() { setEditingId(""); setForm(EMPTY_FORM) }
  function editDay(day) { setEditingId(day.id); setForm({ batch: day.batch, calendarDate: day.calendar_date, isWorkingDay: Boolean(day.is_working_day), label: day.label || "" }); window.scrollTo({ top: 0, behavior: "smooth" }) }

  async function save(event) {
    event.preventDefault(); setSaving(true)
    try {
      const res = await fetch("/api/admin-calendar", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify(editingId ? { ...form, id: editingId } : form) })
      const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Could not save calendar day.")
      success(editingId ? "Calendar day updated." : "Calendar day created."); resetForm(); await load()
    } catch (error) { showError(error.message || "Could not save calendar day.") } finally { setSaving(false) }
  }

  async function removeDay(day) {
    if (!window.confirm(`Remove future calendar day ${day.calendar_date}?`)) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin-calendar", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ id: day.id }) })
      const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Could not remove calendar day.")
      success("Future calendar day removed."); await load()
    } catch (error) { showError(error.message || "Could not remove calendar day.") } finally { setSaving(false) }
  }

  return (
    <div className="grid gap-4">
      <form className="card admin-panel grid gap-3" onSubmit={save}><div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Working calendar</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Only working days count in attendance percentages.</p></div>{editingId && <button type="button" className="btn btn-secondary btn-sm" onClick={resetForm}>Cancel edit</button>}</div><div className="grid grid-cols-1 md:grid-cols-2 gap-2"><SearchableBatchSelect batches={batches} value={form.batch} onChange={value => updateForm("batch", value)} placeholder="Select batch" label="Calendar batch" required /><input className="input" type="date" value={form.calendarDate} onChange={event => updateForm("calendarDate", event.target.value)} required /><label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={form.isWorkingDay} onChange={event => updateForm("isWorkingDay", event.target.checked)} /> Working day</label><input className="input" value={form.label} onChange={event => updateForm("label", event.target.value)} placeholder="Label or reason (Holiday, Sunday, Exam Day)" /></div><div><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <Spinner size="sm" /> : editingId ? "Save day" : "Add calendar day"}</button></div></form>
      <div className="card admin-panel"><div className="flex items-center justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold">Calendar entries</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Duplicate batch dates are blocked by the database constraint.</p></div><RefreshButton onClick={load} disabled={loading} /></div><div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-4"><SearchableBatchSelect batches={batches} value={filters.batch} onChange={value => setFilters(prev => ({ ...prev, batch: value }))} allOption allLabel="All batches" label="Calendar batch filter" /><input className="input" type="date" value={filters.startDate} onChange={event => setFilters(prev => ({ ...prev, startDate: event.target.value }))} aria-label="Calendar start date" /><input className="input" type="date" value={filters.endDate} onChange={event => setFilters(prev => ({ ...prev, endDate: event.target.value }))} aria-label="Calendar end date" /><select className="select" value={filters.working} onChange={event => setFilters(prev => ({ ...prev, working: event.target.value }))}><option value="">Working and non-working</option><option value="true">Working days</option><option value="false">Non-working days</option></select></div>{loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : calendar.length === 0 ? <EmptyState icon="▣" title="No calendar entries" message="Add a working day or adjust the filters." /> : <div className="grid gap-2 mt-4">{calendar.map(day => <div className="admin-row items-start" key={day.id}><div><p className="font-semibold">{day.calendar_date}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{day.batch} · {day.label || (day.is_working_day ? "Working Day" : "Non-working day")}</p></div><div className="flex items-center gap-2 flex-wrap justify-end"><span className={day.is_working_day ? "badge-done" : "badge-pending"}>{day.is_working_day ? "working" : "excluded"}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => editDay(day)} disabled={saving}>Edit</button><button type="button" className="btn btn-danger-outline btn-sm" onClick={() => removeDay(day)} disabled={saving}>Remove future</button></div></div>)}</div>}</div>
    </div>
  )
}
