"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import BatchProgressControls from "@/components/coursework/BatchProgressControls"
import { courseworkIdentity } from "@/lib/coursework-identity"

const PHASES = ["Python", "Data Analytics", "SQL"]
const EMPTY_DATA = { items: [], canonicalItems: [], activations: [], progress: [], extras: [], extrasLoaded: false, canonicalSummary: {}, phaseSummary: {}, activeStudentCount: 0 }

function uniqueBatchNames(batches) {
  return [...new Set((batches || []).map(batch => typeof batch === "string" ? batch : batch?.name).filter(Boolean))]
}

export default function CurriculumPanel({ adminToken, batches = [], success, showError }) {
  const batchNames = useMemo(() => uniqueBatchNames(batches), [batches])
  const [data, setData] = useState(EMPTY_DATA)
  const [batch, setBatch] = useState(batchNames[0] || "")
  const [releaseTargetMode, setReleaseTargetMode] = useState("single")
  const [selectedBatches, setSelectedBatches] = useState(batchNames[0] ? [batchNames[0]] : [])
  const [batchSearch, setBatchSearch] = useState("")
  const [releasePhase, setReleasePhase] = useState("Python")
  const [releaseType, setReleaseType] = useState("assignment")
  const [releaseMode, setReleaseMode] = useState("covered-through")
  const [releaseSearch, setReleaseSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState([])
  const [coveredThroughId, setCoveredThroughId] = useState("")
  const [preview, setPreview] = useState(null)
  const [mappingSelection, setMappingSelection] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [extrasLoading, setExtrasLoading] = useState(false)
  const [extrasError, setExtrasError] = useState("")
  const [extrasOpen, setExtrasOpen] = useState(false)
  const requestSequence = useRef(0)

  useEffect(() => {
    if (!batch && batchNames[0]) setBatch(batchNames[0])
    setSelectedBatches(current => { const next = current.filter(name => batchNames.includes(name)); return next.length ? next : (batchNames[0] ? [batchNames[0]] : []) })
  }, [batch, batchNames])

  const load = useCallback(async ({ signal } = {}) => {
    const sequence = ++requestSequence.current
    setLoading(true)
    try {
      const response = await fetch(`/api/admin-curriculum${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`, { cache: "no-store", signal, headers: { Authorization: `Bearer ${adminToken}` } })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not load curriculum.")
      if (sequence !== requestSequence.current) return
      setData(current => ({ ...EMPTY_DATA, ...current, ...payload }))
      setLoadedOnce(true)
      setLoadError("")
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== requestSequence.current) return
      setLoadError(error.message || "Could not load curriculum.")
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [adminToken, batch])

  useEffect(() => {
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])

  const canonicalItems = useMemo(() => (data.canonicalItems || []).filter(item => item.catalog_status === "canonical" && item.active && item.batch == null), [data.canonicalItems])
  const activeIds = useMemo(() => new Set((data.activations || []).filter(row => row.active).map(row => String(row.coursework_item_id))), [data.activations])
  const activeKeys = useMemo(() => new Set((data.activations || []).filter(row => row.active).map(row => courseworkIdentity(row.item || data.items.find(item => item.id === row.coursework_item_id))).filter(Boolean)), [data.activations, data.items])
  const phaseSummary = useMemo(() => data.phaseSummary && Object.keys(data.phaseSummary).length ? data.phaseSummary : PHASES.reduce((summary, phase) => {
    const items = canonicalItems.filter(item => item.phase === phase)
    summary[phase] = { assignments: items.filter(item => item.item_type === "assignment").length, projects: items.filter(item => item.item_type === "project").length, active: items.filter(item => activeIds.has(String(item.id)) || activeKeys.has(courseworkIdentity(item))).length }
    return summary
  }, {}), [activeIds, activeKeys, canonicalItems, data.phaseSummary])
  const topicItems = useMemo(() => canonicalItems.filter(item => item.phase === releasePhase && item.item_type === releaseType).sort((left, right) => Number(left.sort_order) - Number(right.sort_order) || String(left.title).localeCompare(String(right.title))), [canonicalItems, releasePhase, releaseType])
  const visibleTopicItems = useMemo(() => topicItems.filter(item => !releaseSearch.trim() || `${item.title} ${item.sort_order}`.toLowerCase().includes(releaseSearch.trim().toLowerCase())), [releaseSearch, topicItems])
  const visibleBatches = useMemo(() => batchNames.filter(name => !batchSearch.trim() || name.toLowerCase().includes(batchSearch.trim().toLowerCase())), [batchNames, batchSearch])
  const targetBatchNames = releaseTargetMode === "all" ? batchNames : releaseTargetMode === "selected" ? selectedBatches : (batch ? [batch] : [])
  const hasCanonicalData = loadedOnce && canonicalItems.length > 0

  useEffect(() => {
    setSelectedIds([])
    setCoveredThroughId("")
    setPreview(null)
    if (releaseType === "project" && releaseMode === "covered-through") setReleaseMode("select-topics")
  }, [releasePhase, releaseType, releaseMode])

  function clearReleaseState() {
    setSelectedIds([])
    setCoveredThroughId("")
    setPreview(null)
  }

  function changeTargetMode(value) {
    setReleaseTargetMode(value)
    setPreview(null)
    if (value === "single" && batch) setSelectedBatches([batch])
  }

  function changeSingleBatch(value) {
    setBatch(value)
    setSelectedBatches(value ? [value] : [])
    clearReleaseState()
  }

  function toggleBatch(name, checked) {
    setSelectedBatches(current => checked ? [...new Set([...current, name])] : current.filter(value => value !== name))
    setPreview(null)
  }

  function selectVisibleBatches(checked) {
    setSelectedBatches(current => checked ? [...new Set([...current, ...visibleBatches])] : current.filter(name => !visibleBatches.includes(name)))
    setPreview(null)
  }

  function selectVisibleTopics(checked) {
    setSelectedIds(current => checked ? [...new Set([...current, ...visibleTopicItems.map(item => item.id)])] : current.filter(id => !visibleTopicItems.some(item => item.id === id)))
    setPreview(null)
  }

  function payloadFor(action = "bulk-preview") {
    return {
      action,
      targetMode: releaseTargetMode,
      batch: releaseTargetMode === "single" ? batch : undefined,
      batchNames: releaseTargetMode === "selected" ? selectedBatches : undefined,
      releaseMode,
      phase: releasePhase,
      itemType: releaseType,
      courseworkItemIds: releaseMode === "select-topics" ? selectedIds : undefined,
      coveredThroughCourseworkItemId: releaseMode === "covered-through" ? coveredThroughId : undefined,
    }
  }

  async function previewRelease() {
    if (!targetBatchNames.length) { showError("Select at least one target batch."); return }
    if (releaseMode === "select-topics" && !selectedIds.length) { showError("Select at least one canonical topic."); return }
    if (releaseMode === "covered-through" && !coveredThroughId) { showError("Select the topic covered through."); return }
    setSaving(true)
    try {
      const response = await fetch("/api/admin-curriculum", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify(payloadFor()) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not preview this release.")
      setPreview(payload.preview)
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  async function confirmRelease() {
    if (!preview?.previewToken) { showError("Preview this release before confirming it."); return }
    setSaving(true)
    try {
      const action = releaseMode === "covered-through" ? "bulk-set-progress" : "bulk-activate"
      const response = await fetch("/api/admin-curriculum", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ ...payloadFor(action), previewToken: preview.previewToken }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (payload.preview) setPreview(payload.preview)
        throw new Error(payload.error || "Could not apply this release.")
      }
      success(`${releaseMode === "covered-through" ? "Covered Through" : "Selected coursework"} released to ${preview.batchCount} batch${preview.batchCount === 1 ? "" : "es"}.`)
      clearReleaseState()
      await load()
    } catch (error) { showError(error.message) } finally { setSaving(false) }
  }

  const loadExtras = useCallback(async () => {
    setExtrasLoading(true)
    setExtrasError("")
    try {
      const response = await fetch(`/api/admin-curriculum?view=extras${batch ? `&batch=${encodeURIComponent(batch)}` : ""}`, { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not load Extras.")
      setData(current => ({ ...current, extras: payload.extras || [], extrasLoaded: true }))
    } catch (error) { setExtrasError(error.message || "Could not load Extras.") } finally { setExtrasLoading(false) }
  }, [adminToken, batch])

  function toggleExtras() {
    const next = !extrasOpen
    setExtrasOpen(next)
    if (next && !data.extrasLoaded) loadExtras()
  }

  async function updateExtra(aliasId, action, canonicalCourseworkItemId = "") {
    if (action === "map-extra" && !canonicalCourseworkItemId) { showError("Select a canonical target before mapping."); return }
    setSaving(true)
    try {
      const response = await fetch("/api/admin-curriculum", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ action, aliasId, canonicalCourseworkItemId }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Could not update the Extra.")
      success(action === "map-extra" ? "Legacy alias mapped to canonical coursework." : "Extra retained for review.")
      await loadExtras()
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

  if (loading && !loadedOnce) return <section className="card admin-panel grid gap-3"><h3 className="text-lg font-bold">Canonical Curriculum</h3><div className="flex items-center gap-2 py-8 justify-center"><Spinner size="lg" /><span className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading canonical curriculum…</span></div></section>
  if (loadError && !hasCanonicalData) return <section className="card admin-panel grid gap-3"><h3 className="text-lg font-bold">Could not load Curriculum</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{loadError}</p><button className="btn btn-primary btn-sm justify-self-start" type="button" onClick={() => load()} disabled={loading}>Retry</button></section>

  return <div className="grid gap-4">
    {loadError && <div className="card admin-panel flex items-center justify-between gap-3 flex-wrap" role="status"><p className="text-sm">Refresh failed — showing last loaded data.</p><button className="btn btn-secondary btn-sm" type="button" onClick={() => load()} disabled={loading}>Retry</button></div>}

    <section className="card admin-panel grid gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Canonical Curriculum</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>47 official items. This screen releases existing canonical coursework; historical Extras stay separate and are never silently released.</p></div><RefreshButton onClick={() => load()} disabled={loading} /></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2" aria-label="Canonical curriculum summary">
        {PHASES.map(phase => { const summary = phaseSummary[phase] || {}; return <div className="stat-card" key={phase}><div className="stat-label">{phase}</div><div className="text-sm mt-1">{summary.assignments || 0} Assignments · {summary.projects || 0} Projects</div><div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Active for selected batch: {summary.active || 0}</div></div> })}
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loaded canonical definitions: {canonicalItems.length} · selected batch: {batch || "none"}</p>
    </section>

    <section className="card admin-panel grid gap-3" aria-label="Bulk release coursework">
      <div><h3 className="text-lg font-bold">Bulk Release Coursework</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>Choose target batches, then either advance cumulative progress or release specific canonical topics. A preview is always required.</p></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="grid gap-1 text-sm">Target mode<select className="select" value={releaseTargetMode} onChange={event => changeTargetMode(event.target.value)}><option value="single">One Batch</option><option value="selected">Selected Batches</option><option value="all">All Current Batches</option></select></label>
        {releaseTargetMode === "single" && <label className="grid gap-1 text-sm">Batch<select className="select" value={batch} onChange={event => changeSingleBatch(event.target.value)}><option value="">Select batch</option>{batchNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
        {releaseTargetMode !== "single" && <div className="text-sm self-end pb-2"><b>{releaseTargetMode === "all" ? batchNames.length : selectedBatches.length} batch{(releaseTargetMode === "all" ? batchNames.length : selectedBatches.length) === 1 ? "" : "es"} selected</b></div>}
        <label className="grid gap-1 text-sm">Phase<select className="select" value={releasePhase} onChange={event => { setReleasePhase(event.target.value); clearReleaseState() }}>{PHASES.map(phase => <option key={phase} value={phase}>{phase}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Type<select className="select" value={releaseType} onChange={event => { setReleaseType(event.target.value); clearReleaseState() }}><option value="assignment">Assignment</option><option value="project">Project</option></select></label>
      </div>

      {releaseTargetMode === "selected" && <div className="grid gap-2"><div className="flex gap-2 flex-wrap"><input className="input" value={batchSearch} onChange={event => setBatchSearch(event.target.value)} placeholder="Search batches" aria-label="Search target batches" /><button className="btn btn-secondary btn-sm" type="button" onClick={() => selectVisibleBatches(true)} disabled={!visibleBatches.length}>Select all visible</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => selectVisibleBatches(false)} disabled={!visibleBatches.length}>Clear visible</button></div><div className="grid gap-1 max-h-48 overflow-auto border rounded-lg p-2">{visibleBatches.map(name => <label className="flex items-center gap-2 text-sm" key={name}><input type="checkbox" checked={selectedBatches.includes(name)} onChange={event => toggleBatch(name, event.target.checked)} />{name}</label>)}{!visibleBatches.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No batches match the search.</p>}</div></div>}
      {releaseTargetMode === "all" && <p className="text-sm" style={{ color: "var(--portal-warning, #b45309)" }}>All Current Batches is high impact. The server will validate every batch and will not apply anything until you review and confirm the preview.</p>}

      <div className="grid gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex gap-3 flex-wrap items-center"><span className="text-sm font-semibold">Release mode</span><label className="flex items-center gap-2 text-sm"><input type="radio" name="curriculum-release-mode" checked={releaseMode === "covered-through"} onChange={() => { setReleaseMode("covered-through"); clearReleaseState() }} /> Covered Through</label><label className="flex items-center gap-2 text-sm"><input type="radio" name="curriculum-release-mode" checked={releaseMode === "select-topics"} onChange={() => { setReleaseMode("select-topics"); clearReleaseState() }} /> Select Topics</label></div>
        {releaseMode === "covered-through" ? <label className="grid gap-1 text-sm">Release through this topic<select className="select" value={coveredThroughId} onChange={event => { setCoveredThroughId(event.target.value); setPreview(null) }}><option value="">Select covered-through item</option>{topicItems.map(item => <option key={item.id} value={item.id}>#{item.sort_order} · {item.title}</option>)}</select><small style={{ color: "var(--text-muted)" }}>Assignments are cumulative. A batch already beyond this position stays unchanged.</small></label> : <div className="grid gap-2"><div className="flex gap-2 flex-wrap"><input className="input" value={releaseSearch} onChange={event => setReleaseSearch(event.target.value)} placeholder="Search canonical topics" aria-label="Search canonical topics" /><button className="btn btn-secondary btn-sm" type="button" onClick={() => selectVisibleTopics(true)} disabled={!visibleTopicItems.length}>Select all visible</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => selectVisibleTopics(false)} disabled={!visibleTopicItems.length}>Clear visible</button></div><p className="text-xs" style={{ color: "var(--text-muted)" }}>{selectedIds.length} selected · {topicItems.length} ordered canonical {releaseType}{topicItems.length === 1 ? "" : "s"}</p><div className="grid gap-1 max-h-72 overflow-auto border rounded-lg p-2">{visibleTopicItems.map(item => <label className="flex items-center gap-2 text-sm" key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => { setSelectedIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setPreview(null) }} /> <span>#{item.sort_order} · {item.title}</span></label>)}{!visibleTopicItems.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No canonical topics match.</p>}</div></div>}
        <button className="btn btn-primary justify-self-start" type="button" onClick={previewRelease} disabled={saving || !targetBatchNames.length}>{saving ? "Preparing preview…" : "Preview Release"}</button>
      </div>

      {preview && <div className="grid gap-3 rounded-lg border p-3" style={{ borderColor: "var(--primary)", background: "var(--surface-strong)" }} aria-label="Release preview"><div className="flex items-center justify-between gap-3 flex-wrap"><div><h4 className="font-bold">Preview impact</h4><p className="text-xs" style={{ color: "var(--text-secondary)" }}>{preview.batchCount} batch{preview.batchCount === 1 ? "" : "es"} · {preview.selectedCourseworkCount} selected canonical item{preview.selectedCourseworkCount === 1 ? "" : "s"}</p></div><span className="badge-pending">Preview required before confirm</span></div><div className="grid grid-cols-2 md:grid-cols-5 gap-2">{[[preview.newActivations, "New activations"], [preview.alreadyActive, "Already active"], [preview.duplicateEquivalentSkipped, "Equivalent skipped"], [preview.activeStudentsAffected, "Active students"], [preview.expectedPendingImpact, "Expected/pending impact"]].map(([value, label]) => <div className="stat-card" key={label}><div className="stat-num text-base">{value}</div><div className="stat-label">{label}</div></div>)}</div><div className="grid gap-1 max-h-56 overflow-auto">{(preview.batches || []).map(row => <div className="flex justify-between gap-3 text-sm" key={row.batch}><span className="truncate">{row.batch}</span><span className="text-right" style={{ color: "var(--text-secondary)" }}>{row.status === "already_beyond" ? `Already beyond #${row.currentSortOrder} — unchanged` : `${row.newActivations} new · ${row.alreadyActive} active · ${row.activeStudentCount} students`}</span></div>)}</div><p className="text-sm font-semibold">Release this coursework to {preview.batchCount} batch{preview.batchCount === 1 ? "" : "es"}?</p><button className="btn btn-primary justify-self-start" type="button" onClick={confirmRelease} disabled={saving}>{saving ? "Applying…" : "Confirm Release"}</button></div>}
    </section>

    <BatchProgressControls endpoint="/api/admin-curriculum" token={adminToken} batch={batch} data={data} onRefresh={load} disabled={!batch || saving} />

    <section className="card admin-panel"><div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Extras · Needs Review</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>Historical aliases are separate from the 47 canonical definitions. Load this review only when needed.</p></div><button className="btn btn-secondary btn-sm" type="button" onClick={toggleExtras} disabled={extrasLoading}>{extrasLoading ? "Loading Extras…" : extrasOpen ? "Hide Extras" : "Review Extras"}</button></div>{extrasOpen && <div className="grid gap-2 mt-3">{extrasError && <div className="flex items-center justify-between gap-2"><p className="text-sm">{extrasError}</p><button className="btn btn-secondary btn-sm" type="button" onClick={loadExtras}>Retry</button></div>}{(data.extras || []).map(extra => <div className="admin-row grid gap-2" key={extra.alias_id}><div className="flex items-start justify-between gap-3 flex-wrap"><span><b>{extra.original_alias}</b><small className="block" style={{ color: "var(--text-muted)" }}>{extra.suggested_phase || "Phase needs review"} · {extra.suggested_item_type || "type needs review"} · {extra.confidence}</small></span><span className="badge-pending">{extra.mapping_status}</span></div><p className="text-xs" style={{ color: "var(--text-secondary)" }}>Mapping this alias would recognize {extra.submission_count} historical submissions from {extra.student_count} students across {extra.batch_count} batches. Original titles and submissions remain unchanged.</p><div className="flex gap-2 flex-wrap"><select className="select" value={mappingSelection[extra.alias_id] || extra.suggested_canonical_coursework_item_id || ""} onChange={event => setMappingSelection(current => ({ ...current, [extra.alias_id]: event.target.value }))}><option value="">Select canonical target</option>{canonicalItems.map(item => <option key={item.id} value={item.id}>{item.phase} · {item.item_type} · {item.title}</option>)}</select><button type="button" className="btn btn-primary btn-sm" disabled={saving || extra.mapping_status === "ignored"} onClick={() => updateExtra(extra.alias_id, "map-extra", mappingSelection[extra.alias_id] || extra.suggested_canonical_coursework_item_id)}>Map to Canonical</button><button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => updateExtra(extra.alias_id, "ignore-extra")}>Ignore / Keep as Extra</button></div></div>)}{data.extrasLoaded && !(data.extras || []).length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No unresolved Extras.</p>}</div>}</section>

    <section className="card admin-panel"><h3 className="text-lg font-bold">Current batch activations</h3><div className="grid gap-2 mt-3">{data.activations.length ? data.activations.map(row => { const item = data.items.find(candidate => candidate.id === row.coursework_item_id); return <div className="admin-row" key={row.id}><span><b>{item?.title || "Coursework item"}</b><small className="block" style={{ color: "var(--text-muted)" }}>{row.batch} · {item?.catalog_status === "canonical" ? "Canonical" : "Legacy continuity"} · started {String(row.activated_at || "").slice(0, 10)} · by {row.activated_by_name}</small></span><button className="btn btn-secondary btn-sm" type="button" onClick={() => setActivation(row.id, !row.active)} disabled={saving}>{row.active ? "Pause" : "Reactivate"}</button></div> }) : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No batch activations for this selection yet.</p>}</div></section>
  </div>
}
