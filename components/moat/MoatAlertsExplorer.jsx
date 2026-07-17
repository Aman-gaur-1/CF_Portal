"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"
import { buildMoatQuery, MoatDrawer, MoatKpiCard, MoatStatusBadge, moatAuthHeaders } from "@/components/moat/MoatUi"

const EMPTY_FILTERS = {
  competitor_id: "all",
  alert_type: "all",
  severity: "all",
  search: "",
}

const EMPTY_KPIS = {
  total_alerts: 0,
  critical_alerts: 0,
  high_severity_alerts: 0,
  competitors_impacted: 0,
}

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function timelineGroup(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return "Earlier"
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startYesterday = startToday - 24 * 60 * 60 * 1000
  const time = date.getTime()
  if (time >= startToday) return "Today"
  if (time >= startYesterday) return "Yesterday"
  if (time >= startToday - 7 * 24 * 60 * 60 * 1000) return "Last 7 Days"
  return "Earlier"
}

function AlertDrawer({ alert, onClose }) {
  if (!alert) return null

  return (
    <MoatDrawer open={Boolean(alert)} title={alert.title} eyebrow={`${alert.competitor} - ${alert.alert_type}`} label="Alert details" onClose={onClose}>
      <div className="grid gap-4">
          <section>
            <p className="label">Full Description</p>
            <div className="moat-review-full-text">{alert.description}</div>
          </section>

          <section className="grid gap-2 md:grid-cols-3">
            <div className="admin-queue-metric"><span>Confidence</span><b>{Math.round(Number(alert.confidence || 0) * 100)}%</b></div>
            <div className="admin-queue-metric"><span>Severity Score</span><b>{alert.severity_score}</b></div>
            <div className="admin-queue-metric"><span>Evidence</span><b>{alert.evidence_count}</b></div>
            <div className="admin-queue-metric"><span>Generated</span><b>{formatDate(alert.created_at)}</b></div>
            <div className="admin-queue-metric"><span>Triggered By</span><b>{alert.alert_type}</b></div>
            <div className="admin-queue-metric"><span>Evidence Count</span><b>{alert.evidence_count}</b></div>
          </section>

          <section>
            <p className="label">Supporting Evidence</p>
            <pre className="code-block">{JSON.stringify(alert.supporting_evidence || [], null, 2)}</pre>
          </section>

          <section>
            <p className="label">Source Insights</p>
            <pre className="code-block">{JSON.stringify(alert.source_insights || [], null, 2)}</pre>
          </section>

          <section>
            <p className="label">Related Opportunities</p>
            <pre className="code-block">{JSON.stringify(alert.related_opportunities || [], null, 2)}</pre>
          </section>
      </div>
    </MoatDrawer>
  )
}

