"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const STATUSES = ["all", "queued", "running", "succeeded", "failed", "cancelled"]
const COLLECTION_MODES = [
  { value: "incremental", label: "Incremental Sync" },
  { value: "historical_backfill", label: "Historical Backfill" },
  { value: "date_range", label: "Date Range Collection" },
]
const REVIEW_FILTERS = [
  { value: "all", label: "All Reviews" },
  { value: "positive", label: "Positive Reviews Only" },
  { value: "negative", label: "Negative Reviews Only" },
  { value: "neutral", label: "Neutral Reviews Only" },
  { value: "rating_gte_4", label: "Rating >= 4" },
  { value: "rating_lte_3", label: "Rating <= 3" },
  { value: "rating_lte_2", label: "Rating <= 2" },
]
const SOURCE_TYPES = [
  { value: "google_maps", label: "Google Maps", supported: true },
  { value: "trustpilot", label: "Trustpilot", supported: false },
  { value: "reddit", label: "Reddit", supported: false },
  { value: "youtube", label: "YouTube", supported: false },
  { value: "quora", label: "Quora", supported: false },
  { value: "website", label: "Website", supported: false },
]

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

export default function MoatJobsManager({ adminToken }) {
  const [jobs, setJobs] = useState([])
  const [providers, setProviders] = useState([])
  const [competitors, setCompetitors] = useState([])
  const [autoSync, setAutoSync] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [runningAction, setRunningAction] = useState("")
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [collectionMode, setCollectionMode] = useState("incremental")
  const [reviewFilter, setReviewFilter] = useState("all")
  const [competitorScope, setCompetitorScope] = useState("all")
  const [selectedCompetitors, setSelectedCompetitors] = useState([])
  const [selectedSources, setSelectedSources] = useState(["google_maps"])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const { toasts, success: showSuccess, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [status])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch(`/api/moat/jobs?status=${encodeURIComponent(status)}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load jobs.")
      setJobs(data.jobs || [])
      setProviders(data.providers || [])
      setAutoSync(data.autoSync || null)

      const competitorsRes = await fetch("/api/moat/competitors?active=true", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const competitorsData = await competitorsRes.json().catch(() => ({}))
      if (competitorsRes.ok) setCompetitors(competitorsData.competitors || [])
    } catch (err) {
      showError(err.message || "Could not load jobs.")
    } finally {
      setLoading(false)
    }
  }

  function buildCollectionPayload(overrides = {}) {
    const competitorIds = competitorScope === "all" ? [] : selectedCompetitors
    return {
      collection_mode: overrides.collectionMode || collectionMode,
      review_filter: overrides.reviewFilter || reviewFilter,
      competitor_ids: overrides.competitorIds !== undefined ? overrides.competitorIds : competitorIds,
      source_types: overrides.sourceTypes || selectedSources,
      start_date: overrides.startDate !== undefined ? overrides.startDate : startDate,
      end_date: overrides.endDate !== undefined ? overrides.endDate : endDate,
    }
  }

  async function runCollection(action, endpoint, overrides = {}) {
    if (!adminToken || runningAction) return
    setRunningAction(action)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(buildCollectionPayload(overrides)),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Collection run failed.")
      setLastRun(data)
      showSuccess(`${action} completed.`)
      await load()
    } catch (err) {
      showError(err.message || "Collection run failed.")
    } finally {
      setRunningAction("")
    }
  }

  const providerText = useMemo(() => {
    return providers.map(provider => provider.label).join(", ") || "Apify, Outscraper, Custom Scraper"
  }, [providers])

  const actionDisabled = loading || Boolean(runningAction)
  const durationText = lastRun?.duration_ms ? `${Math.round(lastRun.duration_ms / 1000)}s` : "-"
  const dateControlsDisabled = collectionMode !== "date_range"

  function toggleCompetitor(id) {
    setSelectedCompetitors(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  function toggleSource(value) {
    setSelectedSources(prev => {
      const next = prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]
      return next.length ? next : ["google_maps"]
    })
  }

  return (
    <div className="grid gap-5">
      <section className="card admin-panel">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Advanced Review Collection</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Choose collection mode, competitors, source types, date range, and review filters.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
            <button
              className="btn btn-secondary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Run Collection", "/api/moat/reviews/collect")}
            >
              {runningAction === "Run Collection" ? "Running..." : "Run Collection"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Collect Missing Reviews", "/api/moat/reviews/collect-missing")}
            >
              {runningAction === "Collect Missing Reviews" ? "Running..." : "Collect Missing Reviews"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Run Backfill", "/api/moat/reviews/collect-all", { collectionMode: "historical_backfill" })}
            >
              {runningAction === "Run Backfill" ? "Running..." : "Run Backfill"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Collect Negative Reviews", "/api/moat/reviews/collect-all", { reviewFilter: "negative" })}
            >
              {runningAction === "Collect Negative Reviews" ? "Running..." : "Collect Negative Reviews"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Collect Positive Reviews", "/api/moat/reviews/collect-all", { reviewFilter: "positive" })}
            >
              {runningAction === "Collect Positive Reviews" ? "Running..." : "Collect Positive Reviews"}
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Collect All Competitors", "/api/moat/reviews/collect-all", { competitorIds: [] })}
            >
              {runningAction === "Collect All Competitors" ? "Running..." : "Collect All Competitors"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Run Daily Sync Now", "/api/moat/reviews/daily-sync")}
            >
              {runningAction === "Run Daily Sync Now" ? "Running..." : "Run Daily Sync Now"}
            </button>
          </div>
        </div>
      </section>

      <section className="card admin-panel">
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Collection Mode
            <select className="select" value={collectionMode} onChange={e => setCollectionMode(e.target.value)}>
              {COLLECTION_MODES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Review Filter
            <select className="select" value={reviewFilter} onChange={e => setReviewFilter(e.target.value)}>
              {REVIEW_FILTERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Collection Scope
            <select className="select" value={competitorScope} onChange={e => setCompetitorScope(e.target.value)}>
              <option value="all">All Competitors</option>
              <option value="selected">Selected Competitor</option>
              <option value="multiple">Multiple Competitors</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Start Date
            <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={dateControlsDisabled} />
          </label>
          <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            End Date
            <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={dateControlsDisabled} />
          </label>
          <div className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Source Scope
            <div className="flex flex-wrap gap-2">
              {SOURCE_TYPES.map(source => (
                <label key={source.value} className="badge-pending cursor-pointer" title={source.supported ? "" : "Configured but provider not available."}>
                  <input className="mr-1" type="checkbox" checked={selectedSources.includes(source.value)} onChange={() => toggleSource(source.value)} />
                  {source.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {competitorScope !== "all" && (
          <div className="grid gap-2 mt-4">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Competitors</p>
            <div className="flex flex-wrap gap-2">
              {competitors.map(competitor => (
                <label key={competitor.id} className={selectedCompetitors.includes(competitor.id) ? "badge-done cursor-pointer" : "badge-pending cursor-pointer"}>
                  <input className="mr-1" type="checkbox" checked={selectedCompetitors.includes(competitor.id)} onChange={() => toggleCompetitor(competitor.id)} />
                  {competitor.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card admin-panel">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Auto Sync</p>
          <div className="grid gap-2 mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            <div className="flex justify-between gap-3"><span>Enabled</span><span className={autoSync?.enabled ? "badge-done" : "badge-pending"}>{autoSync?.enabled ? "Enabled" : "Disabled"}</span></div>
            <div className="flex justify-between gap-3"><span>Cadence</span><span>{autoSync?.cadence || "daily"}</span></div>
            <div className="flex justify-between gap-3"><span>Last Sync Time</span><span>{formatDate(autoSync?.last_sync_time)}</span></div>
            <div className="flex justify-between gap-3"><span>Next Scheduled Sync</span><span>{formatDate(autoSync?.next_scheduled_sync)}</span></div>
            <div className="flex justify-between gap-3"><span>Profiles Processed</span><span>{autoSync?.profiles_processed || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Reviews Collected</span><span>{autoSync?.reviews_collected || 0}</span></div>
          </div>
        </div>
        <div className="card admin-panel">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Last Run Summary</p>
          <div className="grid gap-2 mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            <div className="flex justify-between gap-3"><span>Profiles Processed</span><span>{lastRun?.processed_profiles || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Jobs Created</span><span>{lastRun?.jobs_created || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Reviews Fetched</span><span>{lastRun?.reviews_fetched || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Reviews Inserted</span><span>{lastRun?.reviews_inserted || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Filtered Out</span><span>{lastRun?.filtered_out || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Duplicates</span><span>{lastRun?.duplicates || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Failed</span><span>{lastRun?.failed || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Collection Mode</span><span>{lastRun?.collection_mode || "-"}</span></div>
            <div className="flex justify-between gap-3"><span>Date Range</span><span>{lastRun?.start_date || "-"} to {lastRun?.end_date || "-"}</span></div>
            <div className="flex justify-between gap-3"><span>Last Run Duration</span><span>{durationText}</span></div>
          </div>
        </div>
      </section>

      <section className="card admin-panel">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Provider abstraction ready</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{providerText}</p>
          </div>
          <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </section>

      <section className="card admin-panel">
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Sync Job Tracking</p>
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
          <div className="grid gap-2">
            {jobs.map(job => (
              <div key={`${job.id}-${job.created_at}`} className="admin-row">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{job.competitors?.name || "Unknown competitor"} - {job.review_sources?.source_type || "all sources"}</p>
                  <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                    Started {formatDate(job.started_at)} - Completed {formatDate(job.completed_at)}
                  </p>
                  {job.request_payload?.collection_mode && (
                    <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                      {job.request_payload.collection_mode} - {job.request_payload.review_filter || "all"} - {(job.request_payload.source_scope || []).join(", ")}
                    </p>
                  )}
                  {job.error_message && <p className="text-xs mt-1 truncate" style={{ color: "var(--danger)" }}>{job.error_message}</p>}
                </div>
                <div className="flex gap-2 justify-end flex-wrap">
                  <span className={job.status === "failed" ? "badge-failed" : job.status === "succeeded" ? "badge-done" : "badge-pending"}>{job.status}</span>
                  <span className="badge-pending">{job.reviews_collected || 0} reviews</span>
                </div>
              </div>
            ))}
            {jobs.length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No ingestion jobs found.</p>}
          </div>
        )}
      </section>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
