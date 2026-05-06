"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { hashPassword } from "@/lib/utils"
import Spinner from "@/components/ui/Spinner"
import Tabs from "@/components/ui/Tabs"
import { useToast, ToastContainer } from "@/components/ui/Toast"

const TABS = [{ id: "login", label: "🔐 Login" }, { id: "register", label: "📝 Register" }]

export default function StudentAuth({ onLogin }) {
  const [tab, setTab] = useState("login")
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(false)
  const { toasts, success, error: showError } = useToast()

  const [loginName, setLoginName] = useState("")
  const [loginBatch, setLoginBatch] = useState("")
  const [loginPass, setLoginPass] = useState("")

  const [regName, setRegName] = useState("")
  const [regBatch, setRegBatch] = useState("")
  const [regPass, setRegPass] = useState("")
  const [regConfirm, setRegConfirm] = useState("")

  useEffect(() => {
    supabase.from("batches").select("name").order("created_at").then(({ data }) => {
      if (data) { setBatches(data.map(b => b.name)); setLoginBatch(data[0]?.name || ""); setRegBatch(data[0]?.name || "") }
    })
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (!loginName.trim() || !loginPass.trim()) { showError("Name and password are required."); return }
    setLoading(true)
    const hash = await hashPassword(loginPass)
    const { data } = await supabase.from("students").select("*").ilike("name", loginName.trim()).eq("batch", loginBatch).eq("password_hash", hash)
    if (data && data.length > 0) {
      success(`Welcome back, ${data[0].name}! 🎉`)
      setTimeout(() => onLogin(data[0]), 800)
    } else {
      showError("Invalid name, batch, or password.")
    }
    setLoading(false)
  }

  async function handleRegister(e) {
    e.preventDefault()
    if (!regName.trim()) { showError("Name is required."); return }
    if (!regPass.trim() || regPass.trim().length < 4) { showError("Password must be at least 4 characters."); return }
    if (regPass.trim() !== regConfirm.trim()) { showError("Passwords do not match."); return }
    setLoading(true)
    const hash = await hashPassword(regPass)
    const { error: err } = await supabase.from("students").insert({ name: regName.trim(), batch: regBatch, password_hash: hash, created_at: new Date().toISOString() })
    if (err) {
      showError(err.message.includes("duplicate") || err.message.includes("unique") ? "Account already exists. Please login." : `Registration failed: ${err.message}`)
    } else {
      success("Registered! Please login.")
      setTab("login"); setRegName(""); setRegPass(""); setRegConfirm("")
    }
    setLoading(false)
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

          {tab === "login" && (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div><label className="label">Full Name</label><input className="input" value={loginName} onChange={e => setLoginName(e.target.value)} placeholder="Enter your full name" /></div>
              <div>
                <label className="label">Batch</label>
                <select className="select" value={loginBatch} onChange={e => setLoginBatch(e.target.value)}>
                  {batches.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div><label className="label">Password</label><input type="password" className="input" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Enter password" /></div>
              <button type="submit" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-2" disabled={loading}>
                {loading ? <Spinner /> : "🔓 Login"}
              </button>
            </form>
          )}

          {tab === "register" && (
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <div><label className="label">Full Name</label><input className="input" value={regName} onChange={e => setRegName(e.target.value)} placeholder="Enter your full name" /></div>
              <div>
                <label className="label">Select Batch</label>
                <select className="select" value={regBatch} onChange={e => setRegBatch(e.target.value)}>
                  {batches.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div><label className="label">Password (min 4 chars)</label><input type="password" className="input" value={regPass} onChange={e => setRegPass(e.target.value)} placeholder="Create a password" /></div>
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