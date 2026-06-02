"use client"
import { useState, useEffect } from "react"
import TeacherDashboard from "@/components/teacher/TeacherDashboard"
import Spinner from "@/components/ui/Spinner"

const SESSION_KEY = "cf_teacher"

export default function TeacherPage() {
  const [teacher, setTeacher] = useState(null)
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [logging, setLogging] = useState(false)

  useEffect(() => {
    try {
      const s = localStorage.getItem(SESSION_KEY)
      if (s) {
        const saved = JSON.parse(s)
        if (saved?.token) setTeacher(saved)
        else localStorage.removeItem(SESSION_KEY)
      }
    } catch {}
    setLoading(false)
  }, [])

  async function handleLogin(e) {
    e.preventDefault(); setError(""); setLogging(true)
    const res = await fetch("/api/teacher-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })
    const data = await res.json()
    if (data.success) { const t = { name: data.name, token: data.token }; localStorage.setItem(SESSION_KEY, JSON.stringify(t)); setTeacher(t) }
    else setError("Invalid username or password.")
    setLogging(false)
  }

  function handleLogout() { localStorage.removeItem(SESSION_KEY); setTeacher(null) }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
      <Spinner size="lg" />
    </div>
  )

  if (!teacher) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-main)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="https://img.icons8.com/color/96/python--v1.png" width="64" className="mx-auto mb-3" alt="logo" />
          <h1 className="text-3xl font-black gradient-text">Trainer Login</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>CONSOLEFLARE PORTAL</p>
        </div>
        <div className="card p-6">
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div><label className="label">Username</label><input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" /></div>
            <div><label className="label">Password</label><input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" /></div>
            {error && <p className="text-xs font-medium" style={{ color: "var(--danger)" }}>❌ {error}</p>}
            <button type="submit" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1" disabled={logging}>
              {logging ? <Spinner /> : "🔓 Login"}
            </button>
          </form>
        </div>
        <div className="text-center mt-4"><a href="/" className="text-xs" style={{ color: "var(--text-muted)" }}>← Student Portal</a></div>
      </div>
    </div>
  )

  return <TeacherDashboard teacherName={teacher.name} teacherToken={teacher.token} onLogout={handleLogout} />
}
