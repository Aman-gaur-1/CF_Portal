"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import SearchableBatchSelect from "@/components/ui/SearchableBatchSelect"

const STEPS = ["Select Batch", "Upload Student Sheet", "Review Students", "Create Accounts", "Download Credentials"]
const OVERVIEW_TIMEOUT_MS = 12000
const OVERVIEW_RETRY_DELAY_MS = 500

function overviewFailure(kind, message = "Could not load the batch roster.") {
  const error = new Error(message)
  error.overviewKind = kind
  return error
}

function isRetryableNetworkError(error) {
  return error?.name === "TypeError" || /fetch|network|connection|load failed/i.test(String(error?.message || ""))
}

function canRetryOverview() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false
  return true
}

function overviewMessage(error) {
  if (error?.overviewKind === "offline") return "You appear to be offline. Reconnect and try again."
  if (error?.overviewKind === "timeout") return "Loading the batch roster took too long. Please try again."
  if (error?.overviewKind === "auth") return "Your Admin session has expired. Please log in again."
  if (error?.overviewKind === "server") return "Could not load the batch roster. Please try again."
  if (error?.overviewKind === "network") return "We couldn't load the batch students. Check your connection and try again."
  return "Could not load the batch roster. Please try again."
}

function credentialText(row) {
  return `ConsoleFlare Student Portal\n\nName: ${row.name}\nLogin ID: ${row.loginId}\nPassword: ${row.password}\n\nKeep this password secure.`
}

function safeFilename(value) {
  return String(value || "Batch").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Batch"
}

function formatDate(value) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value))
}

function rowStatus(row) {
  if (row.status === "new") return { label: "New", tone: "badge-done" }
  if (row.status === "existing") {
    if (row.passwordReady && row.loginIdReady) return { label: "Credentials ready", tone: "badge-done" }
    if (row.passwordReady) return { label: "Login ID review", tone: "badge-pending" }
    if (row.phoneStatus === "invalid") return { label: "Invalid phone", tone: "badge-failed" }
    return { label: "Phone required", tone: "badge-pending" }
  }
  if (row.status === "existing_different_batch") return { label: "Different batch", tone: "badge-pending" }
  if (row.status === "invalid") return { label: "Invalid", tone: "badge-failed" }
  return { label: "Review needed", tone: "badge-pending" }
}

