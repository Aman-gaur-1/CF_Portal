"use client"

import { useCallback, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import SectionHeading from "@/components/ui/SectionHeading"
import SearchableBatchSelect from "@/components/ui/SearchableBatchSelect"
import EmptyState from "@/components/ui/EmptyState"

function confidenceLabel(confidence) {
  if (confidence === "alias") return "Trusted alias"
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

export default function AttendanceUpload({ token, batches = [], role = "teacher", onUploaded, onNeedsAttention }) {
  const [batch, setBatch] = useState("")
  const [date, setDate] = useState("")
  const [sessionTitle, setSessionTitle] = useState("")
  const [sessionStart, setSessionStart] = useState("")
  const [sessionEnd, setSessionEnd] = useState("")
  const [showSessionDetails, setShowSessionDetails] = useState(false)
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
      fd.append("sessionTitle", sessionTitle)
      fd.append("sessionStart", sessionStart)
      fd.append("sessionEnd", sessionEnd)
      fd.append("file", file)
      const res = await fetch("/api/attendance-upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Upload failed.")
      setPreview(data.preview)
      const initial = {}
      for (const u of (data.preview?.uncertain || [])) {
        initial[u.fileName] = false
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
        ...preview.matched.map(m => ({ studentId: m.studentId, fileName: m.fileName, participantName: m.fileName, matchType: m.type })),
        ...preview.uncertain.filter(u => uncertainSelections[u.fileName]).map(u => ({ studentId: u.studentId, fileName: u.fileName, participantName: u.fileName, matchType: u.type })),
        ...preview.unmatched.filter(u => u.bestMatch && uncertainSelections[u.fileName]).map(u => ({ studentId: u.bestMatch.studentId, fileName: u.fileName, participantName: u.fileName, matchType: u.type })),
      ]

      const skippedNames = [
        ...preview.uncertain.filter(u => !uncertainSelections[u.fileName]).map(u => u.fileName),
        ...preview.unmatched.filter(u => !u.bestMatch || !uncertainSelections[u.fileName]).map(u => u.fileName),
      ]
      if (!records.length && !skippedNames.length) { setError("No records to confirm."); setConfirming(false); return }
      const alreadyMarkedNames = preview.alreadyMarked.map(a => `${a.fileName} → ${a.studentName}`)

      const fd = new FormData()
      fd.append("action", "confirm")
      fd.append("batch", batch)
      fd.append("date", date)
      fd.append("sessionTitle", sessionTitle)
      fd.append("sessionStart", sessionStart)
      fd.append("sessionEnd", sessionEnd)
      fd.append("file", file)
      fd.append("records", JSON.stringify(records))
      if (skippedNames.length) {
        const unmatched = [
          ...preview.uncertain.filter(u => !uncertainSelections[u.fileName]).map(u => ({ participantName: u.fileName, studentId: u.studentId, similarity: u.similarity, type: u.type, reason: u.reason })),
          ...preview.unmatched.filter(u => !u.bestMatch || !uncertainSelections[u.fileName]).map(u => ({ participantName: u.fileName, bestMatch: u.bestMatch, similarity: u.similarity, type: u.type, reason: u.reason })),
        ]
        fd.append("unmatched", JSON.stringify(unmatched))
      }
      const res = await fetch("/api/attendance-upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Confirm failed.")
      setResult({ ...data.result, skippedNames, alreadyMarkedNames, batch: preview.batch, date: preview.date, savedUnlinked: data.result.savedUnlinked || 0 })
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

  function setSelection(fileName, selected) {
    setUncertainSelections(prev => ({ ...prev, [fileName]: selected }))
  }

  const totalToCreate = preview ? preview.matched.length + preview.uncertain.filter(u => uncertainSelections[u.fileName]).length + preview.unmatched.filter(u => u.bestMatch && uncertainSelections[u.fileName]).length : 0
  const hasNeedsMatching = Boolean(preview && (preview.uncertain.length || preview.unmatched.length))
  const needsAttentionCount = result?.savedUnlinked || result?.skippedNames?.length || 0

  return (
    <div className="grid gap-4">
      <div className="card admin-panel">
        <SectionHeading
          title="Upload Attendance"
          detail="Upload a class attendance report and review the matches before confirming."
        />
        <form className="attendance-upload-form" onSubmit={handlePreview}>
          <div className="attendance-upload-fields">
            <label className="attendance-field-label">Batch *
              <SearchableBatchSelect batches={batches} value={batch} onChange={value => { setBatch(value); reset() }} placeholder="Select batch" aria-label="Batch" label="Batch" required />
            </label>
            <label className="attendance-field-label">Attendance Date *
              <input className="input" type="date" value={date} onChange={e => { setDate(e.target.value); reset() }} aria-label="Attendance date" required />
            </label>
            <label className="attendance-field-label">Attendance File *
              <input className="input" type="file" accept=".xlsx,.xls,.csv" ref={fileRef} onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); setError("") }} aria-label="Attendance file" required />
            </label>
          </div>
          <button type="button" className="attendance-details-toggle" onClick={() => setShowSessionDetails(value => !value)} aria-expanded={showSessionDetails}>
            {showSessionDetails ? "− Hide session details" : "+ Add session details"}
          </button>
          {showSessionDetails && <div className="attendance-session-details">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Add session details when this batch had more than one class on this date.</p>
            <div className="attendance-upload-fields">
              <label className="attendance-field-label">Session Title
                <input className="input" value={sessionTitle} onChange={e => setSessionTitle(e.target.value)} placeholder="Optional session title" aria-label="Session title" />
              </label>
              <label className="attendance-field-label">Start Time
                <input className="input" type="time" value={sessionStart} onChange={e => setSessionStart(e.target.value)} aria-label="Session start time" />
              </label>
              <label className="attendance-field-label">End Time
                <input className="input" type="time" value={sessionEnd} onChange={e => setSessionEnd(e.target.value)} aria-label="Session end time" />
              </label>
            </div>
          </div>}
          <p className="attendance-file-help">Microsoft Teams Excel or CSV · Supported: .xlsx, .xls, .csv · Max: 5 MB</p>
          <button type="submit" className="btn btn-primary" disabled={uploading || !batch || !date || !file}>
            {uploading ? <Spinner size="sm" /> : "Review matches"}
          </button>
        </form>
        {error && <p className="upload-error">{error}</p>}
      </div>

      {result && (
        <div className="grid gap-4">
          <div className="card admin-panel">
            <SectionHeading title="Attendance uploaded successfully" detail={`${result.batch} · ${result.date}`} />
            <div className="attendance-upload-result">
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--success)" }}>{result.created}</span><span className="upload-stat-label">Marked present</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--text-muted)" }}>{result.skipped}</span><span className="upload-stat-label">Already existed</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--warning)" }}>{needsAttentionCount}</span><span className="upload-stat-label">Needs attention</span></div>
              {result.errors > 0 && <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--danger)" }}>{result.errors}</span><span className="upload-stat-label">Errors</span></div>}
            </div>
            <div className="flex gap-2 flex-wrap mt-4">
              {needsAttentionCount > 0 && <button type="button" className="btn btn-primary btn-sm" onClick={onNeedsAttention}>Resolve {needsAttentionCount} {needsAttentionCount === 1 ? "Name" : "Names"}</button>}
              <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>Upload Another Report</button>
            </div>
          </div>

          {result.createdNames?.length > 0 && (
            <details className="card admin-panel">
              <summary className="font-semibold cursor-pointer">Marked present ({result.createdNames.length})</summary>
              <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>These students now have approved attendance for this date.</p>
              <div className="upload-match-list">
                {result.createdNames.map(r => (
                  <div className="upload-match-row" key={r.studentId}>
                    <span className="upload-match-file">{r.fileName}</span>
                    <span className="upload-match-arrow">→</span>
                    <span className="upload-match-student">{r.studentName}</span>
                    <span className="upload-match-badge" style={{ color: "var(--success)" }}>Approved</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {result.alreadyMarkedNames?.length > 0 && (
            <details className="card admin-panel">
              <summary className="font-semibold cursor-pointer">Already existed ({result.alreadyMarkedNames.length})</summary>
              <div className="upload-match-list">
                {result.alreadyMarkedNames.map(name => (
                  <div className="upload-match-row upload-match-muted" key={name}>
                    <span className="upload-match-file">{name}</span>
                    <span className="upload-match-badge">Skipped</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {result.skippedNames?.length > 0 && (
            <details className="card admin-panel">
            <summary className="font-semibold cursor-pointer">Needs attention ({result.skippedNames.length})</summary>
            <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>{result.savedUnlinked > 0 ? "Saved safely for later matching." : "These names could not be matched to a registered student."}</p>
              <div className="upload-match-list">
                {result.skippedNames.map(name => (
                  <div className="upload-match-row upload-match-muted" key={name}>
                    <span className="upload-match-file">{name}</span>
                    <span className="upload-match-badge" style={{ color: result.savedUnlinked > 0 ? "var(--warning)" : "var(--danger)" }}>{result.savedUnlinked > 0 ? "Saved" : "Not matched"}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {preview && (
        <div className="grid gap-4">
          <div className="card admin-panel">
              <SectionHeading title="Match preview" detail={`${preview.totalNamesInFile} names found in file for ${preview.batch} on ${preview.date}${preview.session?.title ? ` · ${preview.session.title}` : ""}`} />
            {preview.duplicate && <div className="upload-error mt-3">This attendance report was already imported on {String(preview.duplicate.uploadedAt || "").slice(0, 16).replace("T", " ")} by {preview.duplicate.uploadedBy || "another operator"}.</div>}
            <div className="attendance-upload-result">
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--success)" }}>{preview.summary.willCreate}</span><span className="upload-stat-label">Ready to mark</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--warning)" }}>{preview.summary.needsReview}</span><span className="upload-stat-label">Needs review</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--text-muted)" }}>{preview.summary.alreadyExists}</span><span className="upload-stat-label">Already marked</span></div>
              <div className="upload-stat"><span className="upload-stat-value" style={{ color: "var(--danger)" }}>{preview.summary.noMatch}</span><span className="upload-stat-label">Not matched</span></div>
            </div>
          </div>

          {preview.matched.length > 0 && (
            <div className="card admin-panel">
              <SectionHeading title={`Ready to mark (${preview.matched.length})`} detail="These names were matched safely to registered students." />
              <div className="upload-match-list">
                {preview.matched.map(m => (
                  <div className="upload-match-row" key={m.fileName}>
                    <span className="upload-match-file">{m.fileName}</span>
                    <span className="upload-match-arrow">→</span>
                    <span className="upload-match-student">{m.studentName}</span>
                    <span className="upload-match-badge" title={confidenceLabel(m.confidence)} style={{ color: "var(--success)" }}>Ready</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.uncertain.length > 0 && (
            <div className="card admin-panel">
              <SectionHeading title={`Needs review (${preview.uncertain.length})`} detail="Choose Accept Match or Do Not Match for each suggested student." />
              <div className="upload-match-list">
                {preview.uncertain.map(u => (
                  <div className="upload-match-row" key={u.fileName}>
                    <div className="min-w-0"><span className="upload-match-file">Teams name: {u.fileName}</span><span className="upload-match-student block mt-1">Suggested student: {u.studentName || "No suggestion"}</span></div>
                    <span className="upload-match-badge" style={{ color: confidenceTone(u.confidence) }}>Match confidence: {Math.round(u.similarity * 100)}%</span>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className={`btn btn-sm ${uncertainSelections[u.fileName] ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelection(u.fileName, true)}>Accept Match</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelection(u.fileName, false)}>Do Not Match</button>
                    </div>
                  </div>
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
              <SectionHeading title={`Not matched (${preview.unmatched.length})`} detail="These names will be saved in Needs Attention unless you accept a suggestion." />
              <div className="upload-match-list">
                {preview.unmatched.map(u => u.bestMatch ? (
                  <div className="upload-match-row" key={u.fileName}>
                    <div className="min-w-0"><span className="upload-match-file">Uploaded name: {u.fileName}</span><span className="upload-match-student block mt-1">Suggested student: {u.bestMatch.studentName}</span></div>
                    <span className="upload-match-badge" style={{ color: "var(--warning)" }}>Needs attention</span>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className={`btn btn-sm ${uncertainSelections[u.fileName] ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelection(u.fileName, true)}>Accept Suggested Match</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelection(u.fileName, false)}>Keep Unmatched</button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-match-row upload-match-muted" key={u.fileName}>
                    <span className="upload-match-file">Uploaded name: {u.fileName}</span>
                    <span className="upload-match-badge" style={{ color: "var(--danger)" }}>Needs attention</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card admin-panel">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm"><b>{totalToCreate}</b> will be marked present · <b>{preview.alreadyMarked.length}</b> already exist · <b>{preview.uncertain.filter(u => !uncertainSelections[u.fileName]).length + preview.unmatched.filter(u => !u.bestMatch || !uncertainSelections[u.fileName]).length}</b> will need matching.</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={confirming || (!totalToCreate && !hasNeedsMatching) || Boolean(preview.duplicate)}>
                  {confirming ? <Spinner size="sm" /> : totalToCreate ? `Confirm ${totalToCreate} Attendance Record${totalToCreate === 1 ? "" : "s"}` : "Save Needs Attention"}
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
