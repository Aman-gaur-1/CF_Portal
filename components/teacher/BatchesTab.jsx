"use client"
import { useState, useEffect } from "react"
import { formatDate } from "@/lib/utils"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import ConfirmDialog from "@/components/ui/ConfirmDialog"
import { useToast, ToastContainer } from "@/components/ui/Toast"

export default function BatchesTab({ teacherName }) {
  const [batches, setBatches] = useState([])
  const [students, setStudents] = useState([])
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [newBatch, setNewBatch] = useState("")
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [resetting, setResetting] = useState(false)
  const { toasts, success, error: showError } = useToast()

  async function load() {
    setLoading(true)
    const res = await fetch("/api/teacher/batches")
    const { batches: b = [], students: s = [], submissions: rows = [] } = await res.json().catch(() => ({}))
    setBatches(b); setStudents(s); setSubs(rows)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addBatch() {
    if (!newBatch.trim()) { showError("Batch name cannot be empty."); return }
    setAdding(true)
    const res = await fetch("/api/teacher/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newBatch }),
    })
    if (!res.ok) { showError("Failed to add batch.") }
    else { success(`Batch "${newBatch.trim()}" added!`); setNewBatch(""); load() }
    setAdding(false)
  }

  async function deleteBatch(b) {
    const res = await fetch("/api/teacher/batches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id }),
    })
    if (!res.ok) { showError("Delete failed.") } else { success("Batch deleted."); setConfirming(null); load() }
  }

  async function resetPassword(stuId, stuName) {
    if (!newPw.trim() || newPw.trim().length < 4) { showError("Password must be at least 4 chars."); return }
    if (newPw.trim() !== confirmPw.trim()) { showError("Passwords do not match."); return }
    setResetting(true)
    const res = await fetch("/api/teacher/batches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: stuId, password: newPw, confirmPassword: confirmPw }),
    })
    if (!res.ok) { showError("Reset failed.") } else { success(`Password reset for ${stuName}.`); setResetTarget(null); setNewPw(""); setConfirmPw("") }
    setResetting(false)
  }

  const stuByBatch = students.reduce((acc, s) => { acc[s.batch] = acc[s.batch] || []; acc[s.batch].push(s); return acc }, {})
  const subByStu = subs.reduce((acc, s) => { acc[s.student_id] = acc[s.student_id] || []; acc[s.student_id].push(s); return acc }, {})

  return (
    <div>
      {/* Add batch */}
      <div className="card p-5 mb-6">
        <div className="section-divider mb-4">
          <span>➕</span>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Add New Batch</span>
          <div className="line" />
        </div>
        <div className="flex gap-3">
          <input className="input flex-1" value={newBatch} onChange={e => setNewBatch(e.target.value)} placeholder="e.g. Python Batch April 2025" onKeyDown={e => e.key === "Enter" && addBatch()} />
          <button className="btn btn-primary flex items-center gap-2" onClick={addBatch} disabled={adding}>
            {adding ? <Spinner /> : "🗂️ Add"}
          </button>
        </div>
      </div>

      <div className="section-divider mb-4">
        <span>📂</span>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>All Batches</span>
        <div className="line" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : batches.length === 0 ? (
        <div className="card p-8 text-center"><p style={{ color: "var(--text-secondary)" }}>No batches yet. Add one above!</p></div>
      ) : (
        batches.map(b => {
          const batchStus = stuByBatch[b.name] || []
          const totalSubs = batchStus.reduce((a, s) => a + (subByStu[s.id] || []).length, 0)
          const totalPending = batchStus.reduce((a, s) => a + (subByStu[s.id] || []).filter(r => !r.feedback).length, 0)
          return (
            <Expander key={b.id} title={`📁 ${b.name} • ${batchStus.length} students • ${totalSubs} submissions`}>
              {/* Batch stats */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[[batchStus.length,"Students"],[totalSubs,"Submissions"],[totalPending,"Pending"],[totalSubs-totalPending,"Reviewed"]].map(([n,l]) => (
                  <div key={l} className="text-center p-3 rounded-xl" style={{ background: "rgba(245,166,35,0.06)", border: "1px solid var(--border)" }}>
                    <p className="text-xl font-black gradient-text">{n}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{l}</p>
                  </div>
                ))}
              </div>

              {batchStus.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No students registered in this batch yet.</p>
              ) : (
                batchStus.map(s => {
                  const stuSubs = subByStu[s.id] || []
                  const reviewed = stuSubs.filter(r => r.feedback).length
                  return (
                    <div key={s.id} className="card p-4 mb-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="font-semibold">👤 {s.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                            Joined: {formatDate(s.created_at)} &nbsp;•&nbsp; {stuSubs.length} assignments &nbsp;•&nbsp; {reviewed} reviewed
                          </p>
                        </div>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setResetTarget(resetTarget === s.id ? null : s.id)}
                        >🔑 Reset Password</button>
                      </div>

                      {stuSubs.length > 0 && (
                        <div className="mt-3">
                          {stuSubs.map(sub => {
                            const hasFb = !!sub.feedback
                            const typeEmoji = sub.submission_type === "project" ? "🚀" : "📝"
                            return (
                              <div key={sub.id} className="flex items-center justify-between px-3 py-2 mb-1 rounded-lg" style={{ background: "var(--bg-main)", border: "1px solid var(--border)" }}>
                                <span className="text-xs">{typeEmoji} {sub.topic}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{formatDate(sub.submitted_at)}</span>
                                  {hasFb ? <span className="badge-done">Reviewed</span> : <span className="badge-pending animate-pulse">Pending</span>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {resetTarget === s.id && (
                        <div className="mt-3 p-4 rounded-xl" style={{ background: "rgba(108,92,231,0.08)", border: "1px solid rgba(108,92,231,0.3)" }}>
                          <p className="text-xs font-semibold mb-3" style={{ color: "var(--accent-light)" }}>Set New Password</p>
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div><label className="label text-xs">New Password</label><input type="password" className="input text-sm" value={newPw} onChange={e => setNewPw(e.target.value)} /></div>
                            <div><label className="label text-xs">Confirm</label><input type="password" className="input text-sm" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} /></div>
                          </div>
                          <button className="btn btn-primary btn-sm flex items-center gap-2" onClick={() => resetPassword(s.id, s.name)} disabled={resetting}>
                            {resetting ? <Spinner /> : "💾 Save Password"}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}

              <div className="flex justify-end mt-3">
                <button className="btn btn-sm" style={{ background: "rgba(255,107,107,0.15)", color: "var(--danger)" }} onClick={() => setConfirming(b.id)}>🗑️ Delete Batch</button>
              </div>
              {confirming === b.id && (
                <ConfirmDialog
                  message={`Delete batch "${b.name}"? Students in this batch will NOT be deleted.`}
                  onConfirm={() => deleteBatch(b)}
                  onCancel={() => setConfirming(null)}
                />
              )}
            </Expander>
          )
        })
      )}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
