"use client"
import { useState, useEffect, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { getPoints, BROWSER_RENDERABLE, formatDate, getTypeLabel, getTypeEmoji, getFileValidationError, isFileAllowed } from "@/lib/utils"
import { triggerAiEvaluation } from "@/lib/ai/trigger-evaluation"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"
import Tabs from "@/components/ui/Tabs"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import ScoreSection from "@/components/student/ScoreSection"
import ThemeToggle from "@/components/ui/ThemeToggle"
import AiStatusBadge from "@/components/ui/AiStatusBadge"
import { useToast, ToastContainer } from "@/components/ui/Toast"

const TABS = [{ id: "submit", label: "📤 Submit Assignment" }, { id: "feedback", label: "📋 My Feedback" }]
const MAX_MB = 10

const FEEDBACK_LANGUAGES = [
  { id: "english", label: "English" },
  { id: "hinglish", label: "Hinglish" },
  { id: "hindi", label: "Hindi" },
]

function isReviewedSubmission(row) {
  return Boolean(row?.feedback || row?.feedback_at || row?.reviewed || row?.reviewed_at)
}

function FeedbackTranslation({ feedback, onError }) {
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
        headers: { "Content-Type": "application/json" },
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

export default function StudentView({ student, onLogout }) {
    const [tab, setTab] = useState("submit")
  const [submissions, setSubmissions] = useState([])
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const loadAbortRef = useRef(null)
  const { toasts, success, error: showError } = useToast()

  const [topic, setTopic] = useState("")
  const [file, setFile] = useState(null)
  const [code, setCode] = useState("")
  const [comment, setComment] = useState("")

  function displayFileName(submission) {
    return submission.original_file_name || submission.file_name
  }

  const loadSubmissions = useCallback(async ({ silent = false } = {}) => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    if (!silent) setLoadingSubs(true)
    const { data } = await supabase
      .from("submissions")
      .select("*")
      .eq("student_id", student.id)
      .order("submitted_at", { ascending: false })
      .abortSignal(controller.signal)

    if (!controller.signal.aborted) setSubmissions(data || [])
    if (loadAbortRef.current === controller) {
      loadAbortRef.current = null
      if (!silent) setLoadingSubs(false)
    }
  }, [student.id])

  useEffect(() => {
    if (tab === "feedback") loadSubmissions()
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort()
    }
  }, [tab, loadSubmissions])

  const needsSubmissionPolling = tab === "feedback" && submissions.some(
    s => !s.feedback && (s.ai_status === "pending" || s.ai_status === "processing")
  )

  useAdaptivePolling(
    () => loadSubmissions({ silent: true }),
    { enabled: needsSubmissionPolling, activeMs: 5000 }
  )

    async function handleSubmit(e) {
    e.preventDefault()
    if (!topic.trim()) { showError("Topic is required."); return }
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
      const { data: inserted, error: dbErr } = await supabase.from("submissions").insert({
        student_id: student.id, student_name: student.name, batch: student.batch,
        topic: topic.trim(), file_name: storedName, original_file_name: originalFileName, file_url: fileUrl,
        code_text: code.trim() || null, comment: comment.trim(),
        submitted_at: new Date().toISOString(), submission_type: "assignment", phase: "Python",
        ai_status: "pending"
      }).select("id").single()
      if (dbErr) {
        if (storedName) await supabase.storage.from("assignments").remove([storedName]).catch(() => {})
        throw dbErr
      }
      success("Assignment submitted! Your trainer review has started.")

      if (inserted?.id) {
        triggerAiEvaluation(inserted.id).then(result => {
          if (!result.ok) {
            console.warn("AI evaluation trigger failed:", result.error)
          }
        })
      }

      setTopic(""); setFile(null); setCode(""); setComment("")
      const fi = document.getElementById("fileInput"); if (fi) fi.value = ""
    } catch (err) {
      showError(`Submission failed: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const pending = submissions.filter(r => !isReviewedSubmission(r)).length

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg-main)" }}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black gradient-text">Assignment Portal</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>👤 {student.name} &nbsp;•&nbsp; 📚 {student.batch}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ThemeToggle />
            <button className="btn btn-secondary btn-sm text-xs" onClick={onLogout}>🚪 Logout</button>
          </div>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {/* Submit Tab */}
        {tab === "submit" && (
          <div className="card p-6">
            <div className="section-divider mb-5">
              <span>📝</span>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>New Submission</span>
              <div className="line" />
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="label">Assignment Topic *</label>
                <input className="input" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Functions, OOP, Pandas..." />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl p-4" style={{ border: "1px dashed var(--border)", background: "rgba(245,166,35,0.03)" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>📁 Option 1: Upload File</p>
                  <label className="label">File (max {MAX_MB}MB)</label>
                  <input id="fileInput" type="file" accept=".py,.txt,.md,.json,.html,.ipynb,.js,.ts,.jsx,.tsx,.csv,.zip,.pdf"
                    className="input text-xs py-2 cursor-pointer"
                    onChange={e => setFile(e.target.files[0] || null)}
                    style={{ color: "var(--text-secondary)" }}
                  />
                  {file && <p className="text-xs mt-1" style={{ color: "var(--primary)" }}>✅ {file.name}</p>}
                </div>
                <div className="rounded-xl p-4" style={{ border: "1px dashed var(--border)", background: "rgba(245,166,35,0.03)" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>💻 Option 2: Paste Code</p>
                  <label className="label">Paste Code Here</label>
                  <textarea className="input font-mono text-xs" rows={5} value={code} onChange={e => setCode(e.target.value)} placeholder="# Paste your Python code here..." />
                </div>
              </div>

              <div>
                <label className="label">💬 Doubt or Comment? (Optional)</label>
                <textarea className="input" rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Any question or note for the trainer..." />
              </div>

              <button type="submit" className="btn btn-primary flex items-center justify-center gap-2" disabled={submitting}>
                {submitting ? <Spinner /> : "🚀 Submit Assignment"}
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
                <ScoreSection submissions={submissions} />

                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[[submissions.length, "Total Submitted"], [pending, "Pending Feedback"], [submissions.length - pending, "Feedback Done"]].map(([n, l]) => (
                    <div key={l} className="stat-card"><div className="stat-num">{n}</div><div className="stat-label">{l}</div></div>
                  ))}
                </div>

                {submissions.map(r => {
                  const hasFb = isReviewedSubmission(r)
                  const pts = getPoints(r.submission_type)
                  const rawType = r.submission_type || "assignment"
                  const typeLabel = getTypeLabel(rawType)
                  const typeEmoji = getTypeEmoji(rawType)
                  const shownFileName = displayFileName(r)
                  return (
                    <Expander
                      key={r.id}
                      title={`${hasFb ? "✅" : "⏳"} ${r.topic} • ${formatDate(r.submitted_at)} • +${pts}pts`}
                      badge={hasFb ? <span className="badge-done">DONE</span> : <span className="badge-pending animate-pulse">PENDING</span>}
                    >
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                        <span><b>Topic:</b> {r.topic}</span>
                        <span><b>Date:</b> {formatDate(r.submitted_at)}</span>
                        <span><b>Type:</b> {typeEmoji} {typeLabel} &nbsp;<span className="text-xs" style={{ color: "var(--primary)" }}>+{pts}pts</span></span>
                        <span><b>Phase:</b> {r.phase || "Python"}</span>
                      </div>
                      {r.comment && <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245,166,35,0.06)", color: "var(--text-secondary)" }}>💬 {r.comment}</p>}
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
                          <FeedbackTranslation feedback={r.feedback} onError={showError} />
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
        <div className="flex items-center justify-between mt-8 flex-wrap gap-3">
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
