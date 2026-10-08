"use client"
import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 Days" },
]

export default function ReviewProgressByTeacher({ adminToken }) {
  const [period, setPeriod] = useState("today")
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()

    async function loadProgress() {
      setLoading(true)
      setError("")
      try {
        const timezoneOffset = new Date().getTimezoneOffset()
        const res = await fetch(`/api/admin-review-progress?period=${period}&timezoneOffset=${timezoneOffset}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Could not load review progress.")
        setTeachers(data.teachers || [])
      } catch (err) {
        if (err.name !== "AbortError") setError(err.message || "Could not load review progress.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadProgress()
    return () => controller.abort()
  }, [adminToken, period])

  return (
    <div className="card admin-panel">
      <div className="review-progress-header">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Review Progress by Teacher</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Assigned submissions and published reviews</p>
        </div>
        <div className="review-period-filter" aria-label="Review progress period">
          {PERIODS.map(option => (
            <button
              key={option.id}
              className={`review-period-btn ${period === option.id ? "active" : ""}`}
              onClick={() => setPeriod(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : error ? (
        <p className="text-sm py-4" style={{ color: "var(--danger)" }}>{error}</p>
      ) : teachers.length === 0 ? (
        <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No teachers found.</p>
      ) : (
        <div className="review-progress-list">
          {teachers.map(teacher => (
            <div className="review-progress-row" key={teacher.name}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold truncate">{teacher.name}</p>
                <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {teacher.reviewed}/{teacher.received} · {teacher.progress}%
                </span>
              </div>
              <div className="progress-bar-wrap" aria-label={`${teacher.name}: ${teacher.progress}% reviewed`}>
                <div className="progress-bar-fill" style={{ width: `${teacher.progress}%` }} />
              </div>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {teacher.reviewed}/{teacher.received} reviewed <span style={{ color: "var(--text-muted)" }}>•</span> {teacher.pending} pending
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
