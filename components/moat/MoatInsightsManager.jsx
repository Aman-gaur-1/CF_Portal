"use client"
import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const EMPTY_METRICS = {
  reviews_analyzed: 0,
  positive_reviews: 0,
  negative_reviews: 0,
  competitors_analyzed: 0,
}

const SECTIONS = [
  { key: "top_complaints", title: "Top Complaints" },
  { key: "top_praises", title: "Top Praises" },
  { key: "emerging_themes", title: "Emerging Themes" },
  { key: "competitor_strengths", title: "Competitor Strengths" },
  { key: "competitor_weaknesses", title: "Competitor Weaknesses" },
]

const SORT_OPTIONS = [
  { value: "evidence", label: "Evidence Count" },
  { value: "confidence", label: "Confidence" },
  { value: "updated", label: "Last Updated" },
  { value: "trend", label: "Trend" },
]

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
}

function KpiCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-num">{value}</p>
      {hint && <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  )
}

function EvidenceList({ evidence }) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>No evidence items yet.</p>
  }

  return (
    <div className="flex gap-2 flex-wrap mt-3">
      {evidence.slice(0, 5).map((item, index) => (
        <span key={`${item.label || item.sentiment || index}-${index}`} className="badge-pending">
          {item.label || `${item.total || 0} reviews`} {item.count ? `(${item.count})` : ""}
        </span>
      ))}
    </div>
  )
}

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function sortedItems(items, sort) {
  const rows = [...(items || [])]
  if (sort === "confidence") return rows.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
  if (sort === "updated") return rows.sort((a, b) => new Date(b.last_updated || b.created_at || 0) - new Date(a.last_updated || a.created_at || 0))
  if (sort === "trend") return rows.sort((a, b) => String(a.trend || "").localeCompare(String(b.trend || "")))
  return rows.sort((a, b) => Number(b.evidence_count || 0) - Number(a.evidence_count || 0))
}

function InsightSection({ title, items, sort, onSort }) {
  const rows = sortedItems(items, sort)
  return (
    <section className="card admin-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
        <select className="select max-w-[220px]" value={sort} onChange={event => onSort(event.target.value)}>
          {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="grid gap-3">
        {rows.map(item => (
          <div key={item.id} className="moat-insight-row">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{item.competitor}</p>
                <div className="flex gap-2 flex-wrap justify-end">
                  <span className="badge-done">{Math.round(Number(item.confidence || 0) * 100)}% confidence</span>
                  <span className="badge-pending">{item.evidence_count || 0} evidence</span>
                  <span className="badge-pending">{item.trend || "Stable"}</span>
                </div>
              </div>
              <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>{item.summary}</p>
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>Last Updated {formatDate(item.last_updated || item.created_at)}</p>
              <EvidenceList evidence={item.evidence} />
            </div>
          </div>
        ))}
        {(!items || items.length === 0) && (
          <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No generated insight yet.</p>
        )}
      </div>
    </section>
  )
}

export default function MoatInsightsManager({ adminToken }) {
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const [sections, setSections] = useState({})
  const [categories, setCategories] = useState([])
  const [sorts, setSorts] = useState(() => Object.fromEntries(SECTIONS.map(section => [section.key, "evidence"])))
  const [lastRun, setLastRun] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const { toasts, success, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [adminToken])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/moat/insights", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load insights.")
      setMetrics({ ...EMPTY_METRICS, ...(data.metrics || {}) })
      setSections(data.sections || {})
      setCategories(data.categories || [])
    } catch (err) {
      showError(err.message || "Could not load insights.")
    } finally {
      setLoading(false)
    }
  }

  async function analyzeReviews() {
    if (!adminToken) return
    setRunning(true)
    try {
      const res = await fetch("/api/moat/analyze-reviews", {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({ batch_size: 25 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not analyze reviews.")
      setLastRun(data)
      success(`Analyzed ${data.processed || 0} reviews.`)
      await load()
    } catch (err) {
      showError(err.message || "Could not analyze reviews.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Reviews Analyzed" value={metrics.reviews_analyzed} hint="Ready analysis rows" />
        <KpiCard label="Positive Reviews" value={metrics.positive_reviews} hint="Rule-based sentiment" />
        <KpiCard label="Negative Reviews" value={metrics.negative_reviews} hint="Rule-based sentiment" />
        <KpiCard label="Competitors Analyzed" value={metrics.competitors_analyzed} hint="With analyzed reviews" />
      </section>

      <section className="card admin-panel">
        <div className="grid gap-2 text-sm md:grid-cols-3" style={{ color: "var(--text-secondary)" }}>
          <div><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Last Updated</span><br />{formatDate(Math.max(...Object.values(sections).flat().map(item => new Date(item.last_updated || item.created_at || 0).getTime()).filter(Number.isFinite)))}</div>
          <div><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Generated At</span><br />{formatDate(new Date())}</div>
          <div><span className="font-semibold" style={{ color: "var(--text-primary)" }}>Data Freshness</span><br />Ready analysis rows: {metrics.reviews_analyzed}</div>
        </div>
      </section>

      <section className="card admin-panel">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] items-center">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Review Intelligence Pipeline</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {categories.length} active categories. Analysis is idempotent and reads existing reviews only.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={analyzeReviews} disabled={running || loading}>
            {running ? <Spinner /> : "Analyze Reviews"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={running || loading}>Refresh</button>
        </div>
        {lastRun && (
          <div className="grid gap-2 md:grid-cols-3 mt-4">
            <div className="admin-queue-metric"><span>Processed</span><b>{lastRun.processed || 0}</b></div>
            <div className="admin-queue-metric"><span>Skipped</span><b>{lastRun.skipped || 0}</b></div>
            <div className="admin-queue-metric"><span>Failed</span><b>{lastRun.failed || 0}</b></div>
          </div>
        )}
      </section>

      {loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : (
        <div className="grid gap-5">
          {SECTIONS.map(section => (
            <InsightSection
              key={section.key}
              title={section.title}
              items={sections[section.key] || []}
              sort={sorts[section.key] || "evidence"}
              onSort={value => setSorts(prev => ({ ...prev, [section.key]: value }))}
            />
          ))}
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
