"use client"

import { useMemo, useState } from "react"
import { buildProgressPreview, CUMULATIVE_PHASES, sortProgressItems } from "@/lib/coursework-progress"

const TYPES = [
  ["assignment", "Assignments · 5 pts"],
  ["project", "Projects · 10 pts"],
]

export default function BatchProgressControls({ endpoint, token, batch, data, onRefresh, disabled = false }) {
  const [selected, setSelected] = useState({})
  const [previews, setPreviews] = useState({})
  const [warnings, setWarnings] = useState({})
  const [savingKey, setSavingKey] = useState("")

  const batchProgress = useMemo(() => (data?.progress || []).filter(row => row.batch === batch), [batch, data?.progress])
  const batchAssignments = useMemo(() => (data?.assignments || []).filter(row => row.batch === batch), [batch, data?.assignments])
  const activeStudentCount = Number(data?.activeStudentCounts?.[batch] ?? data?.activeStudentCount ?? 0)
  const items = useMemo(() => (data?.items || []).filter(item => item.batch == null && item.active && (item.catalog_status == null || item.catalog_status === 'canonical') && CUMULATIVE_PHASES.includes(item.phase)), [data?.items])

  function keyFor(phase, itemType) { return `${phase}|${itemType}` }

  function optionsFor(phase, itemType) {
    return sortProgressItems(items.filter(item => item.phase === phase && item.item_type === itemType && Number.isInteger(Number(item.sort_order))))
  }

  function progressFor(phase, itemType) {
    return batchProgress.find(row => row.phase === phase && row.item_type === itemType) || null
  }

  function previewFor(phase, itemType) {
    const key = keyFor(phase, itemType)
    const progress = progressFor(phase, itemType)
    const options = optionsFor(phase, itemType)
    const selectedId = selected[key] || progress?.covered_through_coursework_item_id || ""
    if (!selectedId) return null
    return previews[key] || buildProgressPreview({
      globalItems: options,
      activations: batchAssignments,
      currentProgress: progress,
      phase,
      itemType,
      targetItemId: selectedId,
      activeStudentCount,
    })
  }

  async function requestProgress(phase, itemType, action, confirmBackward = false) {
    const key = keyFor(phase, itemType)
    const targetId = selected[key] || progressFor(phase, itemType)?.covered_through_coursework_item_id || ""
    if (!targetId) return
    setSavingKey(key)
    setWarnings(current => ({ ...current, [key]: "" }))
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, batch, phase, itemType, coveredThroughCourseworkItemId: targetId, confirmBackward }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (payload.code === "BACKWARD_PROGRESS_REQUIRES_CONFIRMATION") {
          setWarnings(current => ({ ...current, [key]: payload.error || "Backward progress requires confirmation." }))
          setPreviews(current => ({ ...current, [key]: payload.preview }))
          return
        }
        throw new Error(payload.error || "Could not update cumulative progress.")
      }
      if (action === "preview-progress") setPreviews(current => ({ ...current, [key]: payload.preview }))
      else {
        setPreviews(current => ({ ...current, [key]: payload.preview || null }))
        await onRefresh()
      }
    } catch (error) {
      setWarnings(current => ({ ...current, [key]: error.message }))
    } finally {
      setSavingKey("")
    }
  }

  return <section className="card admin-panel grid gap-3" aria-label="Batch progress">
    <div>
      <h3 className="text-lg font-bold">Batch Progress · Covered through</h3>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Release coursework cumulatively within each phase and type. Earlier phases and earlier released items remain active; future ordered items stay hidden.
      </p>
    </div>
    <div className="grid gap-3">
      {CUMULATIVE_PHASES.map(phase => TYPES.map(([itemType, label]) => {
        const key = keyFor(phase, itemType)
        const options = optionsFor(phase, itemType)
        const progress = progressFor(phase, itemType)
        const selectedId = selected[key] || progress?.covered_through_coursework_item_id || ""
        const preview = previewFor(phase, itemType)
        const warning = warnings[key]
        return <div className="admin-row grid gap-2" key={key}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span><b>{phase} · {label}</b><small className="block" style={{ color: "var(--text-muted)" }}>{progress ? `Current release: ${options.find(item => item.id === progress.covered_through_coursework_item_id)?.title || `sort ${progress.covered_through_sort_order}`}` : "Not released yet"}</small></span>
            {preview && <span className="badge-pending">{preview.newItemCount} new · {preview.activeStudentCount} active students</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select className="select md:col-span-2" value={selectedId} onChange={event => { setSelected(current => ({ ...current, [key]: event.target.value })); setPreviews(current => ({ ...current, [key]: null })); setWarnings(current => ({ ...current, [key]: "" })) }} disabled={disabled || !options.length} aria-label={`${phase} ${itemType} covered through`}>
              <option value="">{options.length ? "Select covered-through item" : "Ordering required before release"}</option>
              {options.map(item => <option key={item.id} value={item.id}>#{item.sort_order} · {item.title}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" disabled={disabled || !selectedId || savingKey === key} onClick={() => requestProgress(phase, itemType, "preview-progress")}>Preview release</button>
          </div>
          {preview && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{preview.previewText} Existing activations are retained.</p>}
          {warning && <div className="grid gap-2"><p className="text-xs" style={{ color: "var(--danger)" }}>{warning}</p><button type="button" className="btn btn-secondary btn-sm" disabled={savingKey === key} onClick={() => requestProgress(phase, itemType, "set-progress", true)}>Confirm review and retain existing higher release</button></div>}
          {selectedId && !warning && <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={disabled || savingKey === key} onClick={() => requestProgress(phase, itemType, "set-progress")}>{savingKey === key ? "Saving…" : "Apply cumulative release"}</button>}
        </div>
      }))}
    </div>
  </section>
}
