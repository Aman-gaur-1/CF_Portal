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
    try { const s = localStorage.getItem(SESSION_KEY); if (s) setStudent(JSON.parse(s)) } catch {}
    setLoading(false)
  }, [])

  function handleLogin(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); setStudent(s) }
  function handleLogout() { localStorage.removeItem(SESSION_KEY); setStudent(null) }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
      <Spinner size="lg" />
    </div>
  )

  if (!student) return <StudentAuth onLogin={handleLogin} />
  return <StudentView student={student} onLogout={handleLogout} />
}