"use client"
import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

function label(value) {
  return String(value || "").replace(/_/g, " ")
}

export default function MoatProvidersManager({ adminToken }) {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingProvider, setTestingProvider] = useState(null)
  const [testResults, setTestResults] = useState({})
  const { toasts, success, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/moat/providers", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load providers.")
      setProviders(data.registryStatus || data.providers || [])
    } catch (err) {
      showError(err.message || "Could not load providers.")
    } finally {
      setLoading(false)
    }
  }

  async function toggle(provider) {
    setSaving(true)
    try {
      const res = await fetch("/api/moat/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ provider_name: provider.provider_name, enabled: !provider.enabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not update provider.")
      success(!provider.enabled ? "Provider enabled." : "Provider disabled.")
      await load()
    } catch (err) {
      showError(err.message || "Could not update provider.")
    } finally {
      setSaving(false)
    }
  }

  async function testConnection(provider) {
    setTestingProvider(provider.provider_name)
    try {
      const res = await fetch("/api/moat/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ provider_name: provider.provider_name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not test provider.")
      setTestResults(prev => ({ ...prev, [provider.provider_name]: data.result }))
      if (data.result?.ok) success("Apify connected.")
      else showError(data.result?.label || "Apify connection failed.")
      await load()
    } catch (err) {
      showError(err.message || "Could not test provider.")
    } finally {
      setTestingProvider(null)
    }
  }

  function connectionLabel(provider) {
    const result = testResults[provider.provider_name]
    const status = result?.status || provider.status || provider.health?.status
    if (status === "ready") return { text: "Connected", cls: "badge-done" }
    if (status === "not_configured" || status === "missing_token") return { text: "Missing Token", cls: "badge-failed" }
    if (status === "error" || status === "invalid_token") return { text: result?.label === "Invalid Token" ? "Invalid Token" : "Connection Error", cls: "badge-failed" }
    return { text: "Not Tested", cls: "badge-pending" }
  }

  return (
    <section className="card admin-panel">
      <div className="flex justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Provider Registry</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>No API keys, secrets, or external checks are stored here.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
      </div>
      {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
        <div className="grid gap-2">
          {providers.map(provider => (
            <div key={provider.provider_name} className="admin-row">
              <div>
                <p className="font-semibold capitalize">{label(provider.provider_name)}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  Health: {provider.health?.status || provider.status || "not_configured"} - Last tested: {provider.last_tested_at || "never"}
                </p>
              </div>
              <div className="flex gap-2 justify-end flex-wrap">
                <span className={connectionLabel(provider).cls}>{connectionLabel(provider).text}</span>
                <span className={provider.enabled ? "badge-done" : "badge-pending"}>{provider.enabled ? "Enabled" : "Disabled"}</span>
                {provider.provider_name === "apify" && (
                  <button className="btn btn-secondary btn-sm" onClick={() => testConnection(provider)} disabled={testingProvider !== null}>
                    {testingProvider === provider.provider_name ? <Spinner /> : "Test Connection"}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => toggle(provider)} disabled={saving}>
                  {provider.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </section>
  )
}
