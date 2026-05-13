"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { hashPassword, formatDate } from "@/lib/utils"
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
  const [assignedTrainer, setAssignedTrainer] = useState(teacherName || "")
  const [trainerList, setTrainerList] = useState([])
  const [newTrainerName, setNewTrainerName] = useState("")
  const [renameTarget, setRenameTarget] = useState("")
  const [renameTrainerName, setRenameTrainerName] = useState("")
  const [deleteTarget, setDeleteTarget] = useState("")
  const [deleteConfirming, setDeleteConfirming] = useState(null)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [resetting, setResetting] = useState(false)
  const { toasts, success, error: showError } = useToast()

  function resolveTrainerName(loginName, trainerNames) {
    const loginKey = loginName.trim().toLowerCase()
    if (!loginKey) return loginName
    const exact = trainerNames.find(t => t.trim().toLowerCase() === loginKey)
    if (exact) return exact
    const prefix = trainerNames.find(t => t.trim().toLowerCase().startsWith(`${loginKey} `))
    if (prefix) return prefix
    const contains = trainerNames.find(t => t.trim().toLowerCase().includes(` ${loginKey}`))
    if (contains) return contains
    return loginName
  }

  async function load() {
    setLoading(true)
    const [{ data: b }, { data: s }, { data: subs }, { data: trainers }] = await Promise.all([
      supabase.from("batches").select("*").order("created_at"),
      supabase.from("students").select("*").order("created_at"),
      supabase.from("submissions").select("*").order("submitted_at", { ascending: false }),
      supabase.from("trainers").select("name").order("created_at")
    ])
    const rawNames = [...new Set([...(b || []).map(batch => batch.created_by), ...(trainers || []).map(t => t.name)].filter(Boolean))]
    const resolvedLoginName = resolveTrainerName(teacherName || "", rawNames)
    const trainerNames = [...new Set([resolvedLoginName, ...rawNames].filter(Boolean))]
    setTrainerList(trainerNames)
    setBatches(b || []); setStudents(s || []); setSubs(subs || [])
    if (trainerNames.length && !trainerNames.includes(assignedTrainer)) {
      setAssignedTrainer(resolvedLoginName)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addBatch() {
    if (!newBatch.trim()) { showError("Batch name cannot be empty."); return }
    if (!assignedTrainer.trim()) { showError("Trainer name cannot be empty."); return }
    setAdding(true)
    const { error } = await supabase.from("batches").insert({
      name: newBatch.trim(),
      created_by: assignedTrainer.trim(),
      created_at: new Date().toISOString()
    })
    if (error) { showError(error.message.includes("unique") || error.message.includes("duplicate") ? "Batch already exists." : "Failed to add batch.") }
    else { success(`Batch "${newBatch.trim()}" added!`); setNewBatch(""); load() }
    setAdding(false)
  }

  async function addTrainer() {
    const trainer = newTrainerName.trim()
    if (!trainer) { showError("Trainer name cannot be empty."); return }
    if (trainerList.includes(trainer)) { showError("Trainer already exists."); return }
    const { error } = await supabase.from("trainers").insert({
      name: trainer,
      created_by: teacherName
    })
    if (error) { showError("Failed to add trainer."); return }
    setTrainerList(prev => [...prev, trainer])
    setNewTrainerName("")
    setAssignedTrainer(trainer)
    success(`Trainer "${trainer}" added!`)
  }

  async function renameTrainer() {
    const from = renameTarget.trim()
    const to = renameTrainerName.trim()
    if (!from) { showError("Select a trainer to rename."); return }
    if (!to) { showError("New trainer name cannot be empty."); return }
    if (from === to) { showError("Choose a different name to rename."); return }
    if (trainerList.includes(to)) { showError("Trainer name already exists."); return }
    const { error: updateError } = await supabase.from("trainers").update({ name: to }).eq("name", from)
    if (updateError) { showError("Rename failed."); return }
    const { error: batchError } = await supabase.from("batches").update({ created_by: to }).eq("created_by", from)
    if (batchError) { showError("Rename failed in batches."); return }
    setTrainerList(prev => prev.map(item => item === from ? to : item))
    if (assignedTrainer === from) setAssignedTrainer(to)
    setRenameTrainerName("")
    setRenameTarget(to)
    success(`Trainer renamed from "${from}" to "${to}".`)
    load()
  }

  async function deleteTrainer(trainerNameToDelete) {
    const trainer = trainerNameToDelete?.trim() || deleteTarget.trim()
    if (!trainer) { showError("Select a trainer to delete."); return }
    if (trainer === teacherName) { showError("Cannot delete your own trainer name."); return }
    const { error: batchError } = await supabase.from("batches").update({ created_by: "" }).eq("created_by", trainer)
    if (batchError) { showError("Unassign failed."); return }
    const { error: trainerError } = await supabase.from("trainers").delete().eq("name", trainer)
    if (trainerError) { showError("Delete failed."); return }
    setTrainerList(prev => prev.filter(item => item !== trainer))
    if (assignedTrainer === trainer) setAssignedTrainer(teacherName || "")
    setDeleteTarget("")
    setDeleteConfirming(null)
    success(`Trainer "${trainer}" deleted and batches unassigned.`)
    load()
  }

  async function assignTrainer(batch, trainer) {
    const cleanTrainer = trainer.trim()
    if (!cleanTrainer) { showError("Trainer name cannot be empty."); return }
    const { error } = await supabase.from("batches").update({ created_by: cleanTrainer }).eq("id", batch.id)
    if (error) { showError("Trainer assignment failed.") } else { success(`Batch updated for ${cleanTrainer}.`); load() }
  }

  async function deleteBatch(b) {
    const { error } = await supabase.from("batches").delete().eq("id", b.id)
    if (error) { showError("Delete failed.") } else { success("Batch deleted."); setConfirming(null); load() }
  }

  async function resetPassword(stuId, stuName) {
    if (!newPw.trim() || newPw.trim().length < 4) { showError("Password must be at least 4 chars."); return }
    if (newPw.trim() !== confirmPw.trim()) { showError("Passwords do not match."); return }
    setResetting(true)
    const { error } = await supabase.from("students").update({ password_hash: await hashPassword(newPw) }).eq("id", stuId)
    if (error) { showError("Reset failed.") } else { success(`Password reset for ${stuName}.`); setResetTarget(null); setNewPw(""); setConfirmPw("") }
    setResetting(false)
  }

  const stuByBatch = students.reduce((acc, s) => { acc[s.batch] = acc[s.batch] || []; acc[s.batch].push(s); return acc }, {})
  const subByStu = subs.reduce((acc, s) => { acc[s.student_id] = acc[s.student_id] || []; acc[s.student_id].push(s); return acc }, {})
  const trainerOptions = [...new Set([...trainerList, ...batches.map(b => b.created_by)].filter(Boolean))]

  return (
    <div>
      <div className="grid gap-4 mb-6 lg:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "var(--text-muted)" }}>Current Trainer</p>
          <p className="text-2xl font-black">{teacherName || "Guest"}</p>
          <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>Use this trainer name to assign batches and manage trainer data.</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "var(--text-muted)" }}>Total Batches</p>
          <p className="text-3xl font-black">{batches.length}</p>
          <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>Batches currently stored in your portal.</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "var(--text-muted)" }}>Known Trainers</p>
          <p className="text-3xl font-black">{trainerOptions.length}</p>
          <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>Trainers available for batch assignment.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr] mb-6">
        <div className="card p-5">
          <div className="section-divider mb-5">
            <span>➕</span>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Add New Batch</span>
            <div className="line" />
          </div>
          <div className="grid gap-4">
            <div className="flex flex-col gap-2">
              <label className="label text-xs">Batch name</label>
              <input className="input" value={newBatch} onChange={e => setNewBatch(e.target.value)} placeholder="e.g. Python Batch April 2025" onKeyDown={e => e.key === "Enter" && addBatch()} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="label text-xs">Assign trainer</label>
              <select className="select" value={assignedTrainer} onChange={e => setAssignedTrainer(e.target.value)}>
                {trainerOptions.map(trainer => <option key={trainer} value={trainer}>{trainer}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-lg" onClick={addBatch} disabled={adding}>
              {adding ? <Spinner /> : "🗂️ Add Batch"}
            </button>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Batch assignment is saved immediately and will appear in the batch list below.</p>
          </div>
        </div>

        <div className="card p-5">
          <div className="section-divider mb-5">
            <span>👥</span>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Manage Trainers</span>
            <div className="line" />
          </div>
          <div className="grid gap-4">
            <div className="rounded-2xl p-4" style={{ background: "rgba(108,92,231,0.05)", border: "1px solid rgba(108,92,231,0.2)" }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-3" style={{ color: "var(--text-muted)" }}>Add Trainer</p>
              <div className="flex gap-2 flex-wrap">
                <input className="input flex-1" value={newTrainerName} onChange={e => setNewTrainerName(e.target.value)} placeholder="Enter trainer name" />
                <button className="btn btn-secondary btn-sm" onClick={addTrainer}>➕ Add</button>
              </div>
            </div>
            <div className="rounded-2xl p-4" style={{ background: "rgba(108,92,231,0.05)", border: "1px solid rgba(108,92,231,0.2)" }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-3" style={{ color: "var(--text-muted)" }}>Rename Trainer</p>
              <div className="grid gap-3">
                <select className="select" value={renameTarget} onChange={e => setRenameTarget(e.target.value)}>
                  <option value="">Select trainer</option>
                  {trainerOptions.map(trainer => <option key={trainer} value={trainer}>{trainer}</option>)}
                </select>
                <div className="flex gap-2 flex-wrap">
                  <input className="input flex-1" value={renameTrainerName} onChange={e => setRenameTrainerName(e.target.value)} placeholder="New name" />
                  <button className="btn btn-secondary btn-sm" onClick={renameTrainer}>✏️ Rename</button>
                </div>
              </div>
            </div>
            <div className="rounded-2xl p-4" style={{ background: "rgba(255,107,107,0.05)", border: "1px solid rgba(255,107,107,0.2)" }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-3" style={{ color: "var(--danger)" }}>Delete Trainer</p>
              <div className="flex gap-2 flex-wrap">
                <select className="select flex-1" value={deleteTarget} onChange={e => setDeleteTarget(e.target.value)}>
                  <option value="">Select trainer to delete</option>
                  {trainerOptions.map(trainer => (
                    <option key={trainer} value={trainer} disabled={trainer === teacherName}>
                      {trainer === teacherName ? `${trainer} (you)` : trainer}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setDeleteConfirming(deleteTarget)}
                  disabled={!deleteTarget || deleteTarget === teacherName}
                >🗑️ Delete</button>
              </div>
              <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Deleting a trainer will unassign their batches but keep login access unchanged.</p>
            </div>
          </div>
        </div>
      </div>

      {deleteConfirming && (
        <ConfirmDialog
          message={`Delete trainer "${deleteConfirming}"? This will unassign this trainer from all their batches.`}
          onConfirm={() => deleteTrainer(deleteConfirming)}
          onCancel={() => setDeleteConfirming(null)}
        />
      )}

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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {[[batchStus.length,"Students"],[totalSubs,"Submissions"],[totalPending,"Pending"],[totalSubs-totalPending,"Reviewed"]].map(([n,l]) => (
                  <div key={l} className="text-center p-3 rounded-xl" style={{ background: "rgba(245,166,35,0.06)", border: "1px solid var(--border)" }}>
                    <p className="text-xl font-black gradient-text">{n}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{l}</p>
                  </div>
                ))}
              </div>

              <div className="mb-4 p-4 rounded-xl" style={{ background: "rgba(108,92,231,0.08)", border: "1px solid rgba(108,92,231,0.3)" }}>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--accent-light)" }}>Assigned Trainer</p>
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <select className="select flex-1" value={b.created_by || ""} onChange={e => assignTrainer(b, e.target.value)}>
                    {trainerOptions.map(trainer => <option key={trainer} value={trainer}>{trainer}</option>)}
                  </select>
                  <button className="btn btn-secondary btn-sm" onClick={() => assignTrainer(b, teacherName)}>
                    Assign to me
                  </button>
                </div>
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