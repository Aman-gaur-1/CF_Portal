"use client"
import { useState, useEffect } from "react"
import StudentAuth from "@/components/student/StudentAuth"
import StudentView from "@/components/student/StudentView"
import Spinner from "@/components/ui/Spinner"

const SESSION_KEY = "cf_student"

function safeStudentProfile(student) {
  if (!student?.id || !student?.name || !student?.batch) return null
  return { id: student.id, name: student.name, batch: student.batch }
}

export default function HomePage() {
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (saved) {
        const profile = safeStudentProfile(JSON.parse(saved))
        if (profile) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(profile))
          setStudent(profile)
        } else {
          localStorage.removeItem(SESSION_KEY)
        }
      }
    } catch {
      localStorage.removeItem(SESSION_KEY)
    }
    setLoading(false)
  }, [])

  function handleLogin(s) {
    const profile = safeStudentProfile(s)
    if (!profile) return
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile))
    setStudent(profile)
  }
  function handleLogout() { localStorage.removeItem(SESSION_KEY); setStudent(null) }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
      <Spinner size="lg" />
    </div>
  )

  if (!student) return <StudentAuth onLogin={handleLogin} />
  return <StudentView student={student} onLogout={handleLogout} />
}
