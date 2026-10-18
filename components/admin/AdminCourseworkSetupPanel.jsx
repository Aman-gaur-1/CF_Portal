"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import EmptyState from "@/components/ui/EmptyState"
import RefreshButton from "@/components/ui/RefreshButton"
import Spinner from "@/components/ui/Spinner"
import MetricCard from "@/components/ui/MetricCard"
import SectionHeading from "@/components/ui/SectionHeading"

const PAGE_SIZE = 25

function confidenceClass(confidence) {
  if (confidence === "exact") return "badge-done"
  if (confidence === "safe") return "badge-pending"
  return "badge-failed"
}

function candidateLabel(candidate) {
  if (candidate.catalogStatus === "existing") return "Existing item · link only"
  if (candidate.catalogStatus === "new") return "New catalog item"
  return candidate.catalogStatus?.replaceAll("_", " ") || "Needs review"
}

function isAutoEligible(candidate) {
  return Boolean(candidate?.canLink && candidate.confidence !== "ambiguous" && !(candidate.suspiciousReasons || []).length)
}

function reviewAction(candidate) {
  if ((candidate.suspiciousReasons || []).some(reason => reason.includes("project"))) return "KEEP AS ASSIGNMENT pending authoritative type"
  if (candidate.confidence === "ambiguous") return "REQUIRES HUMAN DECISION"
  if ((candidate.suspiciousReasons || []).some(reason => reason.includes("duplicate"))) return "MERGE WITH EXISTING only after confirmation"
  return "REVIEW NORMALIZATION"
}

