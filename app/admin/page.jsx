"use client"
import { useEffect, useState } from "react"
import AdminDashboard from "@/components/admin/AdminDashboard"
import Spinner from "@/components/ui/Spinner"

const SESSION_KEY = "cf_admin"

export default function AdminPage() {
  const [admin, setAdmin] = useState(null)
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [logging, setLogging] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed?.token) setAdmin(parsed)
        else localStorage.removeItem(SESSION_KEY)
      }
    } catch {}
    setLoading(false)
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError("")
    setLogging(true)

    try {
      const res = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError("Invalid admin username or password.")
        return
      }
      const nextAdmin = { name: data.name, role: data.role || "admin", token: data.token }
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextAdmin))
      setAdmin(nextAdmin)
    } catch {
      setError("Admin login failed. Please try again.")
    } finally {
      setLogging(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY)
    setAdmin(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
        <Spinner size="lg" />
      </div>
    )
  }

  if (!admin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-main)" }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl font-black"
              style={{ background: "linear-gradient(135deg,var(--primary),var(--accent))", color: "#fff" }}>
              CF
            </div>
            <h1 className="text-3xl font-black gradient-text">Admin Portal</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>CONSOLEFLARE CONTROL CENTER</p>
          </div>

          <div className="card p-6">
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div>
                <label className="label">Admin username</label>
                <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter admin username" />
              </div>
              <div>
                <label className="label">Password</label>
                <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" />
              </div>
              {error && <p className="text-xs font-medium" style={{ color: "var(--danger)" }}>{error}</p>}
              <button type="submit" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1" disabled={logging}>
                {logging ? <Spinner /> : "Login"}
              </button>
            </form>
          </div>

          <div className="text-center mt-4 flex justify-center gap-4">
            <a href="/" className="text-xs" style={{ color: "var(--text-muted)" }}>Student</a>
            <a href="/teacher" className="text-xs" style={{ color: "var(--text-muted)" }}>Teacher</a>
          </div>
        </div>
      </div>
    )
  }

  return <AdminDashboard adminName={admin.name} adminToken={admin.token} onLogout={handleLogout} />
}
