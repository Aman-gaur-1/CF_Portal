"use client"
import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"
import { MoatKpiCard, MoatStatusBadge } from "@/components/moat/MoatUi"

const EMPTY_KPIS = {
  competitors: 0,
  sources: 0,
  source_profiles: 0,
  collected_reviews: 0,
  analyzed_reviews: 0,
  pending_analysis: 0,
  opportunities: 0,
  alerts: 0,
  demand_signals: 0,
  market_gaps: 0,
  provider_health: { ready: 0, total: 0, status: "Offline" },
  health: {
    collection: "Warning",
    analysis: "Pending",
    providers: "Offline",
    daily_sync: "Disabled",
    reviews_pending_analysis: 0,
    review_coverage: 0,
    competitor_coverage: 0,
  },
}

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="text-right" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  )
}

function HealthRow({ label, status, detail }) {
  return (
    <div className="admin-row">
      <div>
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{label}</p>
        {detail && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{detail}</p>}
      </div>
      <MoatStatusBadge value={["Healthy", "Ready", "Enabled"].includes(status) ? "succeeded" : status === "Pending" ? "pending" : "failed"}>{status}</MoatStatusBadge>
    </div>
  )
}

export default function MoatReadinessDashboard({ adminToken }) {
  const [kpis, setKpis] = useState(EMPTY_KPIS)
  const [loading, setLoading] = useState(true)
  const { toasts, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [adminToken])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/moat/kpis", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load Moat KPIs.")
      setKpis({ ...EMPTY_KPIS, ...(data.kpis || {}) })
    } catch (err) {
      showError(err.message || "Could not load Moat KPIs.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex justify-between gap-3 flex-wrap">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Founder dashboard powered by canonical Moat KPIs.</p>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {loading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div> : (
        <>
          <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <MoatKpiCard label="Competitors" value={kpis.competitors} hint="Active" />
            <MoatKpiCard label="Sources" value={kpis.sources} hint={`${kpis.source_profiles} profiles`} />
            <MoatKpiCard label="Collected Reviews" value={kpis.collected_reviews} hint="Canonical total" />
            <MoatKpiCard label="Analyzed Reviews" value={kpis.analyzed_reviews} hint="Ready analysis" />
            <MoatKpiCard label="Pending Analysis" value={kpis.pending_analysis} hint="Collected minus analyzed" />
            <MoatKpiCard label="Opportunities" value={kpis.opportunities} hint="Generated" />
            <MoatKpiCard label="Alerts" value={kpis.alerts} hint="Generated" />
            <MoatKpiCard label="Demand Signals" value={kpis.demand_signals} hint="Current intelligence" />
            <MoatKpiCard label="Market Gaps" value={kpis.market_gaps} hint="Demand gaps" />
            <MoatKpiCard label="Provider Health" value={kpis.provider_health.status} hint={`${kpis.provider_health.ready}/${kpis.provider_health.total} ready`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card admin-panel">
              <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Collection Health</p>
              <div className="grid gap-2">
                <HealthRow label="Collection" status={kpis.health.collection} detail={`${kpis.collected_reviews} reviews collected`} />
                <HealthRow label="Analysis" status={kpis.health.analysis} detail={`${kpis.pending_analysis} reviews pending analysis`} />
                <HealthRow label="Providers" status={kpis.health.providers} detail={`${kpis.provider_health.ready} ready providers`} />
                <HealthRow label="Daily Sync" status={kpis.health.daily_sync} detail={`Next sync ${formatDate(kpis.next_auto_sync)}`} />
              </div>
            </div>

            <div className="card admin-panel">
              <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Freshness</p>
              <div className="grid gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                <DetailRow label="Last Collection" value={formatDate(kpis.last_collection?.completed_at || kpis.last_collection?.created_at)} />
                <DetailRow label="Last Analysis" value={formatDate(kpis.last_analysis?.analyzed_at || kpis.last_analysis?.created_at)} />
                <DetailRow label="Next Auto Sync" value={formatDate(kpis.next_auto_sync)} />
                <DetailRow label="Data Freshness" value={formatDate(kpis.generated_at)} />
                <DetailRow label="Review Coverage" value={`${kpis.health.review_coverage}%`} />
                <DetailRow label="Competitor Coverage" value={`${kpis.health.competitor_coverage}%`} />
              </div>
            </div>
          </section>
        </>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  )
}
