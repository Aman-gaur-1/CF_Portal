"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const SOURCE_TYPES = ["google_maps", "trustpilot", "reddit", "youtube", "quora", "website"]
const EMPTY_FORM = {
  id: null,
  competitor_id: "",
  source_type: "website",
  profile_url: "",
  search_pattern: "",
  external_identifier: "",
  active: true,
}

function typeLabel(value) {
  return String(value || "").replace(/_/g, " ")
}

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
}

export default function MoatSourceDiscoveryManager({ adminToken }) {
  const [competitors, setCompetitors] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selectedCompetitor, setSelectedCompetitor] = useState("all")
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [bulkRunning, setBulkRunning] = useState("")
  const [bulkSummary, setBulkSummary] = useState(null)
  const [discoveryPreview, setDiscoveryPreview] = useState(null)
  const { toasts, success, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const [competitorsRes, profilesRes] = await Promise.all([
        fetch("/api/moat/competitors?active=true", { headers: { Authorization: `Bearer ${adminToken}` }, cache: "no-store" }),
        fetch("/api/moat/source-profiles", { headers: { Authorization: `Bearer ${adminToken}` }, cache: "no-store" }),
      ])
      const competitorsData = await competitorsRes.json().catch(() => ({}))
      const profilesData = await profilesRes.json().catch(() => ({}))
      if (!competitorsRes.ok) throw new Error(competitorsData.error || "Could not load competitors.")
      if (!profilesRes.ok) throw new Error(profilesData.error || "Could not load source profiles.")
      setCompetitors(competitorsData.competitors || [])
      setProfiles(profilesData.sourceProfiles || [])
      if (!form.competitor_id && competitorsData.competitors?.[0]?.id) {
        setForm(prev => ({ ...prev, competitor_id: competitorsData.competitors[0].id }))
      }
    } catch (err) {
      showError(err.message || "Could not load source discovery.")
    } finally {
      setLoading(false)
    }
  }

  const visibleProfiles = useMemo(() => {
    return profiles.filter(row => selectedCompetitor === "all" || row.competitor_id === selectedCompetitor)
  }, [profiles, selectedCompetitor])

  const coverageRows = useMemo(() => {
    return competitors
      .filter(row => selectedCompetitor === "all" || row.id === selectedCompetitor)
      .map(competitor => {
        const covered = new Set(profiles.filter(row => row.competitor_id === competitor.id && row.active !== false).map(row => row.source_type))
        return { competitor, covered }
      })
  }, [competitors, profiles, selectedCompetitor])

  function edit(row) {
    setForm({
      id: row.id,
      competitor_id: row.competitor_id,
      source_type: row.source_type || "website",
      profile_url: row.profile_url || "",
      search_pattern: row.search_pattern || "",
      external_identifier: row.external_identifier || "",
      active: row.active !== false,
    })
    setDiscoveryPreview(null)
  }

  async function autoDiscover() {
    if (!form.competitor_id) {
      showError("Select a competitor first.")
      return
    }
    if (!SOURCE_TYPES.includes(form.source_type)) {
      showError("Select a supported source type.")
      return
    }

    setDiscovering(true)
    setDiscoveryPreview(null)
    try {
      const res = await fetch("/api/moat/source-discovery", {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({ competitor_id: form.competitor_id, source_type: form.source_type }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not auto discover source.")
      const discovery = data.discovery || {}
      setForm(prev => ({
        ...prev,
        profile_url: discovery.profile_url || "",
        search_pattern: discovery.search_pattern || "",
        external_identifier: discovery.external_identifier || "",
      }))
      setDiscoveryPreview(discovery)
      success("Source discovery preview ready.")
    } catch (err) {
      showError(err.message || "Could not auto discover source.")
    } finally {
      setDiscovering(false)
    }
  }

  async function runBulkDiscovery(action) {
    const actionConfig = {
      missing: {
        endpoint: "/api/moat/source-discovery/discover-missing",
        success: "Missing source profiles discovered.",
      },
      all: {
        endpoint: "/api/moat/source-discovery/bulk",
        success: "All competitors processed for source discovery.",
      },
      refresh: {
        endpoint: "/api/moat/source-discovery/refresh-all",
        success: "Existing source profiles refreshed.",
      },
    }[action]
    if (!actionConfig) return

    setBulkRunning(action)
    setBulkSummary(null)
    try {
      const res = await fetch(actionConfig.endpoint, {
        method: "POST",
        headers: authHeaders(adminToken),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Bulk source discovery failed.")
      setBulkSummary(data)
      success(actionConfig.success)
      await load()
    } catch (err) {
      showError(err.message || "Bulk source discovery failed.")
    } finally {
      setBulkRunning("")
    }
  }

  function validateForm() {
    if (!form.competitor_id) return "Select a competitor."
    if (!SOURCE_TYPES.includes(form.source_type)) return "Select a supported source type."
    if (!form.profile_url.trim() && !form.search_pattern.trim() && !form.external_identifier.trim()) {
      return "Add a profile URL, search pattern, or external identifier."
    }
    if (form.profile_url.trim()) {
      try {
        const url = new URL(form.profile_url)
        if (!["http:", "https:"].includes(url.protocol)) return "Profile URL must use http or https."
      } catch {
        return "Profile URL must be a valid URL."
      }
    }
    return ""
  }

  async function save(e) {
    e.preventDefault()
    const validationError = validateForm()
    if (validationError) {
      showError(validationError)
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/moat/source-profiles", {
        method: form.id ? "PATCH" : "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save source profile.")
      success(form.id ? "Source profile updated." : "Source profile added.")
      setForm({ ...EMPTY_FORM, competitor_id: form.competitor_id })
      setDiscoveryPreview(null)
      await load()
    } catch (err) {
      showError(err.message || "Could not save source profile.")
    } finally {
      setSaving(false)
    }
  }

  async function toggle(row) {
    setSaving(true)
    try {
      const res = await fetch("/api/moat/source-profiles", {
        method: "PATCH",
        headers: authHeaders(adminToken),
        body: JSON.stringify({ ...row, active: row.active === false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not update source profile.")
      success(row.active === false ? "Source profile activated." : "Source profile deactivated.")
      await load()
    } catch (err) {
      showError(err.message || "Could not update source profile.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="card admin-panel">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Bulk Source Discovery</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Create source profiles across competitors without triggering review collection.</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button className="btn btn-primary btn-sm" onClick={() => runBulkDiscovery("missing")} disabled={Boolean(bulkRunning) || loading}>
              {bulkRunning === "missing" ? <Spinner /> : "Discover Missing Sources"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => runBulkDiscovery("all")} disabled={Boolean(bulkRunning) || loading}>
              {bulkRunning === "all" ? <Spinner /> : "Discover All Sources"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => runBulkDiscovery("refresh")} disabled={Boolean(bulkRunning) || loading}>
              {bulkRunning === "refresh" ? <Spinner /> : "Refresh Existing Sources"}
            </button>
          </div>
        </div>
        {bulkSummary && (
          <div className="grid gap-2 md:grid-cols-5 mt-4">
            <div className="admin-queue-metric"><span>Processed</span><b>{bulkSummary.processed || 0}</b></div>
            <div className="admin-queue-metric"><span>Created</span><b>{bulkSummary.created || 0}</b></div>
            <div className="admin-queue-metric"><span>Updated</span><b>{bulkSummary.updated || 0}</b></div>
            <div className="admin-queue-metric"><span>Skipped</span><b>{bulkSummary.skipped || 0}</b></div>
            <div className="admin-queue-metric"><span>Failed</span><b>{bulkSummary.failed || 0}</b></div>
          </div>
        )}
      </section>

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
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{form.id ? "Edit source profile" : "Add source profile"}</p>
        <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
          <select className="select" value={form.competitor_id} onChange={e => setForm(prev => ({ ...prev, competitor_id: e.target.value }))}>
            <option value="">Select competitor</option>
            {competitors.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className="select" value={form.source_type} onChange={e => setForm(prev => ({ ...prev, source_type: e.target.value }))}>
            {SOURCE_TYPES.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}
          </select>
          <div className="md:col-span-2 flex justify-end">
            <button type="button" className="btn btn-secondary btn-sm" onClick={autoDiscover} disabled={discovering || saving}>
              {discovering ? <Spinner /> : "Auto Discover"}
            </button>
          </div>
          {discoveryPreview && (
            <div className="admin-note md:col-span-2">
              <div className="flex justify-between gap-3 flex-wrap">
                <p className="font-semibold">Discovery Preview</p>
                <span className={discoveryPreview.confidence >= 0.7 ? "badge-done" : "badge-pending"}>
                  {Math.round((discoveryPreview.confidence || 0) * 100)}% confidence
                </span>
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{discoveryPreview.rationale}</p>
              {discoveryPreview.duplicate && (
                <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>A matching source profile already exists.</p>
              )}
            </div>
          )}
          <input className="input" value={form.profile_url} onChange={e => setForm(prev => ({ ...prev, profile_url: e.target.value }))} placeholder="Profile URL" />
          <input className="input" value={form.search_pattern} onChange={e => setForm(prev => ({ ...prev, search_pattern: e.target.value }))} placeholder="Search pattern" />
          <input className="input" value={form.external_identifier} onChange={e => setForm(prev => ({ ...prev, external_identifier: e.target.value }))} placeholder="External identifier" />
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))} />
            Active
          </label>
          <div className="flex gap-2 justify-end md:col-span-2">
            {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...EMPTY_FORM, competitor_id: form.competitor_id })}>Cancel</button>}
            <button className="btn btn-primary btn-sm" disabled={saving}>{saving ? <Spinner /> : "Save"}</button>
          </div>
        </form>
      </section>

      <section className="card admin-panel">
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Source Coverage</p>
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
          <div className="grid gap-2">
            {coverageRows.map(row => (
              <div key={row.competitor.id} className="admin-row">
                <span className="font-semibold">{row.competitor.name}</span>
                <div className="flex gap-2 flex-wrap justify-end">
                  {SOURCE_TYPES.map(type => (
                    <span key={type} className={row.covered.has(type) ? "badge-done" : "badge-pending"}>
                      {typeLabel(type)} {row.covered.has(type) ? "yes" : "no"}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card admin-panel">
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Source Profiles</p>
        <div className="grid gap-2">
          {visibleProfiles.map(row => (
            <div key={row.id} className="admin-row">
              <div className="min-w-0">
                <p className="font-semibold truncate">{row.competitors?.name || "Unknown competitor"} - {typeLabel(row.source_type)}</p>
                <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                  {row.profile_url || row.search_pattern || row.external_identifier}
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
          {visibleProfiles.length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No source profiles found.</p>}
        </div>
      </section>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
