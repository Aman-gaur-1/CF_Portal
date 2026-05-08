"use client"
import { useState, useEffect } from "react"
import { formatDate } from "@/lib/utils"
import Spinner from "@/components/ui/Spinner"
import ConfirmDialog from "@/components/ui/ConfirmDialog"
import { useToast, ToastContainer } from "@/components/ui/Toast"

export default function StudentsTab() {
  const [students, setStudents] = useState([])
  const [subMap, setSubMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [batchFilter, setBatchFilter] = useState("All Batches")
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [batches, setBatches] = useState([])
  const [editName, setEditName] = useState("")
  const [editBatch, setEditBatch] = useState("")
  const [editPass, setEditPass] = useState("")
  const [saving, setSaving] = useState(false)
  const { toasts, success, error: showError } = useToast()

  async function load() {
    setLoading(true)
    const res = await fetch("/api/teacher/students")
    const { students: stus = [], submissions: subs = [], batches: batchData = [] } = await res.json().catch(() => ({}))
    setStudents(stus)
    setBatches(batchData.map(b => b.name))
    const map = {}
    for (const s of subs || []) map[s.student_id] = (map[s.student_id] || 0) + 1
    setSubMap(map)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function startEdit(s) {
    setEditing(s.id); setEditName(s.name); setEditBatch(s.batch); setEditPass("")
  }

  async function saveEdit(s) {
    if (!editName.trim()) { showError("Name cannot be empty."); return }
    if (editPass.trim() && editPass.trim().length < 4) { showError("Password must be at least 4 chars."); return }
    setSaving(true)
    const res = await fetch("/api/teacher/students", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, name: editName, batch: editBatch, password: editPass }),
    })
    if (!res.ok) { showError("Update failed.") } else { success("Student updated!"); setEditing(null); load() }
    setSaving(false)
  }

  async function deleteStudent(id) {
    const res = await fetch("/api/teacher/students", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) { showError("Delete failed.") } else { success("Deleted."); setConfirming(null); load() }
  }

  const allBatches = ["All Batches", ...new Set(students.map(s => s.batch))]
  const filtered = students.filter(s =>
    (batchFilter === "All Batches" || s.batch === batchFilter) &&
    (!search.trim() || s.name.toLowerCase().includes(search.trim().toLowerCase()))
  )

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <input className="input" placeholder="Search by name..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
          {allBatches.map(b => <option key={b}>{b}</option>)}
        </select>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>📊 {filtered.length} students found</p>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center"><p style={{ color: "var(--text-secondary)" }}>No students found.</p></div>
      ) : (
        filtered.map(s => (
          <div key={s.id} className="card p-4 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  Batch: {s.batch} &nbsp;•&nbsp; Joined: {formatDate(s.created_at)} &nbsp;•&nbsp; Assignments: <span style={{ color: "var(--primary)" }}>{subMap[s.id] || 0}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => editing === s.id ? setEditing(null) : startEdit(s)}>✏️ Edit</button>
                <button className="btn btn-sm" style={{ background: "rgba(255,107,107,0.15)", color: "var(--danger)" }} onClick={() => setConfirming(s.id)}>🗑️</button>
              </div>
            </div>

            {editing === s.id && (
              <div className="mt-3 p-4 rounded-xl" style={{ background: "rgba(245,166,35,0.05)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold mb-3" style={{ color: "var(--text-muted)" }}>Edit Profile</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div><label className="label text-xs">Name</label><input className="input text-sm" value={editName} onChange={e => setEditName(e.target.value)} /></div>
                  <div>
                    <label className="label text-xs">Batch</label>
                    <select className="select text-sm" value={editBatch} onChange={e => setEditBatch(e.target.value)}>
                      {batches.map(b => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                  <div><label className="label text-xs">New Password (blank = keep)</label><input type="password" className="input text-sm" value={editPass} onChange={e => setEditPass(e.target.value)} placeholder="Leave blank to keep" /></div>
                </div>
                <button className="btn btn-primary btn-sm flex items-center gap-2" onClick={() => saveEdit(s)} disabled={saving}>
                  {saving ? <Spinner /> : "💾 Save"}
                </button>
              </div>
            )}

            {confirming === s.id && (
              <ConfirmDialog
                message={`Delete "${s.name}"? Their submissions will NOT be deleted.`}
                onConfirm={() => deleteStudent(s.id)}
                onCancel={() => setConfirming(null)}
              />
            )}
          </div>
        ))
      )}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
