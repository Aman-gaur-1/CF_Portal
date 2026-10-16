"use client"

import { useCallback, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import SectionHeading from "@/components/ui/SectionHeading"
import EmptyState from "@/components/ui/EmptyState"

function confidenceLabel(confidence) {
  if (confidence === "exact") return "Exact match"
  if (confidence === "high") return "Close match"
  if (confidence === "low") return "Possible match"
  return "No match"
}

function confidenceTone(confidence) {
  if (confidence === "exact") return "var(--success)"
  if (confidence === "high") return "var(--success)"
  if (confidence === "low") return "var(--warning)"
  return "var(--danger)"
}

export default function AttendanceUpload({ token, batches = [], role = "teacher", onUploaded }) {
  const [batch, setBatch] = useState("")
  const [date, setDate] = useState("")
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState("")
  const [uncertainSelections, setUncertainSelections] = useState({})
  const fileRef = useRef(null)

  const reset = useCallback(() => {
    setPreview(null)
    setResult(null)
    setError("")
    setFile(null)
    setUncertainSelections({})
    if (fileRef.current) fileRef.current.value = ""
  }, [])

  async function handlePreview(e) {
    e.preventDefault()
    if (!batch || !date || !file) { setError("Select a batch, date, and file."); return }
    setUploading(true)
    setError("")
    setPreview(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append("action", "preview")
      fd.append("batch", batch)
      fd.append("date", date)
      fd.append("file", file)
      const res = await fetch("/api/attendance-upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Upload failed.")
      setPreview(data.preview)
      const initial = {}
      for (const u of (data.preview?.uncertain || [])) {
        initial[u.fileName] = true
      }
      setUncertainSelections(initial)
    } catch (err) {
      setError(err.message || "Could not preview upload.")
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirm() {
    if (!preview) return
    setConfirming(true)
    setError("")
    try {
      const records = [
        ...preview.matched.map(m => ({ studentId: m.studentId, fileName: m.fileName })),
        ...preview.uncertain.filter(u => uncertainSelections[u.fileName]).map(u => ({ studentId: u.studentId, fileName: u.fileName })),
      ]
      if (!records.length) { setError("No records to confirm."); setConfirming(false); return }
      const fd = new FormData()
      fd.append("action", "confirm")
      fd.append("batch", batch)
      fd.append("date", date)
      fd.append("records", JSON.stringify(records))
      const res = await fetch("/api/attendance-upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Confirm failed.")
      setResult(data.result)
      setPreview(null)
      if (onUploaded) onUploaded()
    } catch (err) {
      setError(err.message || "Could not confirm upload.")
    } finally {
      setConfirming(false)
    }
  }

  function toggleUncertain(fileName) {
    setUncertainSelections(prev => ({ ...prev, [fileName]: !prev[fileName] }))
  }

  const totalToCreate = preview ? preview.matched.length + preview.uncertain.filter(u => uncertainSelections[u.fileName]).length : 0

  return (
    <div className="grid gap-4">
      <div className="card admin-panel">
        <SectionHeading
          title="Upload attendance report"
          detail="Upload a Microsoft Teams attendance Excel or CSV file. Names are matched to registered students automatically."
        />
        <form className="attendance-upload-form" onSubmit={handlePreview}>
          <div className="attendance-upload-fields">
            <select className="select" value={batch} onChange={e => { setBatch(e.target.value); reset() }} aria-label="Batch" required>
              <option value="">Select batch</option>
              {batches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <input className="input" type="date" value={date} onChange={e => { setDate(e.target.value); reset() }} aria-label="Attendance date" required />
            <input className="input" type="file" accept=".xlsx,.xls,.csv" ref={fileRef} onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); setError("") }} aria-label="Attendance file" required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={uploading || !batch || !date || !file}>
            {uploading ? <Spinner size="sm" /> : "Preview matches"}
          </button>
        </form>
        {error && <p className="upload-error">{error}</p>}
      </div>

      {result && (
        <div className="card admin-panel">
          <SectionHeading title="Upload complete" />
          <div className="attendance-upload-result">
            <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--success)" }}>{result.created}</span><span className="upload-stat-label">Created</span></div>
            <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--text-muted)" }}>{result.skipped}</span><span className="upload-stat-label">Already existed</span></div>
            {result.errors > 0 && <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--danger)" }}>{result.errors}</span><span className="upload-stat-label">Errors</span></div>}
          </div>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={reset}>Upload another</button>
        </div>
      )}

      {preview && (
        <div className="grid gap-4">
          <div className="card admin-panel">
            <SectionHeading title="Match preview" detail={`${preview.totalNamesInFile} names found in file for ${preview.batch} on ${preview.date}`} />
            <div className="attendance-upload-result">
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--success)" }}>{preview.summary.willCreate}</span><span className="upload-stat-label">Auto-matched</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--warning)" }}>{preview.summary.needsReview}</span><span className="upload-stat-label">Needs review</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--text-muted)" }}>{preview.summary.alreadyExists}</span><span className="upload-stat-label">Already marked</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--danger)" }}>{preview.summary.noMatch}</span><span className="upload-stat-label">No match</span></div>
            </div>
          </div>

          {preview.matched.length > 0 && (
            <div className="card admin-panel">
              <SectionHeading title={`Auto-matched (${preview.matched.length})`} detail="These names were confidently matched to registered students." />
              <div className="upload-match-list">
                {preview.matched.map(m => (
                  <div className="upload-match-row" key={m.fileName}>
                    <span className="upload-match-file">{m.fileName}</span>
                    <span className="upload-match-arrow">→</span>
                    <span className="upload-match-student">{m.studentName}</span>
                    <span className="upload-match-badge" style={{ color: confidenceTone(m.confidence) }}>{confidenceLabel(m.confidence)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.uncertain.length > 0 && (
            <div className="card admin-panel">
              <SectionHeading title={`Needs review (${preview.uncertain.length})`} detail="These may be spelling variations. Select to include." />
              <div className="upload-match-list">
                {preview.uncertain.map(u => (
                  <label className="upload-match-row upload-match-selectable" key={u.fileName}>
                    <input type="checkbox" checked={!!uncertainSelections[u.fileName]} onChange={() => toggleUncertain(u.fileName)} />
                    <span className="upload-match-file">{u.fileName}</span>
                    <span className="upload-match-arrow">→</span>
                    <span className="upload-match-student">{u.studentName}</span>
                    <span className="upload-match-badge" style={{ color: confidenceTone(u.confidence) }}>{Math.round(u.similarity * 100)}% match</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {preview.alreadyMarked.length > 0 && (
            <div className="card admin-panel">
              <SectionHeading title={`Already marked (${preview.alreadyMarked.length})`} detail="Attendance already exists for these students on this date." />
              <div className="upload-match-list">
                {preview.alreadyMarked.map(a => (
                  <div className="upload-match-row upload-match-muted" key={a.fileName}>
                    <span className="upload-match-file">{a.fileName}</span>
                    <span className="upload-match-arrow">→</span>
                    <span className="upload-match-student">{a.studentName}</span>
                    <span className="upload-match-badge">{a.existingStatus}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.unmatched.length > 0 && (
            <div className="card admin-panel">
              <SectionHeading title={`Unmatched (${preview.unmatched.length})`} detail="No registered student matched these names." />
              <div className="upload-match-list">
                {preview.unmatched.map(u => (
                  <div className="upload-match-row upload-match-muted" key={u.fileName}>
                    <span className="upload-match-file">{u.fileName}</span>
                    {u.bestMatch && <>
                      <span className="upload-match-arrow">≈</span>
                      <span className="upload-match-student">{u.bestMatch.studentName} ({Math.round(u.bestMatch.similarity * 100)}%)</span>
                    </>}
                    <span className="upload-match-badge" style={{ color: "var(--danger)" }}>No match</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card admin-panel">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm"><b>{totalToCreate}</b> attendance record{totalToCreate === 1 ? "" : "s"} will be created as <b>approved</b>.</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={confirming || totalToCreate === 0}>
                  {confirming ? <Spinner size="sm" /> : `Confirm & upload ${totalToCreate} record${totalToCreate === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!preview && !result && (
        <EmptyState icon="📊" title="Upload a Teams attendance report" message={`Select a batch and date, then upload a Microsoft Teams attendance Excel or CSV file. Names will be matched automatically using fuzzy matching.`} />
      )}
    </div>
  )
}
