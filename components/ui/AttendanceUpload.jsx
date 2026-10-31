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
  return "No safe match"
}

function confidenceTone(confidence) {
  if (confidence === "exact" || confidence === "high" || confidence === "alias") return "var(--portal-success)"
  if (confidence === "low") return "var(--portal-warning)"
  return "var(--portal-danger)"
}

function friendlyError(message) {
  const value = String(message || "")
  if (/already imported/i.test(value)) return "This attendance report has already been uploaded."
  if (/could not process attendance upload|no names found|participant list/i.test(value)) return "We couldn't read this Teams report. Please upload the original attendance CSV, XLS, or XLSX file."
  return value || "We couldn't upload this attendance report. Please try again."
}

function detectedTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!match) return ""
  let hour = Number(match[1])
  const minute = match[2]
  const meridiem = match[3]?.toUpperCase()
  if (meridiem === "PM" && hour < 12) hour += 12
  if (meridiem === "AM" && hour === 12) hour = 0
  if (hour > 23) return ""
  return `${String(hour).padStart(2, "0")}:${minute}`
}

export default function AttendanceUpload({ token, batches = [], role = "teacher", initialBatch = "", initialDate = "", onUploaded, onNeedsAttention, onDone }) {
  const [batch, setBatch] = useState(initialBatch)
  const [date, setDate] = useState(initialDate)
  const [sessionTitle, setSessionTitle] = useState("")
  const [sessionStart, setSessionStart] = useState("")
  const [sessionEnd, setSessionEnd] = useState("")
  const [showSessionDetails, setShowSessionDetails] = useState(false)
  const [file, setFile] = useState(null)
  const [fileMeta, setFileMeta] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
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
    setFileMeta(null)
    setError("")
    setFile(null)
    setUncertainSelections({})
    setSessionTitle("")
    setSessionStart("")
    setSessionEnd("")
    setShowSessionDetails(false)
    if (fileRef.current) fileRef.current.value = ""
  }, [])

  function chooseFile(nextFile) {
    setFile(nextFile || null)
    setPreview(null)
    setResult(null)
    setFileMeta(null)
    setError("")
  }

  async function handlePreview(event) {
    event.preventDefault()
    if (!batch || !date || !file) { setError("Select a batch, date, and file."); return }
    setUploading(true)
    setError("")
    setPreview(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append("action", "preview")
      form.append("batch", batch)
      form.append("date", date)
      form.append("sessionTitle", sessionTitle)
      form.append("sessionStart", sessionStart)
      form.append("sessionEnd", sessionEnd)
      form.append("file", file)
      const response = await fetch("/api/attendance-upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "We couldn't preview this report.")
      const meta = data.fileMeta || null
      setFileMeta(meta)
      if (meta?.meetingTitle && !sessionTitle) setSessionTitle(meta.meetingTitle)
      const suggestedStart = detectedTime(meta?.startTime)
      const suggestedEnd = detectedTime(meta?.endTime)
      if (suggestedStart && !sessionStart) setSessionStart(suggestedStart)
      if (suggestedEnd && !sessionEnd) setSessionEnd(suggestedEnd)
      if (meta?.meetingTitle || suggestedStart || suggestedEnd) setShowSessionDetails(true)
      setPreview(data.preview)
      const initial = {}
      for (const item of [...(data.preview?.uncertain || []), ...(data.preview?.unmatched || [])]) initial[item.fileName] = false
      setUncertainSelections(initial)
    } catch (uploadError) {
      setError(friendlyError(uploadError.message))
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
        ...preview.matched.map(item => ({ studentId: item.studentId, fileName: item.fileName, participantName: item.fileName, matchType: item.type })),
        ...preview.uncertain.filter(item => uncertainSelections[item.fileName]).map(item => ({ studentId: item.studentId, fileName: item.fileName, participantName: item.fileName, matchType: item.type })),
        ...preview.unmatched.filter(item => item.bestMatch && uncertainSelections[item.fileName]).map(item => ({ studentId: item.bestMatch.studentId, fileName: item.fileName, participantName: item.fileName, matchType: item.type })),
      ]
      const skippedNames = [
        ...preview.uncertain.filter(item => !uncertainSelections[item.fileName]).map(item => item.fileName),
        ...preview.unmatched.filter(item => !item.bestMatch || !uncertainSelections[item.fileName]).map(item => item.fileName),
      ]
      if (!records.length && !skippedNames.length) { setError("There are no safe attendance records to confirm."); setConfirming(false); return }

      const form = new FormData()
      form.append("action", "confirm")
      form.append("batch", batch)
      form.append("date", date)
      form.append("sessionTitle", sessionTitle)
      form.append("sessionStart", sessionStart)
      form.append("sessionEnd", sessionEnd)
      form.append("file", file)
      form.append("records", JSON.stringify(records))
      if (skippedNames.length) {
        form.append("unmatched", JSON.stringify([
          ...preview.uncertain.filter(item => !uncertainSelections[item.fileName]).map(item => ({ participantName: item.fileName, studentId: item.studentId, similarity: item.similarity, type: item.type, reason: item.reason })),
          ...preview.unmatched.filter(item => !item.bestMatch || !uncertainSelections[item.fileName]).map(item => ({ participantName: item.fileName, bestMatch: item.bestMatch, similarity: item.similarity, type: item.type, reason: item.reason })),
        ]))
      }
      const response = await fetch("/api/attendance-upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "We couldn't confirm this report.")
      const nextResult = { ...data.result, skippedNames, alreadyMarkedNames: preview.alreadyMarked.map(item => `${item.fileName} → ${item.studentName}`), batch: preview.batch, date: preview.date }
      setResult(nextResult)
      setPreview(null)
      onUploaded?.(nextResult)
    } catch (confirmError) {
      setError(friendlyError(confirmError.message))
    } finally {
      setConfirming(false)
    }
  }

  function setSelection(fileName, selected) {
    setUncertainSelections(previous => ({ ...previous, [fileName]: selected }))
  }

  const acceptedUncertain = preview ? preview.uncertain.filter(item => uncertainSelections[item.fileName]).length : 0
  const acceptedUnmatched = preview ? preview.unmatched.filter(item => item.bestMatch && uncertainSelections[item.fileName]).length : 0
  const totalToCreate = preview ? preview.matched.length + acceptedUncertain + acceptedUnmatched : 0
  const checkCount = preview ? preview.uncertain.filter(item => !uncertainSelections[item.fileName]).length + preview.unmatched.filter(item => !item.bestMatch || !uncertainSelections[item.fileName]).length : 0
  const needsAttentionCount = result ? (result.savedUnlinked || result.skippedNames?.length || 0) : 0

  return (
    <div className="attendance-upload-flow">
      <form className="attendance-upload-form" onSubmit={handlePreview}>
        <div className="attendance-upload-fields">
          <label className="attendance-field-label">Batch *<SearchableBatchSelect batches={batches} value={batch} onChange={value => { setBatch(value); setPreview(null); setResult(null) }} placeholder="Select batch" label="Batch" required /></label>
          <label className="attendance-field-label">Attendance Date *<input className="input" type="date" value={date} onChange={event => { setDate(event.target.value); setPreview(null); setResult(null) }} aria-label="Attendance date" required /></label>
        </div>

        <div className={`attendance-dropzone ${isDragging ? "is-dragging" : ""}`} onDragEnter={event => { event.preventDefault(); setIsDragging(true) }} onDragOver={event => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={event => { event.preventDefault(); setIsDragging(false); chooseFile(event.dataTransfer.files?.[0]) }}>
          <input id="attendance-file" ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={event => chooseFile(event.target.files?.[0])} aria-label="Attendance file" />
          <label htmlFor="attendance-file" className="attendance-dropzone-label"><span className="attendance-dropzone-icon" aria-hidden="true">↥</span><span className="attendance-dropzone-title">{file ? file.name : "Drop Microsoft Teams attendance file here"}</span><span className="attendance-dropzone-subtitle">or <u>Browse file</u> · CSV / XLS / XLSX · Max 5 MB</span></label>
        </div>

        <button type="button" className="attendance-details-toggle" onClick={() => setShowSessionDetails(value => !value)} aria-expanded={showSessionDetails}>{showSessionDetails ? "− Hide session details" : "+ Session details"}</button>
        {showSessionDetails && <div className="attendance-session-details"><p className="text-sm" style={{ color: "var(--portal-text-secondary)" }}>Review the suggested class details before confirming. They are not trusted automatically.</p><div className="attendance-upload-fields"><label className="attendance-field-label">Session title<input className="input" value={sessionTitle} onChange={event => setSessionTitle(event.target.value)} placeholder="Optional session title" /></label><label className="attendance-field-label">Start time<input className="input" type="time" value={sessionStart} onChange={event => setSessionStart(event.target.value)} /></label><label className="attendance-field-label">End time<input className="input" type="time" value={sessionEnd} onChange={event => setSessionEnd(event.target.value)} /></label></div>{fileMeta?.participantSection && <p className="text-xs" style={{ color: "var(--portal-success)" }}>Participant section detected safely from this Teams report.</p>}</div>}
        <button type="submit" className="btn btn-primary attendance-upload-submit" disabled={uploading || !batch || !date || !file}>{uploading ? <Spinner size="sm" /> : "Review Attendance"}</button>
        {error && <p className="upload-error">{error}</p>}
      </form>

      {preview && <div className="attendance-upload-preview">
        <div className="card admin-panel"><SectionHeading title="Attendance preview" detail={`${preview.totalNamesInFile} participants found · ${preview.batch} · ${preview.date}${preview.session?.title ? ` · ${preview.session.title}` : ""}`} />{preview.duplicate && <div className="upload-error">This attendance report has already been uploaded. Choose a different file or class.</div>}<div className="attendance-preview-summary"><div className="attendance-preview-stat is-ready"><strong>{totalToCreate}</strong><span>READY</span></div><div className="attendance-preview-stat is-check"><strong>{checkCount}</strong><span>CHECK</span></div><div className="attendance-preview-stat is-muted"><strong>{preview.alreadyMarked.length}</strong><span>ALREADY PRESENT</span></div></div></div>

        {checkCount > 0 && <div className="card admin-panel attendance-exceptions"><SectionHeading title={`Check these ${checkCount} name${checkCount === 1 ? "" : "s"}`} detail="Only uncertain or unmatched names need your attention." />{preview.uncertain.map(item => <div className="attendance-exception-row" key={`uncertain-${item.fileName}`}><div className="min-w-0"><p className="font-semibold">Uploaded: {item.fileName}</p><p className="text-sm mt-1" style={{ color: "var(--portal-text-secondary)" }}>Suggested: {item.studentName || "No safe match"}</p></div><span className="attendance-confidence" style={{ color: confidenceTone(item.confidence) }}>{confidenceLabel(item.confidence)}</span><div className="flex gap-2 flex-wrap"><button type="button" className={`btn btn-xs ${uncertainSelections[item.fileName] ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelection(item.fileName, true)}>Accept</button><button type="button" className="btn btn-secondary btn-xs" onClick={() => setSelection(item.fileName, false)}>Leave for later</button></div></div>)}{preview.unmatched.map(item => <div className="attendance-exception-row" key={`unmatched-${item.fileName}`}><div className="min-w-0"><p className="font-semibold">Uploaded: {item.fileName}</p><p className="text-sm mt-1" style={{ color: "var(--portal-text-secondary)" }}>{item.bestMatch ? `Suggested: ${item.bestMatch.studentName}` : "No safe match"}</p></div><span className="attendance-confidence" style={{ color: "var(--portal-warning)" }}>Needs attention</span><div className="flex gap-2 flex-wrap">{item.bestMatch && <button type="button" className={`btn btn-xs ${uncertainSelections[item.fileName] ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelection(item.fileName, true)}>Accept</button>}<button type="button" className="btn btn-secondary btn-xs" onClick={() => setSelection(item.fileName, false)}>Leave for later</button></div></div>)}</div>}

        {preview.matched.length > 0 && <details className="card admin-panel attendance-collapsed-list"><summary><span>✓ {preview.matched.length} participants ready to mark</span><span>View</span></summary><div className="upload-match-list">{preview.matched.map(item => <div className="upload-match-row" key={item.fileName}><span className="upload-match-file">{item.fileName}</span><span className="upload-match-arrow">→</span><span className="upload-match-student">{item.studentName}</span><span className="upload-match-badge" style={{ color: "var(--portal-success)" }}>Ready</span></div>)}</div></details>}
        {preview.alreadyMarked.length > 0 && <details className="card admin-panel attendance-collapsed-list"><summary><span>{preview.alreadyMarked.length} already have attendance</span><span>View</span></summary><div className="upload-match-list">{preview.alreadyMarked.map(item => <div className="upload-match-row upload-match-muted" key={item.fileName}><span className="upload-match-file">{item.fileName} → {item.studentName}</span><span className="upload-match-badge">Already present</span></div>)}</div></details>}

        <div className="card admin-panel attendance-confirm-bar"><div><p className="font-semibold">{totalToCreate} student{totalToCreate === 1 ? "" : "s"} will be marked Present</p><p className="text-sm mt-1" style={{ color: "var(--portal-text-secondary)" }}>{preview.alreadyMarked.length} already has attendance · {checkCount} require attention</p></div><div className="flex gap-2 flex-wrap"><button type="button" className="btn btn-secondary" onClick={reset}>Cancel</button><button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={confirming || (!totalToCreate && !checkCount) || Boolean(preview.duplicate)}>{confirming ? <Spinner size="sm" /> : totalToCreate ? `Confirm ${totalToCreate} Attendance` : "Save for later"}</button></div></div>
      </div>}

      {result && <div className="card admin-panel attendance-upload-success"><div><p className="portal-eyebrow">✓ Attendance uploaded</p><h2 className="section-heading-title">{result.created} marked Present</h2><p className="text-sm mt-1" style={{ color: "var(--portal-text-secondary)" }}>{result.skipped} already existed · {needsAttentionCount} need attention</p></div><div className="flex gap-2 flex-wrap"><button type="button" className="btn btn-secondary" onClick={() => { reset(); onDone?.(result) }}>Done</button>{needsAttentionCount > 0 && <button type="button" className="btn btn-primary" onClick={() => { reset(); onDone?.(result); onNeedsAttention?.(result) }}>Resolve {needsAttentionCount} {needsAttentionCount === 1 ? "Name" : "Names"}</button>}</div></div>}

      {!preview && !result && <EmptyState icon="↥" title="Upload a Teams attendance report" message="Select a batch and date, then upload the original attendance file. Safe matches will be ready to mark; uncertain names will stay in Action Required." />}
    </div>
  )
}
