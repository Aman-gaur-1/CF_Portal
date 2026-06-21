"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const SOURCE_TYPES = ["google_maps", "trustpilot", "reddit", "youtube", "quora", "justdial", "website"]
const EMPTY_FORM = { id: null, competitor_id: "", source_type: "website", source_url: "", active: true }

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
}

function sourceLabel(value) {
  return String(value || "").replace(/_/g, " ")
}

export default function MoatSourcesManager({ adminToken }) {
  const [competitors, setCompetitors] = useState([])
  const [sources, setSources] = useState([])
  const [selectedCompetitor, setSelectedCompetitor] = useState("all")
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toasts, success, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const [competitorsRes, sourcesRes] = await Promise.all([
        fetch("/api/moat/competitors", { headers: { Authorization: `Bearer ${adminToken}` }, cache: "no-store" }),
        fetch("/api/moat/sources", { headers: { Authorization: `Bearer ${adminToken}` }, cache: "no-store" }),
      ])
      const competitorsData = await competitorsRes.json().catch(() => ({}))
      const sourcesData = await sourcesRes.json().catch(() => ({}))
      if (!competitorsRes.ok) throw new Error(competitorsData.error || "Could not load competitors.")
      if (!sourcesRes.ok) throw new Error(sourcesData.error || "Could not load sources.")
      setCompetitors(competitorsData.competitors || [])
      setSources(sourcesData.sources || [])
      if (!form.competitor_id && competitorsData.competitors?.[0]?.id) {
        setForm(prev => ({ ...prev, competitor_id: competitorsData.competitors[0].id }))
      }
    } catch (err) {
      showError(err.message || "Could not load sources.")
    } finally {
      setLoading(false)
    }
  }

  const visibleSources = useMemo(() => {
    return sources.filter(row => selectedCompetitor === "all" || row.competitor_id === selectedCompetitor)
  }, [selectedCompetitor, sources])

  function edit(row) {
    setForm({
      id: row.id,
      competitor_id: row.competitor_id || "",
      source_type: row.source_type || "website",
      source_url: row.source_url || "",
      active: row.active !== false,
    })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/moat/sources", {
        method: form.id ? "PATCH" : "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save source.")
      success(form.id ? "Source updated." : "Source added.")
      setForm({ ...EMPTY_FORM, competitor_id: form.competitor_id })
      await load()
    } catch (err) {
      showError(err.message || "Could not save source.")
    } finally {
      setSaving(false)
    }
  }

  async function disable(row) {
    setSaving(true)
    try {
      const res = await fetch("/api/moat/sources", {
        method: "PATCH",
        headers: authHeaders(adminToken),
        body: JSON.stringify({ ...row, active: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not disable source.")
      success("Source disabled.")
      await load()
    } catch (err) {
      showError(err.message || "Could not disable source.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="card admin-panel">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <select className="select" value={selectedCompetitor} onChange={e => setSelectedCompetitor(e.target.value)}>
            <option value="all">All competitors</option>
            {competitors.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </section>

      <section className="card admin-panel">
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{form.id ? "Edit source" : "Add source"}</p>
        <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
          <select className="select" value={form.competitor_id} onChange={e => setForm(prev => ({ ...prev, competitor_id: e.target.value }))}>
            <option value="">Select competitor</option>
            {competitors.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className="select" value={form.source_type} onChange={e => setForm(prev => ({ ...prev, source_type: e.target.value }))}>
            {SOURCE_TYPES.map(type => <option key={type} value={type}>{sourceLabel(type)}</option>)}
          </select>
          <input className="input md:col-span-2" value={form.source_url} onChange={e => setForm(prev => ({ ...prev, source_url: e.target.value }))} placeholder="Source URL" />
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))} />
            Active
          </label>
          <div className="flex gap-2 justify-end">
            {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...EMPTY_FORM, competitor_id: form.competitor_id })}>Cancel</button>}
            <button className="btn btn-primary btn-sm" disabled={saving}>{saving ? <Spinner /> : "Save"}</button>
          </div>
        </form>
      </section>

      <section className="card admin-panel">
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Sources</p>
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
          <div className="grid gap-2">
            {visibleSources.map(row => (
              <div key={row.id} className="admin-row">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{row.competitors?.name || "Unknown competitor"} - {sourceLabel(row.source_type)}</p>
                  <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>{row.source_url}</p>
                </div>
                <div className="flex gap-2 justify-end flex-wrap">
                  <span className={row.active === false ? "badge-failed" : "badge-done"}>{row.active === false ? "Inactive" : "Active"}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => edit(row)}>Edit</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => disable(row)} disabled={saving || row.active === false}>Disable</button>
                </div>
              </div>
            ))}
            {visibleSources.length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No sources found.</p>}
          </div>
        )}
      </section>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
