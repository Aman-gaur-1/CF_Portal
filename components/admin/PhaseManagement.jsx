"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import { useRefreshAction } from "@/lib/use-refresh-action"

const EMPTY_PHASE = {
  name: "",
  description: "",
  color: "",
  icon: "",
  display_order: 0,
  is_active: true,
}

function phasePayload(phase) {
  return {
    ...phase,
    display_order: Number.parseInt(phase.display_order, 10) || 0,
    is_active: phase.is_active !== false,
  }
}

export default function PhaseManagement({ adminToken, success, showError }) {
  const [phases, setPhases] = useState([])
  const [newPhase, setNewPhase] = useState(EMPTY_PHASE)
  const [editing, setEditing] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const refreshAction = useRefreshAction({
    onRefresh: load,
    onSuccess: success,
    onError: showError,
  })

  const sortedPhases = useMemo(() => {
    return [...phases].sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0) || a.name.localeCompare(b.name))
  }, [phases])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/admin-assignment-phases", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load phases.")
      setPhases(data.phases || [])
      setEditing({})
    } catch (err) {
      showError(err.message || "Could not load phases.")
    } finally {
      setLoading(false)
    }
  }

  async function createPhase() {
    if (!newPhase.name.trim()) {
      showError("Phase name is required.")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin-assignment-phases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(phasePayload(newPhase)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not create phase.")
      setNewPhase(EMPTY_PHASE)
      success("Phase created.")
      await load()
    } catch (err) {
      showError(err.message || "Could not create phase.")
    } finally {
      setSaving(false)
    }
  }

  async function updatePhase(phase) {
    const draft = editing[phase.id] || phase
    if (!draft.name?.trim()) {
      showError("Phase name is required.")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin-assignment-phases", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ ...phasePayload(draft), id: phase.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not update phase.")
      success("Phase updated.")
      await load()
    } catch (err) {
      showError(err.message || "Could not update phase.")
    } finally {
      setSaving(false)
    }
  }

  function editPhase(id, field, value) {
    setEditing(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || phases.find(phase => phase.id === id) || {}),
        [field]: value,
      },
    }))
  }

  return (
    <div className="card admin-panel">
      <div className="section-divider">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Assignment Phases</span>
        <div className="line" />
        {loading && <Spinner size="sm" />}
      </div>

      <div className="grid gap-2 mb-4 md:grid-cols-[1fr_1fr_100px_90px_90px_auto]">
        <input className="input" value={newPhase.name} onChange={e => setNewPhase(prev => ({ ...prev, name: e.target.value }))} placeholder="Phase name" />
        <input className="input" value={newPhase.description} onChange={e => setNewPhase(prev => ({ ...prev, description: e.target.value }))} placeholder="Description" />
        <input className="input" value={newPhase.color} onChange={e => setNewPhase(prev => ({ ...prev, color: e.target.value }))} placeholder="Color" />
        <input className="input" value={newPhase.icon} onChange={e => setNewPhase(prev => ({ ...prev, icon: e.target.value }))} placeholder="Icon" />
        <input className="input" type="number" value={newPhase.display_order} onChange={e => setNewPhase(prev => ({ ...prev, display_order: e.target.value }))} placeholder="Order" />
        <button className="btn btn-primary btn-sm" onClick={createPhase} disabled={saving}>Add Phase</button>
      </div>

      {sortedPhases.length > 0 && (
        <div className="flex justify-end mb-4">
          <RefreshButton
            onClick={refreshAction.refresh}
            refreshing={refreshAction.refreshing}
            updatedLabel={refreshAction.updatedLabel}
            disabled={loading || saving}
          />
        </div>
      )}

      <div className="grid gap-2">
        {sortedPhases.map(phase => {
          const draft = editing[phase.id] || phase
          return (
            <div key={phase.id} className="admin-row">
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_100px_90px_90px]">
                <input className="input" value={draft.name || ""} onChange={e => editPhase(phase.id, "name", e.target.value)} />
                <input className="input" value={draft.description || ""} onChange={e => editPhase(phase.id, "description", e.target.value)} placeholder="Description" />
                <input className="input" value={draft.color || ""} onChange={e => editPhase(phase.id, "color", e.target.value)} placeholder="Color" />
                <input className="input" value={draft.icon || ""} onChange={e => editPhase(phase.id, "icon", e.target.value)} placeholder="Icon" />
                <input className="input" type="number" value={draft.display_order ?? 0} onChange={e => editPhase(phase.id, "display_order", e.target.value)} />
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button className="btn btn-secondary btn-sm" onClick={() => editPhase(phase.id, "is_active", !draft.is_active)} disabled={saving}>
                  {draft.is_active ? "Disable" : "Enable"}
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => updatePhase(phase)} disabled={saving}>
                  Save
                </button>
              </div>
            </div>
          )
        })}
        {!loading && sortedPhases.length === 0 && (
          <p className="text-sm py-3" style={{ color: "var(--text-secondary)" }}>No phases configured yet.</p>
        )}
      </div>
    </div>
  )
}
