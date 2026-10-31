"use client"

import { useState } from "react"
import Spinner from "@/components/ui/Spinner"
import SearchableBatchSelect from "@/components/ui/SearchableBatchSelect"

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

export default function BatchSetupPanel({ adminToken, batches = [], students = [], success, showError }) {
  const [batch, setBatch] = useState(batches[0]?.name || "")
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(false)

  async function downloadTemplate() {
    try {
      const res = await fetch("/api/admin-roster", { headers: { Authorization: `Bearer ${adminToken}` } })
      if (!res.ok) throw new Error("Could not download the roster template.")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "consoleflare-student-roster-template.csv"
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) { showError(error.message) }
  }

  async function submit(action) {
    if (!file || !batch) { showError("Select a batch and roster file first."); return }
    setLoading(true)
    try {
      const formData = new FormData()
      formData.set("batch", batch)
      formData.set("action", action)
      formData.set("file", file)
      const res = await fetch("/api/admin-roster", { method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not process roster.")
      if (action === "preview") {
        setPreview(data)
        setCredentials([])
        success("Roster preview ready. Review new and duplicate rows before importing.")
      } else {
        setPreview(data)
        setCredentials(data.credentials || [])
        success(`${data.summary?.created || 0} student account(s) created. Export the temporary credentials now.`)
      }
    } catch (error) { showError(error.message) } finally { setLoading(false) }
  }

  async function regenerate(studentId) {
    try {
      const res = await fetch("/api/admin-student-credentials", { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ studentId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not regenerate password.")
      setCredentials(current => [...current.filter(row => row.loginId !== data.credential.loginId), data.credential])
      success("Temporary password regenerated. Export it now; it will not be shown again.")
    } catch (error) { showError(error.message) }
  }

  function downloadCredentials() {
    if (!credentials.length) return
    const body = ["Name,Batch,Login ID,Temporary Password", ...credentials.map(row => [row.name, row.batch, row.loginId, row.temporaryPassword].map(csvValue).join(","))].join("\n")
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${batch || "batch"}-student-credentials.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const batchStudentCount = students.filter(student => student.batch === batch).length
  return (
    <div className="grid gap-4">
      <section className="card admin-panel grid gap-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div><h3 className="text-lg font-bold">Batch Setup</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Import a student roster safely and keep batch membership idempotent.</p></div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={downloadTemplate}>Download roster template</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="label">Batch<SearchableBatchSelect batches={batches} value={batch} onChange={setBatch} placeholder="Select batch" label="Roster batch" required /></label>
          <label className="label md:col-span-2">Roster (.xlsx, .xls, .csv)<input className="input mt-1" type="file" accept=".xlsx,.xls,.csv" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Current students in this batch: {batchStudentCount}. Required column: Student Name. Optional: Email, Phone, External Student ID.</p>
        <div className="flex gap-2 flex-wrap"><button type="button" className="btn btn-secondary" onClick={() => submit("preview")} disabled={loading}>{loading ? <Spinner size="sm" /> : "Preview import"}</button><button type="button" className="btn btn-primary" onClick={() => submit("commit")} disabled={loading || !preview}>{loading ? <Spinner size="sm" /> : "Import new students"}</button>{credentials.length > 0 && <button type="button" className="btn btn-secondary" onClick={downloadCredentials}>Download temporary credentials</button>}</div>
        {credentials.length > 0 && <div className="rounded-xl p-3 text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><b>Temporary credentials are shown once.</b> Store/export them now; passwords are hashed and cannot be retrieved later.<div className="grid gap-1 mt-2">{credentials.map(row => <div key={row.loginId}>{row.name} · {row.loginId} · {row.temporaryPassword}</div>)}</div></div>}
      </section>
      {preview && <section className="card admin-panel grid gap-3"><div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Import preview</h3><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{preview.summary?.new || 0} new · {preview.summary?.existing || 0} existing · {preview.summary?.possibleDuplicates || 0} possible duplicates · {preview.summary?.invalid || 0} invalid</p></div></div><div className="grid gap-2">{(preview.rows || preview.createdRows || []).map(row => <div className="admin-row" key={`${row.rowNumber}-${row.name}`}><span>{row.rowNumber ? `Row ${row.rowNumber}: ` : ""}{row.name}</span><span className="flex items-center gap-2"><span className={row.status === "new" || row.status === "created" ? "badge-done" : row.status === "invalid" ? "badge-failed" : "badge-pending"}>{row.status}</span>{row.studentId && <button type="button" className="btn btn-secondary btn-sm" onClick={() => regenerate(row.studentId)}>Reset password</button>}</span></div>)}</div></section>}
    </div>
  )
}
