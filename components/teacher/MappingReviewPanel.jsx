"use client"

import { useCallback, useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"

export default function MappingReviewPanel({ teacherToken, success, showError }) {
  const [requests, setRequests] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [targets, setTargets] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/teacher-coursework-mapping-review", { headers: { Authorization: `Bearer ${teacherToken}` }, cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load mapping review.")
      setRequests(data.requests || [])
      setItems(data.canonicalItems || [])
      setTargets(current => {
        const next = { ...current }
        for (const row of data.requests || []) if (!next[row.id]) next[row.id] = row.target_coursework_item_id || ""
        return next
      })
    } catch (error) {
      showError(error.message || "Could not load mapping review.")
    } finally {
      setLoading(false)
    }
  }, [showError, teacherToken])

  useEffect(() => { load() }, [load])

  async function decide(row, decision) {
    const target = targets[row.id] || ""
    if (decision === "approve" && !target) {
      showError("Select a canonical coursework item before approving.")
      return
    }
    setBusyId(row.id)
    try {
      const res = await fetch("/api/teacher-coursework-mapping-review", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${teacherToken}` }, body: JSON.stringify({ requestId: row.id, decision, targetCanonicalCourseworkItemId: target, reason: decision === "reject" ? "Trainer rejected the proposed coursework mapping." : "Trainer approved the canonical coursework mapping." }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save mapping review.")
      setRequests(current => current.filter(request => String(request.id) !== String(row.id)))
      success(decision === "approve" ? (data.duplicateTarget ? "Approved mapping; duplicate target received no extra points." : "Mapping approved and scored canonically.") : "Mapping rejected. The submission remains unscored.")
    } catch (error) {
      showError(error.message || "Could not save mapping review.")
    } finally {
      setBusyId(null)
    }
  }

  if (loading && requests.length === 0) return <div className="card p-4 mb-5"><div className="flex items-center gap-2 text-sm"><Spinner size="sm" /> Loading mapping review…</div></div>
  if (!requests.length) return null

  return (
    <section className="card p-4 mb-5" aria-labelledby="mapping-review-title">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div><p id="mapping-review-title" className="text-base font-bold">Coursework Mapping Review</p><p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{requests.length} student mapping request{requests.length === 1 ? "" : "s"} in your assigned batches.</p></div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>{loading ? <Spinner size="sm" /> : "Refresh"}</button>
      </div>
      <div className="grid gap-3">
        {requests.map(row => {
          const submission = row.submission
          return <div key={row.id} className="rounded-xl p-3" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
            <div className="flex items-start justify-between gap-3 flex-wrap"><div><p className="font-semibold">{submission?.student_name || row.requested_by_name} · {submission?.topic || row.source_topic}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{submission?.batch || row.batch} · {submission?.phase || row.source_phase || "No phase"} · submitted {submission?.submitted_at ? new Date(submission.submitted_at).toLocaleDateString("en-IN") : "date unavailable"}</p></div><span className="badge-mapping-pending">Pending Review</span></div>
            <div className="grid gap-2 mt-3 md:grid-cols-[1fr_auto_auto] md:items-end">
              <label className="label">Canonical coursework<select className="select mt-1" value={targets[row.id] || ""} onChange={event => setTargets(current => ({ ...current, [row.id]: event.target.value }))}><option value="">Select assignment or project</option>{items.map(item => <option key={item.id} value={item.id}>{item.title} · {item.item_type === "project" ? "Project" : "Assignment"}{item.phase ? ` · ${item.phase}` : ""}</option>)}</select></label>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(row, "approve")} disabled={busyId === row.id || !targets[row.id]}>{busyId === row.id ? <Spinner size="sm" /> : "Approve"}</button>
              <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => decide(row, "reject")} disabled={busyId === row.id}>{busyId === row.id ? <Spinner size="sm" /> : "Reject"}</button>
            </div>
          </div>
        })}
      </div>
    </section>
  )
}

