"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { formatDate } from "@/lib/utils"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"
import { isReviewedSubmission } from "@/lib/review-state"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import { ToastContainer, useToast } from "@/components/ui/Toast"
import { useRefreshAction } from "@/lib/use-refresh-action"

const SCOPE_REFRESH_MS = 5000

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

export default function StudentsTab({ teacherToken, globalSearch = "" }) {
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [batchFilter, setBatchFilter] = useState("All Batches")
  const [editingStudent, setEditingStudent] = useState(null)
  const [profileForm, setProfileForm] = useState({ name: "", password: "" })
  const [savingProfile, setSavingProfile] = useState(false)
  const loadAbortRef = useRef(null)
  const { toasts, success, error: showError } = useToast()
  useEffect(() => setSearch(globalSearch), [globalSearch])

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

  const refreshAction = useRefreshAction({
    onRefresh: () => load({ silent: true }),
    onSuccess: success,
    onError: showError,
  })

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
      if (isReviewedSubmission(sub)) map[sub.student_id] = (map[sub.student_id] || 0) + 1
    }
    return map
  }, [submissions])

  const allBatches = ["All Batches", ...batches.map(batch => batch.name)]
  const filtered = students.filter(student =>
    (batchFilter === "All Batches" || student.batch === batchFilter) &&
    (!search.trim() || student.name?.toLowerCase().includes(search.trim().toLowerCase()))
  )

  function openProfileEditor(student) {
    setEditingStudent(student)
    setProfileForm({ name: student.name || "", password: "" })
  }

  function closeProfileEditor() {
    setEditingStudent(null)
    setProfileForm({ name: "", password: "" })
  }

  async function saveStudentProfile() {
    if (!editingStudent?.id) return
    const name = profileForm.name.trim().replace(/\s+/g, " ")
    const password = profileForm.password.trim()
    if (!name) {
      showError("Student name is required.")
      return
    }
    if (password && password.length < 8) {
      showError("Password must be at least 8 characters.")
      return
    }

    setSavingProfile(true)
    try {
      const res = await fetch("/api/teacher-student-password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(teacherToken) },
        body: JSON.stringify({ studentId: editingStudent.id, name, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not update student profile.")
      if (data.student) {
        setStudents(prev => prev.map(student => String(student.id) === String(data.student.id) ? { ...student, ...data.student } : student))
      }
      success(password ? "Student profile and password updated." : "Student profile updated.")
      closeProfileEditor()
      load({ silent: true })
    } catch (err) {
      showError(err.message || "Could not update student profile.")
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{filtered.length} assigned students</p>
        <RefreshButton
          onClick={refreshAction.refresh}
          refreshing={refreshAction.refreshing}
          updatedLabel={refreshAction.updatedLabel}
          disabled={loading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <input className="input" placeholder="Search your assigned students..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
          {allBatches.map(batch => <option key={batch}>{batch}</option>)}
        </select>
      </div>

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
                <button className="btn btn-secondary btn-sm" onClick={() => openProfileEditor(student)}>
                  Edit Profile
                </button>
              </div>
            </div>
          </div>
        ))
      )}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.42)" }} role="dialog" aria-modal="true" aria-label="Edit student profile">
          <div className="card w-full max-w-md p-5">
            <div className="mb-4">
              <p className="font-semibold">Edit Student Profile</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{editingStudent.batch}</p>
            </div>
            <div className="grid gap-3">
              <div>
                <label className="label">Student Name</label>
                <input
                  className="input"
                  value={profileForm.name}
                  onChange={e => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">New Password</label>
                <input
                  type="password"
                  className="input"
                  value={profileForm.password}
                  onChange={e => setProfileForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Leave blank to keep current password"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2 flex-wrap">
              <button className="btn btn-secondary btn-sm" onClick={closeProfileEditor} disabled={savingProfile}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveStudentProfile} disabled={savingProfile}>
                {savingProfile ? <Spinner size="sm" /> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
