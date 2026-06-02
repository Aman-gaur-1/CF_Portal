"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { formatDate } from "@/lib/utils"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const SCOPE_REFRESH_MS = 5000

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

export default function StudentsTab({ teacherToken }) {
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [batchFilter, setBatchFilter] = useState("All Batches")
  const [resetStudentId, setResetStudentId] = useState(null)
  const [newPassword, setNewPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)
  const loadAbortRef = useRef(null)
  const { toasts, success, error: showError } = useToast()

  const load = useCallback(async ({ silent = false } = {}) => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    if (!silent) setLoading(true)
    try {
      const res = await fetch("/api/teacher-data?mode=summary", { headers: authHeaders(teacherToken), cache: "no-store", signal: controller.signal })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load students.")
      setStudents(data.students || [])
      setSubmissions(data.submissions || [])
      setBatches(data.batches || [])
    } catch (err) {
      if (err.name !== "AbortError") showError(err.message || "Could not load students.")
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
        if (!silent) setLoading(false)
      }
    }
  }, [teacherToken])

  useEffect(() => {
    load()
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort()
    }
  }, [load])

  useAdaptivePolling(
    () => load({ silent: true }),
    { enabled: Boolean(teacherToken), activeMs: SCOPE_REFRESH_MS }
  )

  const subMap = useMemo(() => {
    const map = {}
    for (const sub of submissions) map[sub.student_id] = (map[sub.student_id] || 0) + 1
    return map
  }, [submissions])

  const reviewedMap = useMemo(() => {
    const map = {}
    for (const sub of submissions) {
      if (sub.feedback) map[sub.student_id] = (map[sub.student_id] || 0) + 1
    }
    return map
  }, [submissions])

  const allBatches = ["All Batches", ...batches.map(batch => batch.name)]
  const filtered = students.filter(student =>
    (batchFilter === "All Batches" || student.batch === batchFilter) &&
    (!search.trim() || student.name?.toLowerCase().includes(search.trim().toLowerCase()))
  )

  function openPasswordReset(studentId) {
    setResetStudentId(studentId)
    setNewPassword("")
  }

  function closePasswordReset() {
    setResetStudentId(null)
    setNewPassword("")
  }

  async function changeStudentPassword(studentId) {
    if (newPassword.trim().length < 4) {
      showError("Password must be at least 4 characters.")
      return
    }

    setSavingPassword(true)
    try {
      const res = await fetch("/api/teacher-student-password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(teacherToken) },
        body: JSON.stringify({ studentId, password: newPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not change student password.")
      success("Student password changed.")
      closePasswordReset()
    } catch (err) {
      showError(err.message || "Could not change student password.")
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <input className="input" placeholder="Search your assigned students..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
          {allBatches.map(batch => <option key={batch}>{batch}</option>)}
        </select>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>{filtered.length} assigned students</p>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center"><p style={{ color: "var(--text-secondary)" }}>No assigned students found.</p></div>
      ) : (
        filtered.map(student => (
          <div key={student.id} className="card p-4 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-semibold">{student.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  Batch: {student.batch} - Joined: {formatDate(student.created_at)}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className="badge-pending">{subMap[student.id] || 0} submissions</span>
                <span className="badge-done">{reviewedMap[student.id] || 0} reviewed</span>
                <button className="btn btn-secondary btn-sm" onClick={() => openPasswordReset(student.id)}>
                  Change Password
                </button>
              </div>
            </div>
            {resetStudentId === student.id && (
              <div className="mt-4 flex gap-2 flex-wrap">
                <input
                  type="password"
                  className="input flex-1 min-w-[220px]"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" onClick={() => changeStudentPassword(student.id)} disabled={savingPassword}>
                  {savingPassword ? <Spinner /> : "Save Password"}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={closePasswordReset} disabled={savingPassword}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))
      )}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