function AlertCard({ alert, onOpen }) {
  return (
    <button className="moat-alert-card" onClick={() => onOpen(alert)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{alert.competitor} - {alert.alert_type}</p>
          <h3 className="text-base font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{alert.title}</h3>
        </div>
        <MoatStatusBadge value={alert.severity} />
      </div>
      <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>{alert.description}</p>
      <div className="flex gap-2 flex-wrap mt-4">
        <span className="badge-pending">{Math.round(Number(alert.confidence || 0) * 100)}% confidence</span>
        <span className="badge-pending">{alert.evidence_count} evidence</span>
        <span className="badge-pending">{alert.alert_type}</span>
        <span className="badge-done">{formatDate(alert.created_at)}</span>
      </div>
    </button>
  )
}

export default function MoatAlertsExplorer({ adminToken }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [filterOptions, setFilterOptions] = useState({ competitors: [], alert_types: [], severities: [] })
  const [kpis, setKpis] = useState(EMPTY_KPIS)
  const [alerts, setAlerts] = useState([])
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [loading, setLoading] = useState(true)
  const { toasts, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [adminToken, appliedFilters])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const query = buildMoatQuery(appliedFilters)
      const res = await fetch(`/api/moat/alerts${query ? `?${query}` : ""}`, {
        headers: moatAuthHeaders(adminToken),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load alerts.")
      setAlerts(data.alerts || [])
      setKpis({ ...EMPTY_KPIS, ...(data.kpis || {}) })
      setFilterOptions(data.filters || { competitors: [], alert_types: [], severities: [] })
    } catch (err) {
      showError(err.message || "Could not load alerts.")
    } finally {
      setLoading(false)
    }
  }

  function applyFilters(event) {
    event.preventDefault()
    setAppliedFilters(filters)
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
  }

  const alertTypes = useMemo(() => filterOptions.alert_types || [], [filterOptions.alert_types])
  const severities = useMemo(() => filterOptions.severities || [], [filterOptions.severities])
  const lastUpdated = alerts.map(item => new Date(item.created_at || 0).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0]
  const timeline = useMemo(() => {
    const groups = { Today: [], Yesterday: [], "Last 7 Days": [], Earlier: [] }
    alerts.forEach(alert => groups[timelineGroup(alert.created_at)].push(alert))
    return groups
  }, [alerts])

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-4">
        <MoatKpiCard label="Total Alerts" value={kpis.total_alerts} hint="Matching filters" />
        <MoatKpiCard label="Critical Alerts" value={kpis.critical_alerts} hint="Highest severity" />
        <MoatKpiCard label="High Severity Alerts" value={kpis.high_severity_alerts} hint="Needs attention" />
        <MoatKpiCard label="Competitors Impacted" value={kpis.competitors_impacted} hint="With alert signals" />
      </section>

      <section className="card admin-panel">
        <div className="grid gap-2 text-sm md:grid-cols-3" style={{ color: "var(--text-secondary)" }}>
          <div><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Last Updated</span><br />{formatDate(lastUpdated)}</div>
          <div><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Generated At</span><br />{formatDate(new Date())}</div>
          <div><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Data Freshness</span><br />{kpis.total_alerts} current alerts</div>
        </div>
      </section>

      <section className="card admin-panel">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[1fr_220px_160px_1fr_auto_auto]">
          <select className="select" value={filters.competitor_id} onChange={event => setFilters(prev => ({ ...prev, competitor_id: event.target.value }))}>
            <option value="all">All competitors</option>
            {(filterOptions.competitors || []).map(competitor => (
              <option key={competitor.id} value={competitor.id}>{competitor.name}</option>
            ))}
          </select>
          <select className="select" value={filters.alert_type} onChange={event => setFilters(prev => ({ ...prev, alert_type: event.target.value }))}>
            <option value="all">All alert types</option>
            {alertTypes.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
          <select className="select" value={filters.severity} onChange={event => setFilters(prev => ({ ...prev, severity: event.target.value }))}>
            <option value="all">All severities</option>
            {severities.map(severity => <option key={severity} value={severity}>{severity}</option>)}
          </select>
          <input className="input" value={filters.search} onChange={event => setFilters(prev => ({ ...prev, search: event.target.value }))} placeholder="Search alerts" />
          <button className="btn btn-primary btn-sm" disabled={loading}>{loading ? <Spinner /> : "Apply"}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters} disabled={loading}>Reset</button>
        </form>
      </section>

      <section className="card admin-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Alert Explorer</p>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>

        {loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : (
          <div className="grid gap-5">
            {Object.entries(timeline).map(([label, rows]) => rows.length > 0 && (
              <div key={label} className="grid gap-3">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {rows.map(alert => (
                    <AlertCard key={alert.id} alert={alert} onOpen={setSelectedAlert} />
                  ))}
                </div>
              </div>
            ))}
            {alerts.length === 0 && <p className="text-sm py-6" style={{ color: "var(--text-secondary)" }}>No alerts found from current intelligence.</p>}
          </div>
        )}
      </section>

      <AlertDrawer alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      <ToastContainer toasts={toasts} />
    </div>
  )
}
