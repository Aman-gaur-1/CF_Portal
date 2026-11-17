"use client"

import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"

export default function StudentCourseworkMappingModal({ submission, token, onClose, onSaved, success, showError }) {
  const [options, setOptions] = useState([])
  const [selected, setSelected] = useState("")
  const [request, setRequest] = useState(null)
  const [safeSuggestion, setSafeSuggestion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/student-coursework-mapping?submissionId=${encodeURIComponent(submission.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Could not load coursework options.")
        setOptions(data.canonicalItems || [])
        setRequest(data.request || null)
        setSafeSuggestion(data.safeSuggestion || null)
        setSelected(data.request?.target_coursework_item_id || data.safeSuggestion?.item?.id || "")
      })
      .catch(error => { if (error.name !== "AbortError") showError(error.message || "Could not load coursework options.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [showError, submission.id, token])

  async function save() {
    if (!selected) {
      showError("Choose the canonical assignment or project first.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/student-coursework-mapping", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ submissionId: submission.id, targetCanonicalCourseworkItemId: selected }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save coursework mapping.")
      success(data.status === "auto_applied" ? (data.duplicateTarget ? "Mapped for reference; this coursework already counted once." : "Coursework mapped and points updated.") : "Mapping sent for Trainer review. It will not count until approved.")
      onSaved?.(data)
      onClose?.()
    } catch (error) {
      showError(error.message || "Could not save coursework mapping.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.45)" }} role="dialog" aria-modal="true" aria-labelledby="student-mapping-title">
      <div className="card w-full max-w-xl p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div><p id="student-mapping-title" className="text-lg font-bold">Map Coursework</p><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Your submission: <b>{submission.topic || "Untitled coursework"}</b></p></div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>Close</button>
        </div>
        {loading ? <div className="flex justify-center py-8"><Spinner /></div> : (
          <div className="grid gap-4">
            {safeSuggestion?.mode === "auto_applied" && <div className="rounded-xl p-3 text-sm" style={{ border: "1px solid var(--success)", background: "rgba(34,197,94,0.08)" }}>Safe match available: <b>{safeSuggestion.item.title}</b>. Selecting this exact match applies immediately.</div>}
            {request?.status === "pending_review" && <div className="rounded-xl p-3 text-sm" style={{ border: "1px solid var(--warning)", background: "rgba(245,158,11,0.08)" }}>A previous choice is awaiting Trainer review. You can update it below.</div>}
            <label className="label">Canonical coursework
              <select className="select mt-1" value={selected} onChange={event => setSelected(event.target.value)}>
                <option value="">Select assignment or project</option>
                {options.map(item => <option key={item.id} value={item.id}>{item.title} · {item.item_type === "project" ? "Project" : "Assignment"}{item.phase ? ` · ${item.phase}` : ""}</option>)}
              </select>
            </label>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Exact or high-confidence matches can apply automatically. Ambiguous matches and type changes go to your Trainer. A coursework item can award points only once per student.</p>
            <div className="flex justify-end gap-2 flex-wrap"><button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>Cancel</button><button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || !selected}>{saving ? <Spinner size="sm" /> : "Save Mapping"}</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