export default function AdminCourseworkSetupPanel({ adminToken, success, showError }) {
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState({})
  const [reviewBatch, setReviewBatch] = useState("")
  const [filterText, setFilterText] = useState("")
  const [filterType, setFilterType] = useState("")
  const [filterConfidence, setFilterConfidence] = useState("")
  const [filterReview, setFilterReview] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [dryRunComplete, setDryRunComplete] = useState(false)
  const [dryRunSummary, setDryRunSummary] = useState(null)
  const [confirmation, setConfirmation] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin-coursework/setup", { cache: "no-store", headers: { Authorization: `Bearer ${adminToken}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load coursework setup preview.")
      setPreview(data)
      setDryRunComplete(false)
      setDryRunSummary(null)
      setConfirmation(null)
      setSelected(Object.fromEntries((data.candidates || [])
        .filter(isAutoEligible)
        .map(candidate => [candidate.key, true])))
    } catch (error) {
      showError(error.message || "Could not load coursework setup preview.")
    } finally {
      setLoading(false)
    }
  }, [adminToken, showError])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [reviewBatch, filterText, filterType, filterConfidence, filterReview])

  const visibleCandidates = useMemo(() => {
    const query = filterText.trim().toLowerCase()
    return (preview?.candidates || []).filter(candidate => {
      if (reviewBatch && candidate.batch !== reviewBatch) return false
      if (filterType && candidate.type !== filterType) return false
      if (filterConfidence && candidate.confidence !== filterConfidence) return false
      if (filterReview === "needs_review" && !(candidate.confidence === "ambiguous" || (candidate.suspiciousReasons || []).length)) return false
      if (filterReview === "eligible" && !isAutoEligible(candidate)) return false
      if (query && ![candidate.batch, candidate.proposedTitle, candidate.type, candidate.confidence]
        .some(value => String(value || "").toLowerCase().includes(query))) return false
      return true
    })
  }, [preview, reviewBatch, filterText, filterType, filterConfidence])

  const pageCount = Math.max(1, Math.ceil(visibleCandidates.length / PAGE_SIZE))
  const pagedCandidates = visibleCandidates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedCandidates = useMemo(() => (preview?.candidates || []).filter(candidate => selected[candidate.key] && isAutoEligible(candidate)), [preview, selected])
  const selectedAffectedSubmissions = selectedCandidates.reduce((sum, candidate) => sum + Number(candidate.affectedSubmissions || 0), 0)
  const manualReviewCandidates = useMemo(() => (preview?.candidates || []).filter(candidate => candidate.confidence === "ambiguous" || (candidate.suspiciousReasons || []).length), [preview])

  function resetDryRun() {
    setDryRunComplete(false)
    setDryRunSummary(null)
    setConfirmation(null)
  }

  function updateCandidateTitle(key, title) {
    resetDryRun()
    setPreview(current => current ? { ...current, candidates: current.candidates.map(candidate => candidate.key === key ? { ...candidate, proposedTitle: title } : candidate) } : current)
  }

  function toggleCandidate(key, checked) {
    resetDryRun()
    setSelected(current => ({ ...current, [key]: checked }))
  }

  function selectCandidates(candidates, checked) {
    resetDryRun()
    setSelected(current => ({ ...current, ...Object.fromEntries(candidates.filter(isAutoEligible).map(candidate => [candidate.key, checked])) }))
  }

  function selectAllInBatch(batch) {
    setReviewBatch(batch)
    selectCandidates((preview?.candidates || []).filter(candidate => candidate.batch === batch), true)
  }

  async function runDryRun() {
    setApplying(true)
    try {
      const res = await fetch("/api/admin-coursework/setup", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ mode: "dry-run", candidateKeys: selectedCandidates.map(candidate => candidate.key) }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not run coursework dry-run.")
      const selectedCount = data.selected?.candidates?.length || 0
      const totalCandidates = Number(data.totals?.exactCandidates || 0) + Number(data.totals?.safeCandidates || 0) + Number(data.totals?.ambiguousCandidates || 0)
      setDryRunComplete(true)
      setDryRunSummary({ items: data.selected?.courseworkItemsWouldBeCreated || 0, linked: data.selected?.submissionsWouldBeLinked || 0, skipped: Math.max(0, totalCandidates - selectedCount), manualReview: Number(data.totals?.ambiguousCandidates || 0) + Number(data.totals?.suspiciousCandidates || 0) + Number(data.totals?.unmatchedSubmissions || 0) })
      success(`Dry run: ${data.selected?.courseworkItemsWouldBeCreated || 0} item(s), ${data.selected?.submissionsWouldBeLinked || 0} submission(s). No records changed.`)
    } catch (error) {
      showError(error.message || "Could not run coursework dry-run.")
    } finally {
      setApplying(false)
    }
  }

  async function applyCandidate(candidate) {
    setApplying(true)
    try {
      const res = await fetch("/api/admin-coursework/setup", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ mode: "apply", confirm: true, candidateKey: candidate.key, title: candidate.proposedTitle }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not create or link coursework.")
      success(`${data.created ? "Coursework created" : "Existing coursework linked"}: ${data.linkedCount || 0} submission(s).`)
      await load()
    } catch (error) {
      showError(error.message || "Could not create or link coursework.")
    } finally {
      setApplying(false)
      setConfirmation(null)
    }
  }

  async function applySelected() {
    if (!selectedCandidates.length) return
    setApplying(true)
    let completed = 0
    let linked = 0
    try {
      for (const candidate of selectedCandidates) {
        const res = await fetch("/api/admin-coursework/setup", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ mode: "apply", confirm: true, candidateKey: candidate.key, title: candidate.proposedTitle }) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Could not apply ${candidate.proposedTitle}.`)
        completed += 1
        linked += Number(data.linkedCount || 0)
      }
      success(`Created/linked ${completed} selected candidate(s) and linked ${linked} submission(s).`)
      await load()
    } catch (error) {
      showError(error.message || "The selected setup stopped before all candidates were applied.")
      await load()
    } finally {
      setApplying(false)
      setConfirmation(null)
    }
  }

  if (loading && !preview) return <div className="card admin-panel flex justify-center"><Spinner size="lg" /></div>
  if (!preview) return <EmptyState icon="□" title="Coursework setup unavailable" message="Refresh to try again." action={<RefreshButton onClick={load} disabled={loading} />} />

  const totals = preview.totals || {}
  const batchSummaries = preview.batchSummaries || []
  const configuredItems = preview.configuredItems || []
  const confirmationCandidates = confirmation?.candidate ? [confirmation.candidate] : selectedCandidates
  const confirmationItems = confirmationCandidates.filter(candidate => candidate.catalogStatus === "new").length
  const confirmationLinks = confirmationCandidates.reduce((sum, candidate) => sum + Number(candidate.affectedSubmissions || 0), 0)

  return (
    <div className="grid gap-4">
      <div className="card admin-panel">
        <SectionHeading title="Coursework Setup" detail="Preview detected coursework before creating catalog items or linking submissions." action={<RefreshButton onClick={load} disabled={loading || applying} />} />
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4"><MetricCard label="Examined" value={totals.totalSubmissionsExamined || 0} hint="On/after 1 Oct 2026" /><MetricCard label="Candidates" value={Number(totals.exactCandidates || 0) + Number(totals.safeCandidates || 0) + Number(totals.ambiguousCandidates || 0)} tone="primary" /><MetricCard label="Configured" value={configuredItems.length} hint="Already linked" tone="success" /><MetricCard label="Manual review" value={manualReviewCandidates.length} tone="warning" /><MetricCard label="Suspicious" value={totals.suspiciousCandidates || 0} tone="warning" /><MetricCard label="Unmatched" value={totals.unmatchedSubmissions || 0} /></div>
        <div className="flex gap-2 flex-wrap mt-4"><button type="button" className="btn btn-secondary" onClick={runDryRun} disabled={applying || !selectedCandidates.length}>Run dry run</button><button type="button" className="btn btn-primary" onClick={() => setConfirmation({ kind: "selected" })} disabled={applying || !dryRunComplete || !selectedCandidates.length}>{applying ? <Spinner size="sm" /> : dryRunComplete ? `Review & confirm (${selectedCandidates.length})` : "Run dry run first"}</button></div>
        {dryRunSummary && <div className="admin-summary-row mt-4" aria-live="polite"><div><b>{dryRunSummary.items} coursework items will be created</b><p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{dryRunSummary.linked} submissions will be linked · {dryRunSummary.skipped} candidates skipped · {dryRunSummary.manualReview} submissions/candidates need manual review.</p></div><button type="button" className="btn btn-primary btn-sm" onClick={() => setConfirmation({ kind: "selected" })} disabled={applying || !selectedCandidates.length}>Open confirmation</button></div>}
        <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Only epoch submissions are eligible. Existing links are never overwritten. Due dates remain blank unless authoritative.</p>
      </div>

      {configuredItems.length > 0 && <div className="card admin-panel"><SectionHeading title="Already configured and linked" detail="These epoch coursework items are no longer offered as unlinked candidates." /><div className="grid gap-2 mt-4 max-h-64 overflow-auto">{configuredItems.map(item => <div className="admin-summary-row" key={`${item.id}-${item.batch}`}><span>{item.title} · {item.type} · {item.batch}</span><b>{item.linkedSubmissions} linked</b></div>)}</div></div>}

      <div className="card admin-panel">
        <SectionHeading title="Detected by batch" detail="Candidates are grouped by exact batch and normalized title/type. Merge suggestions are review-only." />
        {batchSummaries.length === 0 ? <EmptyState icon="□" title="No epoch submissions found" message="There is no coursework setup work to review." /> : <div className="grid gap-2 mt-4">{batchSummaries.map(summary => <div className="admin-row" key={summary.batch}><div className="min-w-0"><p className="font-semibold">{summary.batch}</p><p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>Candidates: {summary.candidateCount || 0} · Exact: {summary.exactCandidates || 0} · Safe: {summary.safeCandidates || 0} · Ambiguous: {summary.ambiguousCandidates || 0} · Suspicious: {summary.suspiciousCandidates || 0} · Unmatched: {summary.unmatchedSubmissions || 0}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Assignments: {summary.assignmentsDetected || 0} · Projects: {summary.projectsDetected || 0} · Merge suggestions: {summary.mergeSuggestionCount || 0} · Unlinked submissions: {summary.unlinkedSubmissions || 0}</p></div><div className="flex gap-2 flex-wrap justify-end"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setReviewBatch(summary.batch === reviewBatch ? "" : summary.batch)}>Review</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => selectAllInBatch(summary.batch)}>Select clean</button></div></div>)}</div>}
      </div>

      {manualReviewCandidates.length > 0 && <div className="card admin-panel"><SectionHeading title="Manual review queue" detail="Flagged candidates are visible for review but cannot be selected or applied automatically." /><div className="grid gap-2 mt-4">{manualReviewCandidates.map(candidate => <div className="admin-summary-row items-start" key={`manual-${candidate.key}`}><div className="min-w-0"><p className="font-semibold">{candidate.proposedTitle || "Untitled candidate"}</p><p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{candidate.batch} · {candidate.type || "Unsupported/mixed type"} · {candidate.affectedSubmissions || 0} submission(s) · {candidate.distinctStudents || 0} student(s)</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Raw variants: {(candidate.rawTitleVariants || []).map(variant => `${variant.title || "(blank)"} (${variant.count})`).join(" · ") || "—"}</p><p className="text-xs mt-1" style={{ color: "var(--portal-warning, #b45309)" }}>{(candidate.suspiciousReasons || []).join(" · ") || candidate.reason || "Ambiguous candidate"}</p></div><b className="text-xs text-right">{reviewAction(candidate)}</b></div>)}</div></div>}

      <div className="card admin-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold">{reviewBatch ? `Candidates · ${reviewBatch}` : "Review candidates"}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Review title variants and suspicious/duplicate-looking candidates before the final confirmation.</p></div>{reviewBatch && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReviewBatch("")}>Show all batches</button>}</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mt-4"><input className="input" value={filterText} onChange={event => setFilterText(event.target.value)} placeholder="Search batch or title" aria-label="Search coursework candidates" /><select className="input" value={filterType} onChange={event => setFilterType(event.target.value)} aria-label="Filter coursework type"><option value="">All types</option><option value="assignment">Assignment</option><option value="project">Project</option></select><select className="input" value={filterConfidence} onChange={event => setFilterConfidence(event.target.value)} aria-label="Filter candidate confidence"><option value="">All confidence</option><option value="exact">Exact</option><option value="safe">Safe</option><option value="ambiguous">Ambiguous</option></select><select className="input" value={filterReview} onChange={event => setFilterReview(event.target.value)} aria-label="Filter coursework review status"><option value="">All review status</option><option value="needs_review">Manual review</option><option value="eligible">Clean eligible</option></select><div className="flex gap-2"><button type="button" className="btn btn-secondary btn-sm" onClick={() => selectCandidates(visibleCandidates, true)} disabled={applying || !visibleCandidates.length}>Select visible</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => selectCandidates(visibleCandidates, false)} disabled={applying || !visibleCandidates.length}>Clear visible</button></div></div>
        <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Showing {visibleCandidates.length ? ((page - 1) * PAGE_SIZE) + 1 : 0}–{Math.min(page * PAGE_SIZE, visibleCandidates.length)} of {visibleCandidates.length} candidates · {selectedCandidates.length} selected · {selectedAffectedSubmissions} submissions</p>
        {pagedCandidates.length === 0 ? <EmptyState icon="✓" title="No candidates to review" message="Adjust the filters or refresh after new submissions arrive." /> : <div className="grid gap-3 mt-4">{pagedCandidates.map(candidate => <div className="admin-row items-start" key={candidate.key}><div className="min-w-0 flex-1"><div className="flex gap-2 flex-wrap items-center"><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(selected[candidate.key])} onChange={event => toggleCandidate(candidate.key, event.target.checked)} disabled={!isAutoEligible(candidate) || applying} /><span className="font-semibold">{candidate.type || "Mixed type"}</span></label><span className={confidenceClass(candidate.confidence)}>{candidate.confidence}</span><span className="badge-pending">{candidateLabel(candidate)}</span>{candidate.suspiciousReasons?.length > 0 && <span className="badge-failed">Needs review</span>}</div><div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3"><label className="grid gap-1 text-xs md:col-span-2" style={{ color: "var(--text-secondary)" }}>Proposed title<input className="input" value={candidate.proposedTitle || ""} onChange={event => updateCandidateTitle(candidate.key, event.target.value)} disabled={!isAutoEligible(candidate) || applying} /></label><div className="text-xs" style={{ color: "var(--text-secondary)" }}><p>Batch</p><b>{candidate.batch}</b><p className="mt-2">Affected submissions</p><b>{candidate.affectedSubmissions} · {candidate.distinctStudents} student(s)</b></div><div className="text-xs" style={{ color: "var(--text-secondary)" }}><p>First submission</p><b>{candidate.firstSubmissionDate || "—"}</b><p className="mt-2">Due date</p><b>Not set</b></div></div><p className="text-xs mt-3" style={{ color: "var(--text-secondary)" }}>Raw title variants: {(candidate.rawTitleVariants || []).map(variant => `${variant.title || "(blank)"} (${variant.count})`).join(" · ") || "—"}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{candidate.reason}</p>{candidate.suspiciousReasons?.map(reason => <p className="text-xs mt-1" style={{ color: "var(--portal-warning, #b45309)" }} key={reason}>{reason}</p>)}</div><div className="flex gap-2 flex-wrap justify-end"><button type="button" className="btn btn-primary btn-sm" onClick={() => setConfirmation({ kind: "single", candidate })} disabled={applying || !dryRunComplete || !isAutoEligible(candidate)}>{candidate.catalogStatus === "existing" ? "Link" : "Create & Link"}</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleCandidate(candidate.key, false)} disabled={applying}>Skip</button></div></div>)}</div>}
        {pageCount > 1 && <div className="flex items-center justify-between gap-3 mt-4"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button><span className="text-xs" style={{ color: "var(--text-muted)" }}>Page {page} of {pageCount}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>Next</button></div>}
      </div>

      {confirmation && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.55)" }} role="presentation" onClick={() => !applying && setConfirmation(null)}><div className="card admin-panel max-w-xl w-full" role="dialog" aria-modal="true" aria-labelledby="coursework-confirmation-title" onClick={event => event.stopPropagation()}><h3 id="coursework-confirmation-title" className="text-lg font-bold">Confirm coursework setup</h3><p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>This action will create/link only the reviewed epoch candidates below. It will not invent due dates or overwrite existing submission links.</p><div className="grid gap-2 mt-4"><div className="admin-summary-row"><span>Coursework items to create</span><b>{confirmationItems}</b></div><div className="admin-summary-row"><span>Submissions to link</span><b>{confirmationLinks}</b></div><div className="admin-summary-row"><span>Due dates</span><b>None</b></div></div><div className="flex justify-end gap-2 mt-5"><button type="button" className="btn btn-secondary" onClick={() => setConfirmation(null)} disabled={applying}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => confirmation.kind === "single" ? applyCandidate(confirmation.candidate) : applySelected()} disabled={applying}>{applying ? <Spinner size="sm" /> : confirmation.kind === "single" ? "Confirm create & link" : "Confirm selected setup"}</button></div></div></div>}
    </div>
  )
}
