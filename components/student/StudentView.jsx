"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { sanitizeFilename, getPoints, BROWSER_RENDERABLE, formatDate } from "@/lib/utils"
import Tabs from "@/components/ui/Tabs"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import ScoreSection from "@/components/student/ScoreSection"
import ThemeToggle from "@/components/ui/ThemeToggle"
import { useToast, ToastContainer } from "@/components/ui/Toast"

const TABS = [{ id: "submit", label: "📤 Submit Assignment" }, { id: "feedback", label: "📋 My Feedback" }]
const MAX_MB = 10

export default function StudentView({ student, onLogout }) {
  const [tab, setTab] = useState("submit")
  const [submissions, setSubmissions] = useState([])
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { toasts, success, error: showError } = useToast()

  const [topic, setTopic] = useState("")
  const [file, setFile] = useState(null)
  const [code, setCode] = useState("")
  const [comment, setComment] = useState("")

  const loadSubmissions = useCallback(async () => {
    setLoadingSubs(true)
    const { data } = await supabase.from("submissions").select("*").eq("student_id", student.id).order("submitted_at", { ascending: false })
    setSubmissions(data || [])
    setLoadingSubs(false)
  }, [student.id])

  useEffect(() => {
    if (tab === "feedback") loadSubmissions()
  }, [tab, loadSubmissions])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!topic.trim()) { showError("Topic is required."); return }
    if (!file && !code.trim()) { showError("Upload a file or paste your code."); return }
    if (file && file.size > MAX_MB * 1024 * 1024) { showError(`File exceeds ${MAX_MB}MB limit.`); return }

    setSubmitting(true)
    let storedName = null, fileUrl = null

    try {
      if (file) {
        const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)
        storedName = `${sanitizeFilename(student.name)}_${ts}_${sanitizeFilename(file.name)}`
        const { error: uploadErr } = await supabase.storage.from("assignments").upload(storedName, file, { contentType: file.type || "application/octet-stream" })
        if (uploadErr) throw uploadErr
        fileUrl = supabase.storage.from("assignments").getPublicUrl(storedName).data.publicUrl
      }
      const { error: dbErr } = await supabase.from("submissions").insert({
        student_id: student.id, student_name: student.name, batch: student.batch,
        topic: topic.trim(), file_name: storedName, file_url: fileUrl,
        code_text: code.trim() || null, comment: comment.trim(),
        submitted_at: new Date().toISOString(), submission_type: "assignment", phase: "Python"
      })
      if (dbErr) {
        if (storedName) await supabase.storage.from("assignments").remove([storedName]).catch(() => {})
        throw dbErr
      }
      success("Assignment submitted! Check Feedback tab for updates.")
      setTopic(""); setFile(null); setCode(""); setComment("")
      const fi = document.getElementById("fileInput"); if (fi) fi.value = ""
    } catch (err) {
      showError(`Submission failed: ${err.message}`)
    }
    setSubmitting(false)
  }

  const pending = submissions.filter(r => !r.feedback).length

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
                  <input id="fileInput" type="file" accept=".py,.txt,.ipynb,.zip,.pdf,.html"
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
                  const hasFb = !!r.feedback
                  const pts = getPoints(r.submission_type)
                  const type = r.submission_type || "assignment"
                  const typeEmoji = type === "project" ? "🚀" : "📝"
                  return (
                    <Expander
                      key={r.id}
                      title={`${hasFb ? "✅" : "⏳"} ${r.topic} • ${formatDate(r.submitted_at)} • +${pts}pts`}
                      badge={hasFb ? <span className="badge-done">DONE</span> : <span className="badge-pending animate-pulse">PENDING</span>}
                    >
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                        <span><b>Topic:</b> {r.topic}</span>
                        <span><b>Date:</b> {formatDate(r.submitted_at)}</span>
                        <span><b>Type:</b> {typeEmoji} {type} &nbsp;<span className="text-xs" style={{ color: "var(--primary)" }}>+{pts}pts</span></span>
                        <span><b>Phase:</b> {r.phase || "Python"}</span>
                      </div>
                      {r.comment && <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245,166,35,0.06)", color: "var(--text-secondary)" }}>💬 {r.comment}</p>}
                      {r.file_url && r.file_name && (
                        <div className="flex gap-2 mb-3 flex-wrap">
                          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>📎 {r.file_name}</span>
                          {BROWSER_RENDERABLE.has(r.file_name.split(".").pop()?.toLowerCase()) && (
                            <a href={r.file_url} target="_blank" className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: "var(--accent)", color: "#fff" }}>🔗 Open</a>
                          )}
                          <a href={`${r.file_url}?download=${r.file_name}`} target="_blank" className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: "var(--primary)", color: "#1a1a1a" }}>⬇️ Download</a>
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
                          <p className="text-sm whitespace-pre-wrap">{r.feedback}</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm py-2">
                          <span className="badge-pending animate-pulse">FEEDBACK PENDING</span>
                          <span style={{ color: "var(--text-muted)" }}>Your trainer will review soon.</span>
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
            <span>{"Built with ❤️ by"}</span>
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
