"use client"
import { useState, useEffect, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { hashPassword } from "@/lib/utils"
import Spinner from "@/components/ui/Spinner"
import Tabs from "@/components/ui/Tabs"
import { useToast, ToastContainer } from "@/components/ui/Toast"

const TABS = [{ id: "login", label: "🔐 Login" }, { id: "register", label: "📝 Register" }]

// Custom dropdown — works in both dark and light mode
function BatchSelect({ value, onChange, batches }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          padding: "10px 36px 10px 14px",
          background: "var(--select-bg)",
          border: "1px solid var(--input-border)",
          borderRadius: "10px",
          color: "var(--text-primary)",
          fontSize: "0.875rem",
          textAlign: "left",
          cursor: "pointer",
          position: "relative",
          outline: "none",
        }}
      >
        {value || "Select batch..."}
        <span style={{
          position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
          color: "var(--text-muted)", fontSize: "0.75rem", pointerEvents: "none"
        }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          boxShadow: "var(--shadow)",
          zIndex: 999,
          maxHeight: "220px",
          overflowY: "auto",
        }}>
          {batches.map(b => (
            <button
              key={b}
              type="button"
              onClick={() => { onChange(b); setOpen(false) }}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                background: b === value ? "var(--primary)" : "transparent",
                color: b === value ? "#fff" : "var(--text-primary)",
                fontSize: "0.875rem",
                textAlign: "left",
                border: "none",
                cursor: "pointer",
                borderRadius: b === value ? "8px" : "0",
              }}
              onMouseEnter={e => { if (b !== value) e.currentTarget.style.background = "var(--expander-hover)" }}
              onMouseLeave={e => { if (b !== value) e.currentTarget.style.background = "transparent" }}
            >
              {b}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
      if (data) {
        setBatches(data.map(b => b.name))
        setLoginBatch(data[0]?.name || "")
        setRegBatch(data[0]?.name || "")
      }
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
                <BatchSelect value={loginBatch} onChange={setLoginBatch} batches={batches} />
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
                <BatchSelect value={regBatch} onChange={setRegBatch} batches={batches} />
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
