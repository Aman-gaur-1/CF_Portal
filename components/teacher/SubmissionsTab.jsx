"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { getPoints, BROWSER_RENDERABLE, formatDate } from "@/lib/utils"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import ConfirmDialog from "@/components/ui/ConfirmDialog"
import { useToast, ToastContainer } from "@/components/ui/Toast"

const TYPE_OPTIONS = ["assignment", "project"]
const PHASE_OPTIONS = ["Python", "Data Analytics"]

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-1 rounded font-semibold"
      style={{ background: copied ? "var(--success)" : "var(--primary)", color: "#1a1a1a" }}
    >
      {copied ? "✅ Copied!" : "📋 Copy"}
    </button>
  )
}

function FeedbackEditor({ r, newType, newPhase, teacherName, onSaved }) {
  const [editing, setEditing] = useState(!r.feedback)
  const [fb, setFb] = useState(r.feedback || "")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!fb.trim()) return
    setSaving(true)
    await supabase.from("submissions").update({
      feedback: fb.trim(), feedback_by: teacherName,
      feedback_at: new Date().toISOString(),
      submission_type: newType, phase: newPhase
    }).eq("id", r.id)
    setSaving(false)
    setEditing(false)
    onSaved()
  }

  if (r.feedback && !editing) return (
    <div>
      <div className="feedback-box mb-2">
        <p className="text-xs font-semibold mb-1" style={{ color: "var(--success)" }}>By {r.feedback_by} {r.feedback_at ? "• " + formatDate(r.feedback_at) : ""}</p>
        <p className="text-sm whitespace-pre-wrap">{r.feedback}</p>
      </div>
      <button className="btn btn-secondary btn-sm w-full" onClick={() => setEditing(true)}>✏️ Edit Feedback</button>
    </div>
  )

  return (
    <div>
      <label className="label">Write Feedback</label>
      <textarea className="input text-sm mb-2" rows={5} value={fb} onChange={e => setFb(e.target.value)} placeholder="Write detailed feedback here..." />
      <button className="btn btn-primary w-full flex items-center justify-center gap-2" onClick={save} disabled={saving || !fb.trim()}>
        {saving ? <Spinner /> : "💾 Save Feedback"}
      </button>
    </div>
  )
}

