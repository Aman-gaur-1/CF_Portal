"use client"

import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"

function typeLabel(value) {
  return String(value || "").toLowerCase() === "project" ? "Project" : "Assignment"
}

function pointsForType(value) {
  return String(value || "").toLowerCase() === "project" ? 10 : 5
}

function formatDate(value) {
  if (!value) return "Unknown date"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString()
}

export default function CorrectCourseworkMappingModal({ submission, token, onClose, onSaved, showError, success }) {
  const [details, setDetails] = useState(null)
  const [selectedTarget, setSelectedTarget] = useState("")
  const [search, setSearch] = useState("")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load(targetId = "") {
    if (!submission?.id || !token) return
    const query = new URLSearchParams({ submissionId: submission.id })
    if (targetId) query.set("targetCanonicalCourseworkItemId", targetId)
    const res = await fetch(`/api/admin-submission-mapping?${query.toString()}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "Could not load mapping details.")
    setDetails(data)
    if (!targetId && data.canonicalItems?.length) {
      const currentId = data.currentMapping?.id || ""
      setSelectedTarget(currentId && data.canonicalItems.some(item => String(item.id) === String(currentId)) ? "" : String(data.canonicalItems[0].id))
    }
  }

  useEffect(() => {
    load().catch(error => showError(error.message || "Could not load mapping details.")).finally(() => setLoading(false))
  }, [submission?.id, token])

  useEffect(() => {
    if (!selectedTarget) {
      setDetails(current => current ? { ...current, preview: null } : current)
      return
    }
    setPreviewLoading(true)
    load(selectedTarget)
      .catch(error => showError(error.message || "Could not preview mapping correction."))
      .finally(() => setPreviewLoading(false))
  }, [selectedTarget])

  const items = details?.canonicalItems || []
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return items
    return items.filter(item => `${item.phase} ${item.item_type} ${item.title}`.toLowerCase().includes(query))
  }, [items, search])

  async function save() {
    if (!selectedTarget || !reason.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin-submission-mapping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          submissionId: submission.id,
          targetCanonicalCourseworkItemId: selectedTarget,
          reason: reason.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not correct coursework mapping.")
      success("Coursework mapping corrected. Scores were recalculated from canonical facts.")
      onSaved?.(data.correction)
      onClose()
    } catch (error) {
      showError(error.message || "Could not correct coursework mapping.")
    } finally {
      setSaving(false)
    }
  }

  const current = details?.currentMapping
  const preview = details?.preview
  const after = preview?.after

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }} role="dialog" aria-modal="true" aria-label="Correct Coursework Mapping">
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Admin-only action</p>
            <h2 className="text-xl font-bold mt-1">Correct Coursework Mapping</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Canonical coursework determines phase, type, and the fixed 5/10-point score.</p>
          </div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onClose}>Close</button>
        </div>

        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
          <div className="grid gap-4">
            <section className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="grid gap-2 text-sm">
                <div><b>Student:</b> {details?.submission?.student_name || "Student"}</div>
                <div><b>Batch:</b> {details?.submission?.batch || "No batch"}</div>
                <div><b>Original submitted topic:</b> {details?.submission?.topic || "Untitled coursework"}</div>
                <div><b>Submitted:</b> {formatDate(details?.submission?.submitted_at)}</div>
                <div><b>Current mapping:</b> {current ? `${current.phase} → ${typeLabel(current.itemType)} → ${current.title} · ${pointsForType(current.itemType)} pts` : "Unmapped legacy coursework"}</div>
              </div>
            </section>

            <section className="grid gap-2">
              <label className="label">Phase / canonical coursework search
                <input className="input mt-1" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by phase, type, or title" />
              </label>
              <label className="label">Canonical Coursework
                <select className="input mt-1" value={selectedTarget} onChange={event => setSelectedTarget(event.target.value)}>
                  <option value="">Select canonical coursework</option>
                  {['Python', 'Data Analytics', 'SQL'].map(phase => {
                    const phaseItems = visibleItems.filter(item => item.phase === phase)
                    if (!phaseItems.length) return null
                    return (
                      <optgroup key={phase} label={phase}>
                        {['assignment', 'project'].map(itemType => phaseItems.filter(item => item.item_type === itemType).map(item => (
                          <option key={item.id} value={item.id}>{typeLabel(item.item_type)} · {item.title}</option>
                        )))}
                      </optgroup>
                    )
                  })}
                </select>
              </label>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Only active global canonical curriculum items are selectable. This action never creates or activates coursework.</p>
            </section>

            {previewLoading ? <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}><Spinner /> Calculating score impact…</div> : preview && (
              <section className="rounded-xl p-4 grid gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><p className="text-xs uppercase" style={{ color: "var(--text-muted)" }}>Before</p><p className="font-semibold">{preview.before.itemType ? `${typeLabel(preview.before.itemType)} · ${preview.before.points} pts` : "Legacy / unmapped"}</p><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{preview.before.title || "No canonical item"}</p></div>
                  <div><p className="text-xs uppercase" style={{ color: "var(--text-muted)" }}>After</p><p className="font-semibold">{typeLabel(after.itemType)} · {after.points} pts</p><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{after.phase} → {after.title}</p></div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div><span style={{ color: "var(--text-muted)" }}>Coursework points</span><br /><b>{preview.before.courseworkPoints} → {after.courseworkPoints}</b></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Assignments</span><br /><b>{preview.before.assignmentCount} → {after.assignmentCount}</b></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Projects</span><br /><b>{preview.before.projectCount} → {after.projectCount}</b></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Health Card total</span><br /><b>{after.healthCardTotal == null ? "Preview after save" : `${preview.before.healthCardTotal} → ${after.healthCardTotal}`}</b></div>
                </div>
                {after.activeForBatch ? <p className="text-xs badge-done">Active for this batch</p> : <p className="text-xs badge-pending">Not currently released for this batch. This correction will not activate it.</p>}
                {preview.duplicateTarget && <p className="text-sm rounded-lg p-3" style={{ background: "var(--badge-pending-bg)", color: "var(--badge-pending-color)" }}>This student has already completed this canonical coursework. Correcting this mapping will not award additional points.</p>}
                {!preview.rankPreviewAvailable && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Batch rank will be recalculated from canonical facts after saving.</p>}
              </section>
            )}

            <label className="label">Correction reason (required)
              <textarea className="input mt-1" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Historical submission classified incorrectly." />
            </label>

            {details?.history?.length > 0 && <section className="grid gap-2"><p className="text-sm font-semibold">Correction History</p>{details.history.map(row => <div className="rounded-lg p-3 text-sm" key={row.id} style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><b>{formatDate(row.corrected_at)} · {row.admin_name}</b><div>From: {row.old_canonical_title || "Unmapped"} {row.old_item_type ? `· ${typeLabel(row.old_item_type)} · ${pointsForType(row.old_item_type)} pts` : ""}</div><div>To: {row.new_canonical_title} · {typeLabel(row.new_item_type)} · {pointsForType(row.new_item_type)} pts</div><div style={{ color: "var(--text-secondary)" }}>Reason: {row.reason}</div></div>)}</section>}

            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Confirming changes the canonical classification used for progress, Coursework Points, and leaderboard ranking. Original submission history remains preserved.</p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={save} disabled={saving || previewLoading || !selectedTarget || reason.trim().length < 5}>{saving ? "Saving…" : "Confirm Correction"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