export default function BatchSetupPanel({ adminToken, batches = [], success, showError, onOpenStudents }) {
  const [batch, setBatch] = useState(batches[0]?.name || "")
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [credentials, setCredentials] = useState([])
  const [overview, setOverview] = useState({ students: [], imports: [] })
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState("")
  const [dragging, setDragging] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null)
  const [transferBatch, setTransferBatch] = useState("")
  const mountedRef = useRef(true)
  const overviewRequestRef = useRef({ sequence: 0, controller: null })

  const batchNames = useMemo(() => batches.map(item => typeof item === "string" ? item : item.name).filter(Boolean), [batches])

  const cancelOverview = useCallback(() => {
    overviewRequestRef.current.sequence += 1
    overviewRequestRef.current.controller?.abort()
    overviewRequestRef.current.controller = null
  }, [])

  useEffect(() => () => {
    mountedRef.current = false
    cancelOverview()
  }, [cancelOverview])

  const loadOverview = useCallback(async selectedBatch => {
    const sequence = overviewRequestRef.current.sequence + 1
    overviewRequestRef.current.controller?.abort()
    const controller = new AbortController()
    overviewRequestRef.current = { sequence, controller }
    const isCurrent = () => mountedRef.current && overviewRequestRef.current.sequence === sequence && !controller.signal.aborted

    if (!selectedBatch) {
      setOverview({ students: [], imports: [] })
      setOverviewError("")
      setOverviewLoading(false)
      return
    }

    setOverviewLoading(true)
    setOverviewError("")

    const fetchOverview = async attempt => {
      if (!isCurrent()) return null
      let timedOut = false
      const timeoutId = window.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, OVERVIEW_TIMEOUT_MS)
      try {
        const res = await fetch(`/api/admin-roster?mode=overview&batch=${encodeURIComponent(selectedBatch)}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const kind = res.status === 401 ? "auth" : res.status >= 500 ? "server" : "http"
          throw overviewFailure(kind, data.error || "Could not load the batch roster.")
        }
        return data
      } catch (error) {
        if (controller.signal.aborted) {
          if (timedOut) throw overviewFailure("timeout")
          return null
        }
        if (error?.overviewKind) throw error
        if (attempt === 0 && isRetryableNetworkError(error)) {
          if (!canRetryOverview()) {
            throw overviewFailure(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "network")
          }
          await new Promise(resolve => window.setTimeout(resolve, OVERVIEW_RETRY_DELAY_MS))
          if (!isCurrent()) return null
          if (!canRetryOverview()) {
            throw overviewFailure(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "network")
          }
          return fetchOverview(1)
        }
        throw overviewFailure("network")
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    try {
      const data = await fetchOverview(0)
      if (!data || !isCurrent()) return
      setOverview({ students: data.students || [], imports: data.imports || [] })
      setOverviewError("")
    } catch (error) {
      if (!isCurrent()) return
      const message = overviewMessage(error)
      setOverviewError(message)
      showError(message)
    } finally {
      if (isCurrent()) setOverviewLoading(false)
      if (overviewRequestRef.current.sequence === sequence) overviewRequestRef.current.controller = null
    }
  }, [adminToken, showError])

  useEffect(() => { loadOverview(batch) }, [batch, loadOverview])

  function selectBatch(value) {
    cancelOverview()
    setBatch(value)
    setFile(null)
    setPreview(null)
    setCredentials([])
    setOverview({ students: [], imports: [] })
    setOverviewError("")
    setOverviewLoading(false)
  }

  function chooseFile(nextFile) {
    if (!nextFile) return
    if (nextFile.size > 5 * 1024 * 1024) { showError("Roster file exceeds the 5 MB limit."); return }
    if (!/\.(xlsx|xls|csv)$/i.test(nextFile.name)) { showError("Upload an XLSX, XLS, or CSV roster file."); return }
    setFile(nextFile)
    setPreview(null)
    setCredentials([])
  }

  async function downloadTemplate(format = "xlsx") {
    try {
      const res = await fetch(`/api/admin-roster?format=${format}`, { headers: { Authorization: `Bearer ${adminToken}` } })
      if (!res.ok) throw new Error("Could not download the roster template.")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `consoleflare-student-roster-template.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) { showError(error.message) }
  }

  async function submit(action) {
    if (!file || !batch) { showError("Select a batch and roster file first."); return }
    if (action === "apply-pattern" && patternReadyCount > 0) {
      const skippedCount = Math.max((preview?.summary?.existing || 0) - patternReadyCount, 0)
      const skippedMessage = skippedCount ? ` ${skippedCount} student${skippedCount === 1 ? " is" : "s are"} missing a valid phone number or Login ID and will not be changed.` : ""
      if (!window.confirm(`${patternReadyCount} existing student${patternReadyCount === 1 ? "" : "s"} will receive new Login IDs and passwords using the ConsoleFlare credential pattern.${skippedMessage} Old Login IDs and passwords for these students will stop working. Student IDs, attendance, submissions, Health Card, memberships, and batch assignments will remain unchanged.`)) return
    }
    setLoading(true)
    try {
      const formData = new FormData()
      formData.set("batch", batch)
      formData.set("action", action)
      formData.set("file", file)
      const res = await fetch("/api/admin-roster", { method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not process the roster.")
      setPreview(data)
      if (action === "preview") {
        setCredentials([])
        success("Roster preview ready. No student accounts were created.")
      } else {
        setCredentials(data.credentials || [])
        await loadOverview(batch)
        success(`${data.summary?.created || 0} account(s) created and ${data.summary?.patternApplied || 0} existing credential${data.summary?.patternApplied === 1 ? "" : "s"} applied. Download the credentials now.`)
      }
    } catch (error) { showError(error.message) } finally { setLoading(false) }
  }

  async function resetPassword(student) {
    try {
      const res = await fetch("/api/admin-student-credentials", { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ studentId: student.id }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not reset the password.")
      setCredentials(current => [...current.filter(row => row.loginId !== data.credential.loginId), data.credential])
      success("The ConsoleFlare password pattern was applied once. Download or copy it now.")
    } catch (error) { showError(error.message) }
  }

  function askTransfer(student, target = "") {
    setTransferTarget(student)
    setTransferBatch(target || student.batch || "")
  }

  async function confirmTransfer() {
    if (!transferTarget?.id || !transferBatch || transferBatch === transferTarget.batch) return
    setLoading(true)
    try {
      const res = await fetch("/api/admin-roster", { method: "PATCH", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ studentId: transferTarget.id, batch: transferBatch }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not transfer the student.")
      setTransferTarget(null)
      success(`${data.student.name} was transferred to ${data.student.batch}.`)
      await loadOverview(batch)
      if (file) await submit("preview")
    } catch (error) { showError(error.message) } finally { setLoading(false) }
  }

  async function copyCredential(row) {
    try { await navigator.clipboard.writeText(credentialText(row)); success(`Login details copied for ${row.name}.`) }
    catch { showError("Could not copy the login details.") }
  }

  async function copyAllCredentials() {
    try { await navigator.clipboard.writeText(credentials.map(credentialText).join("\n\n---\n\n")); success("All credentials copied.") }
    catch { showError("Could not copy the credentials.") }
  }

  async function downloadCredentials() {
    if (!credentials.length) return
    try {
      const XLSX = await import("xlsx")
      const rows = credentials.map(row => ({
        "Student Name": row.name,
        "Login ID": row.loginId,
        Password: row.password,
        Batch: row.batch,
        "External Student ID": row.externalStudentId || "",
      }))
      const sheet = XLSX.utils.json_to_sheet(rows)
      sheet["!cols"] = [{ wch: 28 }, { wch: 26 }, { wch: 28 }, { wch: 36 }, { wch: 24 }]
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, "Student Credentials")
      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(workbook, `ConsoleFlare_${safeFilename(batch)}_Student_Credentials_${date}.xlsx`)
    } catch { showError("Could not create the credential sheet.") }
  }

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()
    return [...overview.students]
      .filter(student => !query || student.name.toLowerCase().includes(query) || String(student.login_id || "").toLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [overview.students, search])

  const activeStep = credentials.length ? 5 : preview ? 3 : file ? 2 : batch ? 1 : 0
  const newCount = preview?.summary?.new || 0
  const aliasUpdateCount = (preview?.rows || []).filter(row => row.status === "existing" && row.teamsDisplayName).length
  const patternReadyCount = (preview?.rows || []).filter(row => row.status === "existing" && row.passwordReady && row.loginIdReady).length
  const passwordReadyCount = preview?.summary?.passwordReady || 0
  const loginIdReadyCount = preview?.summary?.loginIdReady || 0
  const phoneMissingCount = preview?.summary?.phoneMissing || 0
  const invalidPhoneCount = preview?.summary?.invalidPhone || 0
  const actionableCount = newCount + aliasUpdateCount

  return (
    <div className="grid gap-5">
      <section className="card admin-panel grid gap-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--primary)" }}>STUDENTS</p>
            <h2 className="text-2xl font-black mt-1">Bulk Onboard Students</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Create secure student accounts first, then use the registered roster for attendance matching.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadTemplate("csv")}>CSV Template</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadTemplate("xlsx")}>Download Template</button>
          </div>
        </div>

        <ol className="grid grid-cols-2 md:grid-cols-5 gap-2" aria-label="Student onboarding steps">
          {STEPS.map((step, index) => <li key={step} className="rounded-xl p-3 text-xs font-semibold" style={{ border: "1px solid var(--border)", background: index < activeStep ? "rgba(34,197,94,0.08)" : index === activeStep ? "rgba(59,130,246,0.08)" : "var(--surface)" }}><span aria-hidden>{index < activeStep ? "✓" : index + 1}</span> {step}</li>)}
        </ol>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="label">1. Select Batch *
            <SearchableBatchSelect batches={batchNames} value={batch} onChange={selectBatch} placeholder="Search batch..." label="Roster batch" required />
          </label>
          <div>
            <span className="label">2. Upload Student Sheet *</span>
            <label
              className="mt-1 min-h-[118px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 p-4 cursor-pointer text-center"
              style={{ borderColor: dragging ? "var(--primary)" : "var(--border)", background: "var(--surface)" }}
              onDragEnter={event => { event.preventDefault(); setDragging(true) }}
              onDragOver={event => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]) }}
            >
              <input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={event => chooseFile(event.target.files?.[0])} />
              <b>{file ? file.name : "Drop Excel/CSV roster here"}</b>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{file ? "Choose another file" : "or browse file · XLSX, XLS, CSV · max 5 MB"}</span>
            </label>
          </div>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Required: Student Name and Phone. Optional: Email, External Student ID, Teams Display Name. The selected batch is authoritative. Login IDs use first name + final 2 phone digits. Passwords follow FirstName@last3#.</p>
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn btn-primary" onClick={() => submit("preview")} disabled={loading || !file || !batch}>{loading ? <Spinner size="sm" /> : "Preview Students"}</button>
          {preview && newCount > 0 && <button type="button" className="btn btn-primary" onClick={() => submit("commit-new")} disabled={loading || newCount === 0}>{loading ? <Spinner size="sm" /> : `Create ${newCount} Student Account${newCount === 1 ? "" : "s"}`}</button>}
          {preview && actionableCount > 0 && newCount === 0 && patternReadyCount === 0 && <button type="button" className="btn btn-primary" onClick={() => submit("commit-new")} disabled={loading}>{loading ? <Spinner size="sm" /> : "Apply Attendance Aliases"}</button>}
          {preview && (patternReadyCount > 0 || (aliasUpdateCount > 0 && newCount === 0)) && <button type="button" className="btn btn-secondary" onClick={() => submit("apply-pattern")} disabled={loading}>{loading ? <Spinner size="sm" /> : patternReadyCount > 0 ? `Update ${patternReadyCount} Student${patternReadyCount === 1 ? "" : "s"} & Apply Login Credentials` : "Apply Attendance Aliases"}</button>}
        </div>
      </section>

      {preview && <section className="card admin-panel grid gap-4">
        <div><h3 className="text-lg font-bold">3. Review Students</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Previewing creates nothing. New rows need a phone number. Existing rows are changed only after you explicitly apply the Login ID and password pattern.</p></div>
        {preview.phoneColumnDetected === false && <div className="rounded-xl p-4 grid gap-2" style={{ border: "1px solid var(--warning)", background: "rgba(245,158,11,0.08)" }} role="alert"><p className="font-semibold">⚠ Phone column not detected</p><p className="text-sm" style={{ color: "var(--text-secondary)" }}>Rename the column to Phone, Mobile Number, or Contact Number and preview again.</p><div className="flex gap-2 flex-wrap"><span className="text-xs" style={{ color: "var(--text-muted)" }}>Accepted examples: Phone · Mobile Number · Contact Number</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadTemplate("xlsx")}>Download Template</button></div></div>}
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
          {[["NEW STUDENTS", preview.summary?.new, "badge-done"], ["EXISTING STUDENTS", preview.summary?.existing, "badge-done"], ["LOGIN IDs READY", loginIdReadyCount, "badge-done"], ["PASSWORDS READY", passwordReadyCount, "badge-done"], ["PHONE MISSING", phoneMissingCount, "badge-pending"], ["REVIEW NEEDED", preview.summary?.reviewNeeded, "badge-pending"], ["INVALID", (preview.summary?.invalid || 0) + invalidPhoneCount, "badge-failed"]].map(([label, value, tone]) => <div className="stat-card" key={label}><div className="stat-label">{label}</div><div className="stat-num">{value || 0}</div><span className={tone}>{label.toLowerCase()}</span></div>)}
        </div>
        {(preview.summary?.registeredCount || 0) > 0 && <div className="rounded-xl p-4 grid gap-2" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}><p className="font-semibold">Roster coverage</p><div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm"><span>Uploaded Students: <b>{preview.summary?.uploadedCount || 0}</b></span><span>Registered in Batch: <b>{preview.summary?.registeredCount || 0}</b></span><span>Matched Existing: <b>{preview.summary?.matchedExistingCount || 0}</b></span><span>Not Included in Upload: <b>{preview.summary?.notIncludedCount || 0}</b></span></div>{preview.summary?.notIncludedCount > 0 && <p className="text-xs" style={{ color: "var(--warning)" }}>Only uploaded and safely matched students can be changed. Students absent from this file will not be reset.</p>}</div>}
        <div className="grid gap-2">
          {(preview.rows || []).map(row => {
            const status = rowStatus(row)
            return <div className="admin-row items-start" key={`${row.rowNumber}-${row.name}`}>
              <div className="min-w-0"><p className="font-semibold">{row.name || `Row ${row.rowNumber}`}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{[row.email, row.phoneUpdate ? `New: ${row.phone || "Not available"}` : row.phone && `Phone: ${row.phone}`, row.phoneUpdate && `Current: ${row.currentPhone || "Not available"}`, row.status === "existing" && row.currentLoginId && `Current Login ID: ${row.currentLoginId}`, row.status === "existing" && row.newLoginId && `New Login ID: ${row.newLoginId}`, row.teamsDisplayName && `Teams: ${row.teamsDisplayName}`].filter(Boolean).join(" · ") || "No optional identity details"}</p><p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{row.reason || (row.passwordCollisionCount > 1 ? "Password pattern collision warning: review the generated credentials before distribution." : "Ready to create")}</p>{row.passwordCollisionCount > 1 && <p className="text-xs mt-1" style={{ color: "var(--warning)" }}>{row.passwordCollisionCount} students generate the same password pattern. This is allowed, but distribute credentials carefully.</p>}</div>
              <div className="flex gap-2 flex-wrap justify-end"><span className={status.tone}>{status.label}</span>{row.status === "existing_different_batch" && row.matchedStudent && <button type="button" className="btn btn-secondary btn-sm" onClick={() => askTransfer({ id: row.matchedStudent.id, name: row.matchedStudent.name, batch: row.matchedStudent.batch }, batch)}>Assign / Transfer Existing Student</button>}</div>
            </div>
          })}
        </div>
      </section>}

      {credentials.length > 0 && <section className="card admin-panel grid gap-4" aria-labelledby="credential-result-title">
        <div className="flex items-start justify-between gap-3 flex-wrap"><div><h3 id="credential-result-title" className="text-lg font-bold">✓ {credentials.length} Student Credential{credentials.length === 1 ? "" : "s"} Ready</h3><p className="text-sm mt-1" style={{ color: "var(--warning)" }}>Passwords are shown once. Download the credential sheet before leaving this page. Lost passwords must be reset.</p></div><div className="flex gap-2 flex-wrap"><button type="button" className="btn btn-secondary" onClick={copyAllCredentials}>Copy All Credentials</button><button type="button" className="btn btn-primary" onClick={downloadCredentials}>Download Student Credentials</button></div></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left p-2">Student</th><th className="text-left p-2">Login ID</th><th className="text-left p-2">Password</th><th className="text-left p-2">Batch</th><th className="p-2">Action</th></tr></thead><tbody>{credentials.map(row => <tr key={row.loginId} style={{ borderTop: "1px solid var(--border)" }}><td className="p-2 font-semibold">{row.name}</td><td className="p-2 font-mono">{row.loginId}</td><td className="p-2 font-mono">{row.password}</td><td className="p-2">{row.batch}</td><td className="p-2 text-right"><button type="button" className="btn btn-secondary btn-sm" onClick={() => copyCredential(row)}>Copy Login Details</button></td></tr>)}</tbody></table></div>
      </section>}

      <section className="card admin-panel grid gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap"><div><h3 className="text-lg font-bold">Batch Students</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Registered students are the authoritative attendance roster.</p></div><div className="flex items-center gap-2 flex-wrap"><button type="button" className="btn btn-secondary btn-sm" onClick={() => loadOverview(batch)} disabled={!batch || overviewLoading}>{overviewLoading ? <Spinner size="sm" /> : "Refresh"}</button><input className="input max-w-xs" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search student or Login ID" aria-label="Search batch students" /></div></div>
        {overviewError && <div className="rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap" style={{ border: "1px solid var(--danger)", background: "rgba(239,68,68,0.06)" }} role="alert"><div><p className="text-sm font-semibold">Couldn’t load batch students.</p><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{overviewError}{overview.students.length > 0 ? " Showing the last loaded roster." : ""}</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => loadOverview(batch)} disabled={!batch || overviewLoading}>Retry</button></div>}
        {overviewLoading && overview.students.length === 0 ? <div className="flex justify-center py-8" aria-label="Loading batch students"><Spinner /></div> : filteredStudents.length === 0 ? overviewError ? null : <p className="text-sm py-5" style={{ color: "var(--text-muted)" }}>No students are registered in this batch yet.</p> : <div className="grid gap-2">{filteredStudents.map(student => <div className="admin-row" key={student.id}><div><p className="font-semibold">{student.name}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{student.login_id || "No Login ID"} · Onboarded {formatDate(student.created_at)}{student.attendanceAliases?.length ? ` · Teams: ${student.attendanceAliases.join(", ")}` : ""}</p></div><div className="flex gap-2 flex-wrap justify-end"><span className={student.status === "active" ? "badge-done" : "badge-failed"}>{student.status}</span>{onOpenStudents && <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenStudents}>View</button>}<button type="button" className="btn btn-secondary btn-sm" onClick={() => resetPassword(student)}>Reset Password</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => askTransfer(student)}>Transfer Batch</button></div></div>)}</div>}
      </section>

      <section className="card admin-panel grid gap-3">
        <div><h3 className="text-lg font-bold">Recent Onboarding History</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>History includes outcomes and Login IDs where useful, never passwords.</p></div>
        {overview.imports.length === 0 ? <p className="text-sm" style={{ color: "var(--text-muted)" }}>No roster imports for this batch yet.</p> : <div className="grid gap-2">{overview.imports.map(item => <div className="admin-row" key={item.id}><div><p className="font-semibold">{item.original_filename}</p><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{formatDate(item.completed_at || item.created_at)} · Uploaded by {item.uploaded_by_name}</p></div><p className="text-xs text-right" style={{ color: "var(--text-secondary)" }}>{item.new_count} new · {item.existing_count} existing · {item.possible_duplicate_count} review · {item.invalid_count} invalid</p></div>)}</div>}
      </section>

      {transferTarget && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)" }} role="dialog" aria-modal="true" aria-labelledby="transfer-student-title"><div className="card p-5 w-full max-w-md"><h3 id="transfer-student-title" className="text-lg font-bold">Transfer existing student?</h3><p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}><b>{transferTarget.name}</b> is currently assigned to {transferTarget.batch}. Existing credentials and history will be preserved.</p><label className="label mt-4">Target batch<SearchableBatchSelect batches={batchNames} value={transferBatch} onChange={setTransferBatch} placeholder="Select target batch" label="Transfer target batch" required /></label><div className="flex justify-end gap-2 mt-5"><button type="button" className="btn btn-secondary" onClick={() => setTransferTarget(null)} disabled={loading}>Cancel</button><button type="button" className="btn btn-primary" onClick={confirmTransfer} disabled={loading || !transferBatch || transferBatch === transferTarget.batch}>{loading ? <Spinner size="sm" /> : "Confirm Transfer"}</button></div></div></div>}
    </div>
  )
}
