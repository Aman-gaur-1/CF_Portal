"use client"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { BROWSER_RENDERABLE, formatDate, getTypeLabel, getTypeEmoji, getFileValidationError, isFileAllowed } from "@/lib/utils"
import { getCourseworkPoints } from "@/lib/coursework-scoring"
import { triggerAiEvaluation } from "@/lib/ai/trigger-evaluation"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"
import Tabs from "@/components/ui/Tabs"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import ScoreSection from "@/components/student/ScoreSection"
import StudentQueryPanel from "@/components/student/StudentQueryPanel"
import ThemeToggle from "@/components/ui/ThemeToggle"
import AiStatusBadge from "@/components/ui/AiStatusBadge"
import NotificationBell from "@/components/ui/NotificationBell"
import StudentHealthCard from "@/components/student/StudentHealthCard"
import PageHeader from "@/components/ui/PageHeader"
import { useToast, ToastContainer } from "@/components/ui/Toast"
import { detectAssignmentLanguage } from "@/lib/assignment-analysis"

const TABS = [{ id: "submit", label: "Submit assignment" }, { id: "feedback", label: "My feedback" }, { id: "health", label: "Student Health Card" }]
const MAX_MB = 10

const FEEDBACK_LANGUAGES = [
  { id: "english", label: "English" },
  { id: "hinglish", label: "Hinglish" },
  { id: "hindi", label: "Hindi" },
]

function isReviewedSubmission(row) {
  return Boolean(row?.feedback || row?.feedback_at || row?.reviewed || row?.reviewed_at)
}

function FeedbackTranslation({ feedback, authToken, onError }) {
  const [activeLanguage, setActiveLanguage] = useState("english")
  const [translations, setTranslations] = useState({
    english: feedback,
    hinglish: "",
    hindi: "",
  })
  const [loadingLanguage, setLoadingLanguage] = useState("")

  useEffect(() => {
    setActiveLanguage("english")
    setTranslations({ english: feedback, hinglish: "", hindi: "" })
    setLoadingLanguage("")
  }, [feedback])

  async function selectLanguage(language) {
    if (language === activeLanguage || loadingLanguage) return
    if (translations[language]) {
      setActiveLanguage(language)
      return
    }

    setLoadingLanguage(language)
    try {
      const res = await fetch("/api/translate-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken || ""}` },
        body: JSON.stringify({ feedback, targetLanguage: language }),
      })
      const data = await res.json()
      if (!res.ok || !data.translation) {
        throw new Error(data.error || "Could not translate feedback.")
      }
      setTranslations(prev => ({ ...prev, [language]: data.translation }))
      setActiveLanguage(language)
    } catch (err) {
      onError(err.message || "Could not translate feedback.")
    } finally {
      setLoadingLanguage("")
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {FEEDBACK_LANGUAGES.map(language => {
          const isActive = activeLanguage === language.id
          const isLoading = loadingLanguage === language.id
          return (
            <button
              key={language.id}
              type="button"
              className="btn btn-xs"
              onClick={() => selectLanguage(language.id)}
              disabled={Boolean(loadingLanguage)}
              style={{
                background: isActive ? "var(--primary)" : "var(--bg-card)",
                border: "1px solid var(--border)",
                color: isActive ? "#1a1a1a" : "var(--text-secondary)",
              }}
            >
              {isLoading ? <Spinner size="sm" /> : language.label}
            </button>
          )
        })}
      </div>
      <p className="text-sm whitespace-pre-wrap">{translations[activeLanguage] || feedback}</p>
    </>
  )
}

async function readFileForDetection(file) {
  if (!file) return ""
  const lowerName = String(file.name || "").toLowerCase()
  if (!/\.(py|sql|txt|md|json|ipynb|csv|html?)$/.test(lowerName)) return ""
  if (file.size > 1024 * 1024) return ""
  return file.text()
}

