"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const EMPTY_FORM = { id: null, name: "", website: "", category: "", city: "", active: true }

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
}

export default function MoatCompetitorsManager({ adminToken }) {
  const [competitors, setCompetitors] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
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
      const res = await fetch("/api/moat/competitors", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load competitors.")
      setCompetitors(data.competitors || [])
      setCategories(data.categories || [])
    } catch (err) {
      showError(err.message || "Could not load competitors.")
    } finally {
      setLoading(false)
    }
  }

  const visibleCompetitors = useMemo(() => {
    const term = search.trim().toLowerCase()
    return competitors.filter(row => {
      const matchesSearch = !term || [row.name, row.website_url, row.city].some(value => String(value || "").toLowerCase().includes(term))
      const matchesCategory = category === "all" || row.category === category
      return matchesSearch && matchesCategory
    })
  }, [category, competitors, search])

  function edit(row) {
    setForm({
      id: row.id,
      name: row.name || "",
      website: row.website_url || "",
      category: row.category || "",
      city: row.city || "",
      active: row.active !== false,
    })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/moat/competitors", {
        method: form.id ? "PATCH" : "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save competitor.")
      success(form.id ? "Competitor updated." : "Competitor added.")
      setForm(EMPTY_FORM)
      await load()
    } catch (err) {
      showError(err.message || "Could not save competitor.")
    } finally {
      setSaving(false)
    }
  }

  async function toggle(row) {
    setSaving(true)
    try {
      const res = await fetch("/api/moat/competitors", {
        method: "PATCH",
        headers: authHeaders(adminToken),
        body: JSON.stringify({
          id: row.id,
          name: row.name,
          website: row.website_url,
          category: row.category,
          city: row.city,
          active: row.active === false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not update competitor.")
      success(row.active === false ? "Competitor activated." : "Competitor deactivated.")
      await load()
    } catch (err) {
      showError(err.message || "Could not update competitor.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="card admin-panel">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search competitors" />
          <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </section>

      <section className="card admin-panel">
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{form.id ? "Edit competitor" : "Add competitor"}</p>
        <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
          <input className="input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Name" />
          <input className="input" value={form.website} onChange={e => setForm(prev => ({ ...prev, website: e.target.value }))} placeholder="Website" />
          <input className="input" value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Category" />
          <input className="input" value={form.city} onChange={e => setForm(prev => ({ ...prev, city: e.target.value }))} placeholder="City" />
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))} />
            Active
          </label>
          <div className="flex gap-2 justify-end">
            {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(EMPTY_FORM)}>Cancel</button>}
            <button className="btn btn-primary btn-sm" disabled={saving}>{saving ? <Spinner /> : "Save"}</button>
          </div>
        </form>
      </section>

      <section className="card admin-panel">
        <div className="flex justify-between gap-3 mb-3">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Competitors</p>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
          <div className="grid gap-2">
            {visibleCompetitors.map(row => (
              <div key={row.id} className="admin-row">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{row.name}</p>
                  <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                    {[row.category, row.city, row.website_url].filter(Boolean).join(" - ") || "No metadata"}
                  </p>
                </div>
                <div className="flex gap-2 justify-end flex-wrap">
                  <span className={row.active === false ? "badge-failed" : "badge-done"}>{row.active === false ? "Inactive" : "Active"}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => edit(row)}>Edit</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => toggle(row)} disabled={saving}>
                    {row.active === false ? "Activate" : "Deactivate"}
                  </button>
                </div>
              </div>
            ))}
            {visibleCompetitors.length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No competitors found.</p>}
          </div>
        )}
      </section>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
