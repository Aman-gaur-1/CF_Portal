"use client"

import { useEffect, useMemo, useState } from "react"
import SearchableBatchSelect from "@/components/ui/SearchableBatchSelect"
import Spinner from "@/components/ui/Spinner"

function normalizeBatch(value) {
  return typeof value === "string" ? { name: value, starts_on: "" } : value || { name: "", starts_on: "" }
}

export default function StudentOnboardingForm({ token, role = "admin", batches = [], onCreated, onClose, success, showError }) {
  const endpoint = role === "teacher" ? "/api/teacher-student-onboarding" : "/api/admin-student-onboarding"
  const batchOptions = useMemo(() => batches.map(normalizeBatch).filter(batch => batch.name), [batches])
  const [form, setForm] = useState({ name: "", phone: "", email: "", externalStudentId: "", teamsDisplayName: "", batch: batchOptions[0]?.name || "", joinDate: batchOptions[0]?.starts_on || "" })
  const [saving, setSaving] = useState(false)
  const [credential, setCredential] = useState(null)

  useEffect(() => {
    if (!form.batch && batchOptions[0]) setForm(current => ({ ...current, batch: batchOptions[0].name, joinDate: batchOptions[0].starts_on || "" }))
  }, [batchOptions, form.batch])

  function selectBatch(value) {
    const selected = batchOptions.find(batch => batch.name === value)
    setForm(current => ({ ...current, batch: value, joinDate: selected?.starts_on || current.joinDate }))
  }

  function setField(field, value) {
    setForm(current => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    if (!form.name.trim() || !form.phone.trim() || !form.batch) {
      showError("Student Name, Phone, and Batch are required.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(form) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not create the student account.")
      setCredential(data.credential)
      success("Student account created. Copy or download the credentials now.")
      onCreated?.(data)
    } catch (error) {
      showError(error.message || "Could not create the student account.")
    } finally {
      setSaving(false)
    }
  }

  async function copyCredential() {
    if (!credential) return
    try {
      await navigator.clipboard.writeText(`ConsoleFlare Student Portal\n\nName: ${credential.name}\nLogin ID: ${credential.loginId}\nPassword: ${credential.password}\nBatch: ${credential.batch}`)
      success("Credentials copied.")
    } catch {
      showError("Could not copy the credentials.")
    }
  }

  if (credential) {
    return (
      <div className="grid gap-4">
        <div className="rounded-xl p-4" style={{ border: "1px solid var(--success)", background: "rgba(34,197,94,0.08)" }} role="status">
          <p className="font-semibold">Student Created</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>These credentials are shown once. They are not stored in the browser after this form closes.</p>
        </div>
        <div className="grid gap-2 text-sm">
          <div><b>Name:</b> {credential.name}</div>
          <div><b>Batch:</b> {credential.batch}</div>
          <div><b>Login ID:</b> <span className="font-mono">{credential.loginId}</span></div>
          <div><b>Password:</b> <span className="font-mono">{credential.password}</span></div>
        </div>
        <div className="flex justify-end gap-2 flex-wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyCredential}>Copy Credentials</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="label">Student Name *<input className="input mt-1" value={form.name} onChange={event => setField("name", event.target.value)} autoFocus /></label>
        <label className="label">Phone *<input className="input mt-1" value={form.phone} onChange={event => setField("phone", event.target.value)} inputMode="tel" /></label>
        <label className="label">Email<input className="input mt-1" type="email" value={form.email} onChange={event => setField("email", event.target.value)} /></label>
        <label className="label">External Student ID<input className="input mt-1" value={form.externalStudentId} onChange={event => setField("externalStudentId", event.target.value)} /></label>
        <label className="label">Teams Display Name<input className="input mt-1" value={form.teamsDisplayName} onChange={event => setField("teamsDisplayName", event.target.value)} /></label>
        <label className="label">Join Date<input className="input mt-1" type="date" value={form.joinDate} onChange={event => setField("joinDate", event.target.value)} /></label>
      </div>
      <label className="label">Batch *<SearchableBatchSelect batches={batchOptions} value={form.batch} onChange={selectBatch} placeholder="Search batch..." label="Student batch" required /></label>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Login ID uses first name + final 2 phone digits. Password uses FirstName@last3#. The password is hashed before storage.</p>
      <div className="flex justify-end gap-2 flex-wrap">
        {onClose && <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>Cancel</button>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !batchOptions.length}>{saving ? <Spinner size="sm" /> : "Create Student Account"}</button>
      </div>
    </form>
  )
}

