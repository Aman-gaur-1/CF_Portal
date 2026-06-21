"use client"
import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const EMPTY_METRICS = {
  competitors: 0,
  sourceProfiles: 0,
  reviewSources: 0,
  coveragePercent: 0,
  providersEnabled: 0,
}

function ReadinessCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-num">{value}</div>
      {hint && <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  )
}

export default function MoatReadinessDashboard({ adminToken }) {
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const [coverage, setCoverage] = useState([])
  const [sourceTypes, setSourceTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const { toasts, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/moat/readiness", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load readiness metrics.")
      setMetrics({ ...EMPTY_METRICS, ...(data.metrics || {}) })
      setCoverage(data.coverage || [])
      setSourceTypes(data.supportedSourceTypes || [])
    } catch (err) {
      showError(err.message || "Could not load readiness metrics.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ReadinessCard label="Competitors" value={metrics.competitors} hint="Active competitors" />
        <ReadinessCard label="Sources Mapped" value={metrics.sourceProfiles} hint={`${metrics.reviewSources} source records`} />
        <ReadinessCard label="Coverage" value={`${metrics.coveragePercent}%`} hint="Mapped source slots" />
        <ReadinessCard label="Providers Enabled" value={metrics.providersEnabled} hint="Dry-run registry only" />
      </div>

      <section className="card admin-panel">
        <div className="flex justify-between gap-3 mb-3">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Source Coverage</p>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
          <div className="grid gap-2">
            {coverage.slice(0, 12).map(row => (
              <div key={row.competitor_id} className="admin-row">
                <span className="font-semibold">{row.competitor_name}</span>
                <div className="flex gap-2 flex-wrap justify-end">
                  {sourceTypes.map(type => (
                    <span key={type} className={row.bySource?.[type] ? "badge-done" : "badge-pending"}>
                      {type.replace(/_/g, " ")} {row.bySource?.[type] ? "yes" : "no"}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {coverage.length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No active competitors found.</p>}
          </div>
        )}
      </section>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
