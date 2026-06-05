"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import { formatDate } from "@/lib/utils"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"
import { isReviewedSubmission } from "@/lib/review-state"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const SCOPE_REFRESH_MS = 5000

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

export default function BatchesTab({ teacherName, teacherToken }) {
  const [batches, setBatches] = useState([])
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const loadAbortRef = useRef(null)
  const { toasts, error: showError } = useToast()

  const load = useCallback(async ({ silent = false } = {}) => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    if (!silent) setLoading(true)
    try {
      const res = await fetch("/api/teacher-data?mode=summary", { headers: authHeaders(teacherToken), cache: "no-store", signal: controller.signal })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load batches.")
      setBatches(data.batches || [])
      setStudents(data.students || [])
      setSubmissions(data.submissions || [])
    } catch (err) {
      if (err.name !== "AbortError") showError(err.message || "Could not load batches.")
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

  const stuByBatch = useMemo(() => {
    return students.reduce((acc, student) => {
      acc[student.batch] = acc[student.batch] || []
      acc[student.batch].push(student)
      return acc
    }, {})
  }, [students])

  const subByStudent = useMemo(() => {
    return submissions.reduce((acc, submission) => {
      acc[submission.student_id] = acc[submission.student_id] || []
      acc[submission.student_id].push(submission)
      return acc
    }, {})
  }, [submissions])

  return (
    <div>
      <div className="grid gap-4 mb-6 lg:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "var(--text-muted)" }}>Teacher</p>
          <p className="text-2xl font-black">{teacherName || "Trainer"}</p>
          <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>Your workspace is scoped to assigned batches only.</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "var(--text-muted)" }}>My Batches</p>
          <p className="text-3xl font-black">{batches.length}</p>
          <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>Assigned by admin.</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-[0.4em] mb-3" style={{ color: "var(--text-muted)" }}>My Students</p>
          <p className="text-3xl font-black">{students.length}</p>
          <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>Across assigned batches.</p>
        </div>
      </div>

      <div className="section-divider mb-4">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Assigned Batch Analytics</span>
        <div className="line" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : batches.length === 0 ? (
        <div className="card p-8 text-center">
          <p style={{ color: "var(--text-secondary)" }}>No batches are assigned to this teacher yet. Admin can assign batches from the admin portal.</p>
        </div>
      ) : (
        batches.map(batch => {
          const batchStudents = stuByBatch[batch.name] || []
          const batchSubmissions = batchStudents.flatMap(student => subByStudent[student.id] || [])
          const pending = batchSubmissions.filter(submission => !isReviewedSubmission(submission)).length
          const reviewed = batchSubmissions.length - pending

          return (
            <Expander key={batch.id} title={`${batch.name} - ${batchStudents.length} students - ${batchSubmissions.length} submissions`}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {[[batchStudents.length, "Students"], [batchSubmissions.length, "Submissions"], [pending, "To Review"], [reviewed, "Published"]].map(([n, label]) => (
                  <div key={label} className="text-center p-3 rounded-xl" style={{ background: "rgba(245,166,35,0.06)", border: "1px solid var(--border)" }}>
                    <p className="text-xl font-black gradient-text">{n}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
                  </div>
                ))}
              </div>

              {batchStudents.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No students registered in this batch yet.</p>
              ) : (
                batchStudents.map(student => {
                  const studentSubmissions = subByStudent[student.id] || []
                  const studentReviewed = studentSubmissions.filter(isReviewedSubmission).length
                  return (
                    <div key={student.id} className="card p-4 mb-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="font-semibold">{student.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                            Joined: {formatDate(student.created_at)} - {studentSubmissions.length} submissions - {studentReviewed} reviewed
                          </p>
                        </div>
                        {studentSubmissions.length > studentReviewed ? <span className="badge-pending">Needs review</span> : <span className="badge-done">Clear</span>}
                      </div>
                    </div>
                  )
                })
              )}
            </Expander>
          )
        })
      )}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
