"use client"

import { useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

export default function StudentPasswordChange({ student, onComplete, onLogout }) {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [saving, setSaving] = useState(false)
  const { toasts, success, error: showError } = useToast()

  async function submit(event) {
    event.preventDefault()
    if (password.length < 8) { showError("New password must be at least 8 characters."); return }
    if (password !== confirmation) { showError("Passwords do not match."); return }
    setSaving(true)
    try {
      const response = await fetch("/api/student-password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${student.token}` },
        body: JSON.stringify({ password, confirmation }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.student) throw new Error(data.error || "Could not change the password.")
      success("Password changed. Your Student Portal is ready.")
      window.setTimeout(() => onComplete(data.student), 500)
    } catch (error) {
      showError(error.message || "Could not change the password.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-main)" }}>
      <section className="card p-6 w-full max-w-md" aria-labelledby="change-password-title">
        <p className="text-xs font-semibold" style={{ color: "var(--primary)" }}>FIRST LOGIN</p>
        <h1 id="change-password-title" className="text-2xl font-black mt-2">Change Your Password</h1>
        <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
          Welcome, {student.name}. Replace the temporary password before entering the Student Portal.
        </p>
        <form className="grid gap-4 mt-6" onSubmit={submit}>
          <label className="label">New password
            <input className="input mt-1" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
          <label className="label">Confirm new password
            <input className="input mt-1" type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
          <button className="btn btn-primary w-full flex justify-center" type="submit" disabled={saving}>
            {saving ? <Spinner size="sm" /> : "Save Password & Continue"}
          </button>
          <button className="btn btn-secondary w-full" type="button" onClick={onLogout} disabled={saving}>Log out</button>
        </form>
      </section>
      <ToastContainer toasts={toasts} />
    </main>
  )
}