export default function StudentView({ student, onLogout, onSessionRefresh }) {
    const [tab, setTab] = useState("submit")
  const [submissions, setSubmissions] = useState([])
  const [lifetimeCoursework, setLifetimeCoursework] = useState(null)
  const [activeCoursework, setActiveCoursework] = useState([])
  const [loadingCoursework, setLoadingCoursework] = useState(false)
  const [selectedType, setSelectedType] = useState("assignment")
  const [selectedCourseworkId, setSelectedCourseworkId] = useState("")
  const [selectedPhaseFilter, setSelectedPhaseFilter] = useState("")
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [detectedAssignment, setDetectedAssignment] = useState({ language: "Unknown", phase: "Unknown", confidence: "none", evidence: [] })
  const [studentQueryEnabled, setStudentQueryEnabled] = useState(false)
  const [assignmentQueries, setAssignmentQueries] = useState([])
  const loadAbortRef = useRef(null)
  const { toasts, success, error: showError } = useToast()
  const showErrorRef = useRef(showError)

  const [file, setFile] = useState(null)
  const [code, setCode] = useState("")
  const [comment, setComment] = useState("")

  const selectedCoursework = useMemo(() => activeCoursework.find(item => String(item.id) === String(selectedCourseworkId)) || null, [activeCoursework, selectedCourseworkId])
  const topic = selectedCoursework?.title || ""
  const selectedPhase = selectedCoursework?.phase || ""

  function displayFileName(submission) {
    return submission.original_file_name || submission.file_name
  }

  useEffect(() => {
    showErrorRef.current = showError
  }, [showError])

  useEffect(() => {
    let cancelled = false

    async function detect() {
      const fileText = file ? await readFileForDetection(file) : ""
      if (cancelled) return
      setDetectedAssignment(detectAssignmentLanguage({
        text: [code, fileText].filter(Boolean).join("\n"),
        fileName: file?.name || "",
        topic,
      }))
      setPhaseWarningAcknowledged(false)
    }

    detect().catch(() => {
      if (!cancelled) {
        setDetectedAssignment(detectAssignmentLanguage({ text: code, fileName: file?.name || "", topic }))
        setPhaseWarningAcknowledged(false)
      }
    })

    return () => { cancelled = true }
  }, [code, file, topic, selectedPhase])

  const authenticatedFetch = useCallback(async (url, init = {}) => {
    const request = async token => {
      const headers = new Headers(init.headers || {})
      headers.set('Authorization', `Bearer ${token || ''}`)
      return fetch(url, { ...init, headers })
    }

    let response = await request(student.token)
    if (response.status === 401 && onSessionRefresh) {
      const refreshedStudent = await onSessionRefresh(student.token)
      if (refreshedStudent?.token) response = await request(refreshedStudent.token)
    }
    return response
  }, [student.token, onSessionRefresh])

  const loadQueries = useCallback(async () => {
    const res = await authenticatedFetch("/api/student-queries", {
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "Could not load queries.")
    setStudentQueryEnabled(Boolean(data.enabled))
    setAssignmentQueries(data.queries || [])
  }, [authenticatedFetch])

  const loadActiveCoursework = useCallback(async () => {
    setLoadingCoursework(true)
    try {
      const res = await authenticatedFetch("/api/student-coursework", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load active coursework.")
      const items = Array.isArray(data.coursework) ? data.coursework : []
      setActiveCoursework(items)
      setSelectedCourseworkId(current => items.some(item => String(item.id) === String(current)) ? current : String(items.find(item => item.item_type === selectedType && !item.completed)?.id || items.find(item => item.item_type === selectedType)?.id || ""))
    } catch (err) {
      showErrorRef.current(err.message || "Could not load active coursework.")
      setActiveCoursework([])
      setSelectedCourseworkId("")
    } finally {
      setLoadingCoursework(false)
    }
  }, [authenticatedFetch, selectedType])

  const loadSubmissions = useCallback(async ({ silent = false } = {}) => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    if (!silent) setLoadingSubs(true)
    try {
      const res = await authenticatedFetch("/api/student-submissions", {
        cache: "no-store",
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load submissions.")

      if (!controller.signal.aborted) {
        setSubmissions(data.submissions || [])
        setLifetimeCoursework(data.lifetimeCoursework || null)
      }
    } catch (err) {
      if (err.name !== "AbortError") showErrorRef.current(err.message || "Could not load submissions.")
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
        if (!silent) setLoadingSubs(false)
      }
    }
  }, [authenticatedFetch])

  useEffect(() => {
    if (tab === "submit") loadActiveCoursework()
    if (tab === "feedback") {
      loadSubmissions()
      loadQueries().catch(() => {})
    }
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort()
    }
  }, [tab, loadActiveCoursework, loadSubmissions, loadQueries])

  const typedCoursework = useMemo(() => activeCoursework.filter(item => item.item_type === selectedType), [activeCoursework, selectedType])
  const activePhases = useMemo(() => [...new Set(typedCoursework.map(item => item.phase).filter(Boolean))], [typedCoursework])
  const visibleCoursework = useMemo(() => typedCoursework.filter(item => !selectedPhaseFilter || item.phase === selectedPhaseFilter), [selectedPhaseFilter, typedCoursework])

  useEffect(() => {
    setSelectedPhaseFilter(current => activePhases.includes(current) ? current : (activePhases[0] || ""))
  }, [activePhases])

  useEffect(() => {
    setSelectedCourseworkId(current => visibleCoursework.some(item => String(item.id) === String(current)) ? current : String(visibleCoursework.find(item => !item.completed)?.id || visibleCoursework[0]?.id || ""))
  }, [visibleCoursework])

  const needsSubmissionPolling = tab === "feedback" && submissions.some(
    s => !s.feedback && (s.ai_status === "pending" || s.ai_status === "processing")
  )

  useAdaptivePolling(
    () => {
      loadSubmissions({ silent: true })
    },
    { enabled: needsSubmissionPolling, activeMs: 5000 }
  )

  useAdaptivePolling(
    () => loadQueries().catch(() => {}),
    { enabled: tab === "feedback" && studentQueryEnabled, activeMs: 15000 }
  )

  function handleQueryCreated(query) {
    if (!query?.id) return
    setAssignmentQueries(prev => [query, ...prev.filter(item => item.id !== query.id)])
  }

  const querySummaryBySubmission = useMemo(() => {
    const summary = new Map()
    for (const query of assignmentQueries) {
      const key = String(query.submission_id)
      const current = summary.get(key) || { open: 0, resolved: 0 }
      if (query.status === "resolved") current.resolved += 1
      else current.open += 1
      summary.set(key, current)
    }
    return summary
  }, [assignmentQueries])

  function queryBadgeForSubmission(submissionId) {
    if (!studentQueryEnabled) return null
    const summary = querySummaryBySubmission.get(String(submissionId))
    if (!summary) return null
    if (summary.open > 0) return <span className="badge-query-open">{summary.open} Open Query</span>
    if (summary.resolved > 0) return <span className="badge-query-resolved">{summary.resolved} Resolved Query</span>
    return null
  }

    async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedCoursework || selectedCoursework.completed) { showError("Select an active coursework item that is not already completed."); return }
    if (!file && !code.trim()) { showError("Upload a file or paste your code."); return }

    // Comprehensive file validation
    if (file) {
      const fileError = getFileValidationError(file)
      if (fileError) {
        showError(fileError)
        return
      }
      if (!isFileAllowed(file)) {
        showError("File type not allowed for security reasons")
        return
      }
    }

    setSubmitting(true)
    let storedName = null, fileUrl = null, originalFileName = null

    try {
      if (file) {
        const prepareRes = await fetch("/api/student-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type || "application/octet-stream" }),
        })
        const prepareData = await prepareRes.json().catch(() => ({}))
        if (!prepareRes.ok || !prepareData.upload) throw new Error(prepareData.error || "Could not prepare file upload.")

        storedName = prepareData.upload.fileName
        fileUrl = prepareData.upload.fileUrl
        originalFileName = prepareData.upload.originalFileName
        const { error: uploadErr } = await supabase.storage.from("assignments").upload(storedName, file, { contentType: prepareData.upload.mimeType })
        if (uploadErr) throw uploadErr
      }
      const submissionPayload = {
        coursework_item_id: selectedCoursework.id,
        file_name: storedName, original_file_name: originalFileName, file_url: fileUrl,
        code_text: code.trim() || null,
        comment: comment.trim(),
        detected_assignment_language: detectedAssignment.language !== "Unknown" ? detectedAssignment.language : null,
        detected_assignment_phase: detectedAssignment.phase !== "Unknown" ? detectedAssignment.phase : null,
      }

      const submitRes = await authenticatedFetch("/api/student-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionPayload),
      })
      const submitData = await submitRes.json().catch(() => ({}))
      if (!submitRes.ok || !submitData.submission) {
        throw new Error(submitData.error || "Could not submit assignment.")
      }
      success("Assignment submitted! Your trainer review has started.")

      if (submitData.submission?.id) {
        triggerAiEvaluation(submitData.submission.id, { token: student.token }).then(result => {
          if (!result.ok) {
            console.warn("AI evaluation trigger failed:", result.error)
          }
        })
      }

      setFile(null); setCode(""); setComment("")
      await loadActiveCoursework()
      const fi = document.getElementById("fileInput"); if (fi) fi.value = ""
    } catch (err) {
      showError(`Submission failed: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const pending = submissions.filter(r => !isReviewedSubmission(r)).length
  return (
    <div className="portal-shell">
      <div className="portal-content">
        <PageHeader
          eyebrow="ConsoleFlare student portal"
          title="Assignment Portal"
          subtitle="Submit coursework, review feedback, and keep your Health Card progress in view."
          meta={<><span className="portal-chip">{student.name}</span><span className="portal-chip">{student.batch}</span></>}
          actions={<><NotificationBell userType="student" student={student} /><ThemeToggle /><button className="btn btn-secondary btn-sm" onClick={onLogout}>Log out</button></>}
        />

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === "health" && <StudentHealthCard student={student} success={success} showError={showError} />}

        {/* Submit Tab */}
        {tab === "submit" && (
          <div className="card p-6">
            <div className="section-divider mb-5">
              <span>📝</span>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>New Submission</span>
              <div className="line" />
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="label">Type
                  <select className="input mt-1" value={selectedType} onChange={event => setSelectedType(event.target.value)}>
                    <option value="assignment">Assignment</option>
                    <option value="project">Project</option>
                  </select>
                </label>
                <label className="label">Phase
                  <select className="input mt-1" value={selectedPhaseFilter} onChange={event => setSelectedPhaseFilter(event.target.value)} disabled={!activePhases.length}>
                    <option value="">{activePhases.length ? "Select coursework" : "No active phase"}</option>
                    {activePhases.map(phase => <option key={phase} value={phase}>{phase}</option>)}
                  </select>
                </label>
                <label className="label">Coursework
                  <select className="input mt-1" value={selectedCourseworkId} onChange={event => setSelectedCourseworkId(event.target.value)} disabled={loadingCoursework || !visibleCoursework.length}>
                    <option value="">{loadingCoursework ? "Loading active coursework…" : "Select coursework"}</option>
                    {visibleCoursework.map(item => <option key={item.id} value={item.id}>{item.title}{item.completed ? " · Completed" : ""}</option>)}
                  </select>
                </label>
              </div>
              {!loadingCoursework && !activeCoursework.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No active coursework is available for your batch yet.</p>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl p-4" style={{ border: "1px dashed var(--border)", background: "var(--surface)" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>📁 Option 1: Upload File</p>
                  <label className="label">File (max {MAX_MB}MB)</label>
                  <input id="fileInput" type="file" accept=".py,.txt,.md,.json,.html,.ipynb,.js,.ts,.jsx,.tsx,.csv,.pdf,.docx"
                    className="input text-xs py-2 cursor-pointer"
                    onChange={e => setFile(e.target.files[0] || null)}
                    style={{ color: "var(--text-secondary)" }}
                  />
                  {file && <p className="text-xs mt-1" style={{ color: "var(--primary)" }}>✅ {file.name}</p>}
                </div>
                <div className="rounded-xl p-4" style={{ border: "1px dashed var(--border)", background: "var(--surface)" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>💻 Option 2: Paste Code</p>
                  <label className="label">Paste Code Here</label>
                  <textarea className="input font-mono text-xs" rows={5} value={code} onChange={e => setCode(e.target.value)} placeholder="# Paste your Python code here..." />
                </div>
              </div>

              <div>
                <label className="label">💬 Doubt or Comment? (Optional)</label>
                <textarea className="input" rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Any question or note for the trainer..." />
              </div>

              <button type="submit" className="btn btn-primary flex items-center justify-center gap-2" disabled={submitting || !selectedCoursework || selectedCoursework.completed}>
                {submitting ? <Spinner /> : `🚀 Submit ${selectedType === "project" ? "Project" : "Assignment"}`}
              </button>
            </form>
          </div>
        )}

        {/* Feedback Tab */}
        {tab === "feedback" && (
          <div>
            {loadingSubs ? (
              <div className="flex justify-center py-16"><Spinner size="lg" /></div>
            ) : submissions.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-4xl mb-3">📭</p>
                <p style={{ color: "var(--text-secondary)" }}>No assignments submitted yet. Go to the Submit tab!</p>
              </div>
            ) : (
              <>
                <ScoreSection submissions={submissions} lifetimeCoursework={lifetimeCoursework} />

                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[[submissions.length, "Total Submitted"], [pending, "Pending Feedback"], [submissions.length - pending, "Feedback Done"]].map(([n, l]) => (
                    <div key={l} className="stat-card"><div className="stat-num">{n}</div><div className="stat-label">{l}</div></div>
                  ))}
                </div>

                {submissions.map(r => {
                  const hasFb = isReviewedSubmission(r)
                  const pts = Number.isFinite(Number(r.coursework_points)) ? Number(r.coursework_points) : getCourseworkPoints(r.submission_type)
                  const pointLabel = pts ? ` • +${pts} pts` : ""
                  const rawType = r.submission_type || "assignment"
                  const typeLabel = getTypeLabel(rawType)
                  const typeEmoji = getTypeEmoji(rawType)
                  const shownFileName = displayFileName(r)
                  const queryBadge = queryBadgeForSubmission(r.id)
                  return (
                    <Expander
                      key={r.id}
                      title={`${hasFb ? "✅" : "⏳"} ${r.topic} • ${formatDate(r.submitted_at)}${pointLabel}`}
                      badge={(
                        <span className="flex items-center gap-2 flex-wrap">
                          {queryBadge}
                          {hasFb ? <span className="badge-done">DONE</span> : <span className="badge-pending animate-pulse">PENDING</span>}
                        </span>
                      )}
                    >
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                        <span><b>Topic:</b> {r.topic}</span>
                        <span><b>Date:</b> {formatDate(r.submitted_at)}</span>
                        <span><b>Type:</b> {typeEmoji} {typeLabel} {pts > 0 && <span className="text-xs" style={{ color: "var(--primary)" }}>+{pts} pts</span>}</span>
                        <span><b>Phase:</b> {r.phase || "Unassigned"}</span>
                      </div>
                      {r.comment && <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ background: "var(--surface)", color: "var(--text-secondary)" }}>💬 {r.comment}</p>}
                      {r.file_url && r.file_name && (
                        <div className="flex gap-2 mb-3 flex-wrap">
                          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>📎 {shownFileName}</span>
                          {BROWSER_RENDERABLE.has(shownFileName.split(".").pop()?.toLowerCase()) && (
                            <a href={r.file_url} target="_blank" className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: "var(--accent)", color: "#fff" }}>🔗 Open</a>
                          )}
                          <a href={`${r.file_url}?download=${encodeURIComponent(shownFileName)}`} target="_blank" className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: "var(--primary)", color: "#1a1a1a" }}>⬇️ Download</a>
                        </div>
                      )}
                      {r.code_text && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>YOUR CODE:</p>
                          <pre className="code-block">{r.code_text}</pre>
                        </div>
                      )}
                      {hasFb ? (
                        <div className="feedback-box">
                          <p className="text-xs mb-1 font-semibold" style={{ color: "var(--success)" }}>Feedback by {r.feedback_by || "Teacher"} {r.feedback_at ? "• " + formatDate(r.feedback_at) : ""}</p>
                          <FeedbackTranslation feedback={r.feedback} authToken={student.token} onError={showError} />
                          <StudentQueryPanel
                            enabled={studentQueryEnabled}
                            student={student}
                            submissionId={r.id}
                            queries={assignmentQueries}
                            onCreated={handleQueryCreated}
                            onError={showError}
                            onSuccess={success}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 text-sm py-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="badge-pending animate-pulse">FEEDBACK PENDING</span>
                            <AiStatusBadge status={r.ai_status} error={r.ai_error} showReady={false} neutral />
                          </div>
                          <span style={{ color: "var(--text-muted)" }}>
                            {r.ai_status === "processing" || r.ai_status === "pending"
                              ? "Your assignment is under review. You'll see feedback here once your trainer publishes it."
                              : "Your trainer will review and publish feedback soon."}
                          </span>
                        </div>
                      )}
                    </Expander>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="portal-footer">
          <div className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <span>{"Built with ✨ by"}</span>
            <button
              onClick={() => window.open("https://www.linkedin.com/in/aman-gaur-39077214a", "_blank")}
              style={{ color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: "inherit", fontWeight: 600 }}
            >
              {"Aman Gaur"}
            </button>
            <span>{"• ConsoleFlare •"} {new Date().getFullYear()}</span>
          </div>
          <ThemeToggle />
        </div>
      </div>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
