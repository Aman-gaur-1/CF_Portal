"use client"
import { useState, useEffect, useCallback } from "react"
import StudentAuth from "@/components/student/StudentAuth"
import StudentView from "@/components/student/StudentView"
import Spinner from "@/components/ui/Spinner"

const SESSION_KEY = "cf_student"

function safeStudentProfile(student) {
  if (!student?.id || !student?.name || !student?.batch || !student?.token) return null
  return {
    id: student.id,
    name: student.name,
    batch: student.batch,
    token: typeof student.token === 'string' ? student.token : '',
  }
}

function accessTokenExpiry(token) {
  try {
    const encoded = String(token || '').split('.')[0]
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
    const expiresAt = Number(JSON.parse(atob(padded))?.exp)
    return Number.isFinite(expiresAt) ? expiresAt : 0
  } catch {
    return 0
  }
}

export default function HomePage() {
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshStudentSession = useCallback(async token => {
    try {
      const res = await fetch('/api/student-session', {
        method: 'POST',
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const profile = safeStudentProfile(data.student)
        if (profile) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(profile))
          setStudent(profile)
          return profile
        }
      } else if (res.status === 401) {
        localStorage.removeItem(SESSION_KEY)
        setStudent(null)
      }
    } catch {
      // Keep the last validated session during a temporary network failure.
    }
    return null
  }, [])

  useEffect(() => {
    let cancelled = false
    async function restoreSession() {
      let savedProfile = null
      try {
        const saved = localStorage.getItem(SESSION_KEY)
        if (saved) {
          savedProfile = safeStudentProfile(JSON.parse(saved))
        }
      } catch {
        localStorage.removeItem(SESSION_KEY)
      }
      try {
        const res = await fetch('/api/student-session', {
          method: 'POST',
          cache: 'no-store',
          headers: savedProfile?.token ? { Authorization: `Bearer ${savedProfile.token}` } : {},
        })
        const data = await res.json().catch(() => ({}))
        const profile = res.ok ? safeStudentProfile(data.student) : null
        if (cancelled) return
        if (profile) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(profile))
          setStudent(profile)
        } else {
          localStorage.removeItem(SESSION_KEY)
          setStudent(null)
        }
      } catch {
        if (!cancelled) setStudent(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    restoreSession()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!student?.token) return
    let cancelled = false

    async function refreshSession() {
      if (!cancelled) await refreshStudentSession(student.token)
    }

    const interval = window.setInterval(refreshSession, 60 * 60 * 1000)
    const expiresAt = accessTokenExpiry(student.token)
    const expiryTimer = expiresAt
      ? window.setTimeout(refreshSession, Math.max(expiresAt - Date.now() + 250, 0))
      : null
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') refreshSession()
    }
    function handleStorage(event) {
      if (event.key !== SESSION_KEY) return
      if (!event.newValue) {
        setStudent(null)
        return
      }
      try {
        const profile = safeStudentProfile(JSON.parse(event.newValue))
        if (profile && profile.token !== student.token) setStudent(profile)
      } catch {}
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleStorage)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      if (expiryTimer !== null) window.clearTimeout(expiryTimer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [student?.token, refreshStudentSession])

  function handleLogin(s) {
    const profile = safeStudentProfile(s)
    if (!profile) return
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile))
    setStudent(profile)
  }
  function handleLogout() {
    localStorage.removeItem(SESSION_KEY)
    setStudent(null)
    fetch('/api/student-session', { method: 'DELETE', keepalive: true }).catch(() => {})
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
      <Spinner size="lg" />
    </div>
  )

  if (!student) return <StudentAuth onLogin={handleLogin} />
  return <StudentView student={student} onLogout={handleLogout} onSessionRefresh={refreshStudentSession} />
}