export default function SubmissionsTab({ teacherName }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("All")
  const [batchFilter, setBatchFilter] = useState("All Batches")
  const [search, setSearch] = useState("")
  const [confirming, setConfirming] = useState(null)
  const [submissionTypes, setSubmissionTypes] = useState({})
  const [submissionPhases, setSubmissionPhases] = useState({})
  const { toasts, success, error: showError } = useToast()

  async function load() {
    setLoading(true)
    const { data: rows } = await supabase.from("submissions").select("*").order("submitted_at", { ascending: false })
    setData(rows || [])
    const types = {}, phases = {}
    for (const r of rows || []) {
      types[r.id] = r.submission_type || "assignment"
      phases[r.id] = r.phase || "Python"
    }
    setSubmissionTypes(types); setSubmissionPhases(phases)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function deleteSubmission(r) {
    if (r.file_name) await supabase.storage.from("assignments").remove([r.file_name]).catch(() => {})
    const { error } = await supabase.from("submissions").delete().eq("id", r.id)
    if (error) { showError("Delete failed."); return }
    success("Deleted."); setConfirming(null); load()
  }

  const batches = ["All Batches", ...new Set(data.map(d => d.batch).filter(Boolean))]
  let filtered = data
  if (statusFilter === "Pending Feedback") filtered = filtered.filter(d => !d.feedback)
  if (statusFilter === "Feedback Done") filtered = filtered.filter(d => !!d.feedback)
  if (batchFilter !== "All Batches") filtered = filtered.filter(d => d.batch === batchFilter)
  if (search.trim()) filtered = filtered.filter(d => d.student_name?.toLowerCase().includes(search.trim().toLowerCase()))

  const pending = data.filter(d => !d.feedback).length

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[[data.length, "Total"], [pending, "Pending"], [data.length - pending, "Reviewed"]].map(([n, l]) => (
          <div key={l} className="stat-card"><div className="stat-num">{n}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {["All", "Pending Feedback", "Feedback Done"].map(o => <option key={o}>{o}</option>)}
        </select>
        <select className="select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
          {batches.map(b => <option key={b}>{b}</option>)}
        </select>
        <input className="input" placeholder="Search by student name..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center"><p style={{ color: "var(--text-secondary)" }}>No submissions found.</p></div>
      ) : (
        <>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>📊 {filtered.length} submissions</p>
          {filtered.map(r => {
            const hasFb = !!r.feedback
            const typeEmoji = (submissionTypes[r.id] || r.submission_type) === "project" ? "🚀" : "📝"
            const newType = submissionTypes[r.id] || r.submission_type || "assignment"
            const newPhase = submissionPhases[r.id] || r.phase || "Python"
            return (
              <Expander
                key={r.id}
                title={`${hasFb ? "✅" : "⏳"} ${r.student_name} • ${r.batch || "N/A"} • ${typeEmoji} ${r.topic} • ${formatDate(r.submitted_at)}`}
                badge={hasFb ? <span className="badge-done">REVIEWED</span> : <span className="badge-pending animate-pulse">PENDING</span>}
              >
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-3">
                  <span><b>Student:</b> {r.student_name}</span>
                  <span><b>Batch:</b> {r.batch || "N/A"}</span>
                  <span><b>Topic:</b> {r.topic}</span>
                  <span><b>Date:</b> {formatDate(r.submitted_at)}</span>
                </div>
                {r.comment && <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245,166,35,0.06)", color: "var(--text-secondary)" }}>💬 Student note: {r.comment}</p>}
                {r.file_url && r.file_name && (
                  <div className="flex gap-2 mb-3 flex-wrap items-center">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>📎 {r.file_name}</span>
                    {BROWSER_RENDERABLE.has(r.file_name.split(".").pop()?.toLowerCase()) && (
                      <a href={r.file_url} target="_blank" className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "var(--accent)", color: "#fff" }}>🔗 Open</a>
                    )}
                    <a href={`${r.file_url}?download=${r.file_name}`} target="_blank" className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "var(--primary)", color: "#1a1a1a" }}>⬇️ Download</a>
                  </div>
                )}

                {/* Type + Phase */}
                <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-xl" style={{ background: "rgba(245,166,35,0.05)", border: "1px solid var(--border)" }}>
                  <div>
                    <label className="label text-xs">📂 Submission Type</label>
                    <select className="select text-xs" value={newType} onChange={e => setSubmissionTypes(prev => ({ ...prev, [r.id]: e.target.value }))}>
                      <option value="assignment">📝 Assignment (+100 pts)</option>
                      <option value="project">🚀 Project (+200 pts)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">🎯 Phase</label>
                    <select className="select text-xs" value={newPhase} onChange={e => setSubmissionPhases(prev => ({ ...prev, [r.id]: e.target.value }))}>
                      {PHASE_OPTIONS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                {/* Code + Feedback */}
                {r.code_text ? (
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>📋 Pasted Code</p>
                        <CopyButton text={r.code_text} />
                      </div>
                      <pre className="code-block h-64">{r.code_text}</pre>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>✍️ Feedback</p>
                      <FeedbackEditor r={{ ...r, submission_type: newType, phase: newPhase }} newType={newType} newPhase={newPhase} teacherName={teacherName} onSaved={load} />
                    </div>
                  </div>
                ) : (
                  <div className="mb-4">
                    <FeedbackEditor r={{ ...r, submission_type: newType, phase: newPhase }} newType={newType} newPhase={newPhase} teacherName={teacherName} onSaved={load} />
                  </div>
                )}

                <div className="flex justify-end">
                  <button className="btn btn-secondary btn-sm" style={{ color: "var(--danger)" }} onClick={() => setConfirming(r.id)}>🗑️ Delete</button>
                </div>
                {confirming === r.id && (
                  <ConfirmDialog
                    message={`Delete submission by ${r.student_name}? Cannot be undone.`}
                    onConfirm={() => deleteSubmission(r)}
                    onCancel={() => setConfirming(null)}
                  />
                )}
              </Expander>
            )
          })}
        </>
      )}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
