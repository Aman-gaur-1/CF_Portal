"use client"
import { useState, useEffect } from "react"
import StudentAuth from "@/components/student/StudentAuth"
import StudentView from "@/components/student/StudentView"
import Spinner from "@/components/ui/Spinner"

const SESSION_KEY = "cf_student"

export default function HomePage() {
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/student-session")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.student) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(data.student))
          setStudent(data.student)
        } else {
          localStorage.removeItem(SESSION_KEY)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  function handleLogin(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); setStudent(s) }
  function handleLogout() {
    fetch("/api/student-session", { method: "DELETE" }).catch(() => {})
    localStorage.removeItem(SESSION_KEY); setStudent(null)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
      <Spinner size="lg" />
    </div>
  )

  if (!student) return <StudentAuth onLogin={handleLogin} />
  return <StudentView student={student} onLogout={handleLogout} />
}
