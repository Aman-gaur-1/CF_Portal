"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import BatchPicker from "@/components/student/BatchPicker"
import Spinner from "@/components/ui/Spinner"
import Tabs from "@/components/ui/Tabs"
import { useToast, ToastContainer } from "@/components/ui/Toast"

const TABS = [{ id: "login", label: "🔐 Login" }, { id: "register", label: "📝 Register" }]

export default function StudentAuth({ onLogin }) {
  const [tab, setTab] = useState("login")
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(false)
  const { toasts, success, error: showError } = useToast()

  const [loginId, setLoginId] = useState("")
  const [loginPass, setLoginPass] = useState("")
  const [legacyLogin, setLegacyLogin] = useState(false)
  const [legacyName, setLegacyName] = useState("")
  const [legacyBatch, setLegacyBatch] = useState("")

  const [regName, setRegName] = useState("")
  const [regBatch, setRegBatch] = useState("")
  const [regPass, setRegPass] = useState("")
  const [regConfirm, setRegConfirm] = useState("")

  useEffect(() => {
    supabase.from("batches").select("name").order("created_at").then(({ data }) => {
      if (data) {
        setBatches(data.map(b => b.name))
      }
    })
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (legacyLogin) {
      if (!legacyName.trim() || !legacyBatch || !loginPass.trim()) {
        showError("Student Name, Batch, and password are required.")
        return
      }
    } else if (!loginId.trim() || !loginPass.trim()) {
      showError("Login ID and password are required.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/student-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyLogin
          ? { name: legacyName, batch: legacyBatch, password: loginPass }
          : { loginId, password: loginPass }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success || !data.student) {
        showError(data.error || "Invalid Login ID or password.")
        return
      }
      success(`Welcome back, ${data.student.name}!`)
      setTimeout(() => onLogin({ ...data.student, legacyLogin: Boolean(data.student.legacyLogin) }), 800)
    } catch {
      showError("Student login is unavailable. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    if (!regName.trim()) { showError("Name is required."); return }
    if (!regBatch) { showError("Please select your batch."); return }
    if (!regPass.trim() || regPass.trim().length < 8) { showError("Password must be at least 8 characters."); return }
    if (regPass.trim() !== regConfirm.trim()) { showError("Passwords do not match."); return }
    setLoading(true)
    try {
      const res = await fetch("/api/student-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: regName, batch: regBatch, password: regPass }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        showError(data.error || "Registration failed. Please try again.")
        return
      }
      success("Registered! Please login.")
      setTab("login"); setRegName(""); setRegPass(""); setRegConfirm("")
    } catch {
      showError("Registration is unavailable. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-main)" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="https://img.icons8.com/color/96/python--v1.png" width="64" className="mx-auto mb-3" alt="logo" />
          <h1 className="text-3xl font-black gradient-text">ConsoleFlare</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>ASSIGNMENT PORTAL</p>
        </div>

        <div className="card p-6">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          {tab === "login" && !legacyLogin && (
            <div className="flex flex-col gap-4">
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div><label className="label">Login ID</label><input className="input" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="Enter your Login ID" autoComplete="username" /></div>
                <div><label className="label">Password</label><input type="password" className="input" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Enter password" autoComplete="current-password" /></div>
                <button type="submit" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-2" disabled={loading}>
                  {loading ? <Spinner /> : "Login"}
                </button>
              </form>
              <button
                type="button"
                className="text-sm underline underline-offset-4"
                style={{ color: "var(--text-secondary)" }}
                onClick={() => { setLegacyLogin(true); setLoginId(""); setLoginPass("") }}
              >
                Existing student? Login with Name &amp; Batch
              </button>
            </div>
          )}

          {tab === "login" && legacyLogin && (
            <div className="flex flex-col gap-4">
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div><label className="label">Student Name</label><input className="input" value={legacyName} onChange={e => setLegacyName(e.target.value)} placeholder="Enter your full name" autoComplete="name" /></div>
                <div>
                  <label className="label">Batch</label>
                  <BatchPicker value={legacyBatch} onChange={setLegacyBatch} batches={batches} label="Select your batch" />
                </div>
                <div><label className="label">Password</label><input type="password" className="input" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Enter password" autoComplete="current-password" /></div>
                <button type="submit" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-2" disabled={loading}>
                  {loading ? <Spinner /> : "Login"}
                </button>
              </form>
              <button
                type="button"
                className="text-sm underline underline-offset-4"
                style={{ color: "var(--text-secondary)" }}
                onClick={() => { setLegacyLogin(false); setLegacyName(""); setLegacyBatch(""); setLoginPass("") }}
              >
                Back to Login ID
              </button>
            </div>
          )}

          {tab === "register" && (
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <div><label className="label">Full Name</label><input className="input" value={regName} onChange={e => setRegName(e.target.value)} placeholder="Enter your full name" /></div>
              <div>
                <label className="label">Select Batch</label>
                <BatchPicker value={regBatch} onChange={setRegBatch} batches={batches} label="Select batch" />
              </div>
              <div><label className="label">Password (min 8 chars)</label><input type="password" className="input" value={regPass} onChange={e => setRegPass(e.target.value)} placeholder="Create a password" /></div>
              <div><label className="label">Confirm Password</label><input type="password" className="input" value={regConfirm} onChange={e => setRegConfirm(e.target.value)} placeholder="Confirm password" /></div>
              <button type="submit" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-2" disabled={loading}>
                {loading ? <Spinner /> : "🚀 Register"}
              </button>
            </form>
          )}
        </div>
      </div>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
