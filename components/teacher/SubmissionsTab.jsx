"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { getPoints, BROWSER_RENDERABLE, formatDate, getTypeLabel, getTypeEmoji } from "@/lib/utils"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import ConfirmDialog from "@/components/ui/ConfirmDialog"
import { useToast, ToastContainer } from "@/components/ui/Toast"

const POINT_OPTIONS = [
  { value: "100", label: "📝 Assignment (+100 pts)" },
  { value: "200", label: "🚀 Project (+200 pts)" },
  { value: "50", label: "✨ Small Task (+50 pts)" },
  { value: "20", label: "⚡ Micro Task (+20 pts)" },
  { value: "custom", label: "🔧 Manual points" },
]
const DEFAULT_PHASE_OPTIONS = ["Python", "Data Analytics"]

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

function FeedbackEditor({ r, newType, newPhase, customPoints, teacherName, onSaved }) {
  const [editing, setEditing] = useState(!r.feedback)
  const [fb, setFb] = useState(r.feedback || "")
  const [saving, setSaving] = useState(false)
  const customValue = customPoints || ""
  const customInvalid = newType === "custom" && (!customValue || !/^[0-9]+$/.test(customValue) || Number(customValue) <= 0)

  async function save() {
    if (!fb.trim() || customInvalid) return
    setSaving(true)
    const finalType = newType === "custom" ? customValue : newType
    await supabase.from("submissions").update({
      feedback: fb.trim(), feedback_by: teacherName,
      feedback_at: new Date().toISOString(),
      submission_type: finalType, phase: newPhase
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
      {customInvalid && <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>Enter a valid custom point value.</p>}
      <button className="btn btn-primary w-full flex items-center justify-center gap-2" onClick={save} disabled={saving || !fb.trim() || customInvalid}>
        {saving ? <Spinner /> : "💾 Save Feedback"}
      </button>
    </div>
  )
}

export default function SubmissionsTab({ teacherName }) {
  const [data, setData] = useState([])
  const [batchList, setBatchList] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("All")
  const [batchFilter, setBatchFilter] = useState("All Batches")
  const [trainerFilter, setTrainerFilter] = useState("All Trainers")
  const [search, setSearch] = useState("")
  const [confirming, setConfirming] = useState(null)
  const [submissionTypes, setSubmissionTypes] = useState({})
  const [submissionPhases, setSubmissionPhases] = useState({})
  const [submissionCustomPoints, setSubmissionCustomPoints] = useState({})
  const [phaseOptions, setPhaseOptions] = useState(DEFAULT_PHASE_OPTIONS)
  const [newPhase, setNewPhase] = useState("")
  const { toasts, success, error: showError } = useToast()

  async function load(initialPhaseOptions = phaseOptions) {
    setLoading(true)
    const [{ data: rows }, { data: batches }] = await Promise.all([
      supabase.from("submissions").select("*").order("submitted_at", { ascending: false }),
      supabase.from("batches").select("name,created_by")
    ])
    setData(rows || [])
    setBatchList(batches || [])
    const types = {}, phases = {}, customPoints = {}
    const allPhases = new Set(initialPhaseOptions)

    for (const r of rows || []) {
      const rawType = r.submission_type || "assignment"
      if (rawType === "assignment") {
        types[r.id] = "100"
      } else if (rawType === "project") {
        types[r.id] = "200"
      } else if (/^[0-9]+$/.test(rawType) && !["100", "200", "50", "20"].includes(rawType)) {
        types[r.id] = "custom"
        customPoints[r.id] = rawType
      } else {
        types[r.id] = rawType
      }
      phases[r.id] = r.phase || "Python"
      allPhases.add(r.phase || "Python")
    }

    setSubmissionTypes(types)
    setSubmissionCustomPoints(customPoints)
    setSubmissionPhases(phases)
    setPhaseOptions(Array.from(allPhases))
    setLoading(false)
  }

  useEffect(() => {
    let initialPhases = DEFAULT_PHASE_OPTIONS
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("cf_phase_options")
      if (saved) {
        try { initialPhases = JSON.parse(saved) } catch (e) {}
      }
    }
    setPhaseOptions(initialPhases)
    load(initialPhases)
  }, [])

  function savePhaseOptions(options) {
    setPhaseOptions(options)
    if (typeof window !== "undefined") {
      window.localStorage.setItem("cf_phase_options", JSON.stringify(options))
    }
  }

  function addPhase() {
    const phase = newPhase.trim()
    if (!phase) { showError("Phase name cannot be empty."); return }
    if (phaseOptions.includes(phase)) { showError("Phase already exists."); return }
    const next = [...phaseOptions, phase]
    savePhaseOptions(next)
    setNewPhase("")
    success(`Phase "${phase}" added!`)
  }

  async function deleteSubmission(r) {
    if (r.file_name) await supabase.storage.from("assignments").remove([r.file_name]).catch(() => {})
    const { error } = await supabase.from("submissions").delete().eq("id", r.id)
    if (error) { showError("Delete failed."); return }
    success("Deleted."); setConfirming(null); load()
  }

  const trainerMap = Object.fromEntries((batchList || []).map(b => [b.name, b.created_by || "Unassigned"]))
  const trainerOptions = ["All Trainers", ...new Set(batchList.map(b => b.created_by || "Unassigned"))]
  const batches = ["All Batches", ...new Set(data.map(d => d.batch).filter(Boolean))]

  let filtered = data
  if (statusFilter === "Pending Feedback") filtered = filtered.filter(d => !d.feedback)
  if (statusFilter === "Feedback Done") filtered = filtered.filter(d => !!d.feedback)
  if (batchFilter !== "All Batches") filtered = filtered.filter(d => d.batch === batchFilter)
  if (trainerFilter !== "All Trainers") filtered = filtered.filter(d => trainerMap[d.batch] === trainerFilter)
  if (search.trim()) filtered = filtered.filter(d => d.student_name?.toLowerCase().includes(search.trim().toLowerCase()))

  const pending = data.filter(d => !d.feedback).length

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[[data.length, "Total"], [pending, "Pending"], [data.length - pending, "Reviewed"]].map(([n, l]) => (
          <div key={l} className="stat-card"><div className="stat-num">{n}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 mb-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <input className="input flex-1" placeholder="Add new phase" value={newPhase} onChange={e => setNewPhase(e.target.value)} />
          <button className="btn btn-primary btn-sm" onClick={addPhase}>➕ Add Phase</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>New phases are stored for this trainer session and will appear in the phase dropdown immediately.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          { ["All", "Pending Feedback", "Feedback Done"].map(o => <option key={o}>{o}</option>) }
        </select>
        <select className="select" value={trainerFilter} onChange={e => setTrainerFilter(e.target.value)}>
          { trainerOptions.map(t => <option key={t}>{t}</option>) }
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
            const rawType = submissionTypes[r.id] || r.submission_type || "assignment"
            const normalizedRawType = rawType === "assignment" ? "100" : rawType === "project" ? "200" : rawType
            const newType = /^[0-9]+$/.test(normalizedRawType) && !["100", "200", "50", "20"].includes(normalizedRawType) ? "custom" : normalizedRawType
            const customValue = submissionCustomPoints[r.id] || ""
            const typeEmoji = getTypeEmoji(rawType)
            const displayType = getTypeLabel(rawType)
            const pointsValue = newType === "custom" ? Number(customValue) || 0 : getPoints(rawType)
            const newPhase = submissionPhases[r.id] || r.phase || "Python"
            return (
              <Expander
                key={r.id}
                title={`${hasFb ? "✅" : "⏳"} ${r.student_name} • ${r.batch || "N/A"} • ${typeEmoji} ${displayType} • +${pointsValue}pts`}
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
                    <label className="label text-xs">📂 Points</label>
                    <select
                      className="select text-xs"
                      value={newType}
                      onChange={e => {
                        const selected = e.target.value
                        setSubmissionTypes(prev => ({ ...prev, [r.id]: selected }))
                        if (selected !== "custom") {
                          setSubmissionCustomPoints(prev => ({ ...prev, [r.id]: "" }))
                        }
                      }}
                    >
                      {POINT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    {newType === "custom" && (
                      <input
                        type="number"
                        min="1"
                        className="input text-xs mt-2"
                        placeholder="Enter custom points"
                        value={customValue}
                        onChange={e => setSubmissionCustomPoints(prev => ({ ...prev, [r.id]: e.target.value }))}
                      />
                    )}
                  </div>
                  <div>
                    <label className="label text-xs">🎯 Phase</label>
                    <select className="select text-xs" value={newPhase} onChange={e => setSubmissionPhases(prev => ({ ...prev, [r.id]: e.target.value }))}>
                      {phaseOptions.map(p => <option key={p}>{p}</option>)}
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
                      <FeedbackEditor r={{ ...r, submission_type: newType, phase: newPhase }} newType={newType} newPhase={newPhase} customPoints={customValue} teacherName={teacherName} onSaved={load} />
                    </div>
                  </div>
                ) : (
                  <div className="mb-4">
                    <FeedbackEditor r={{ ...r, submission_type: newType, phase: newPhase }} newType={newType} newPhase={newPhase} customPoints={customValue} teacherName={teacherName} onSaved={load} />
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
