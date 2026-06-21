"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const STATUSES = ["all", "queued", "running", "succeeded", "failed", "cancelled"]

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

export default function MoatJobsManager({ adminToken }) {
  const [jobs, setJobs] = useState([])
  const [providers, setProviders] = useState([])
  const [autoSync, setAutoSync] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [runningAction, setRunningAction] = useState("")
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
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
    } catch (err) {
      showError(err.message || "Could not load jobs.")
    } finally {
      setLoading(false)
    }
  }

  async function runCollection(action, endpoint) {
    if (!adminToken || runningAction) return
    setRunningAction(action)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
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

  return (
    <div className="grid gap-5">
      <section className="card admin-panel">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Bulk Review Collection</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Runs against active source profiles with provider caps, deduplication, and partial-failure handling.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
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
              onClick={() => runCollection("Collect Reviews For All Sources", "/api/moat/reviews/collect-all")}
            >
              {runningAction === "Collect Reviews For All Sources" ? "Running..." : "Collect Reviews For All Sources"}
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={actionDisabled}
              onClick={() => runCollection("Run Daily Sync Now", "/api/moat/reviews/daily-sync")}
            >
              {runningAction === "Run Daily Sync Now" ? "Running..." : "Run Daily Sync Now"}
            </button>
          </div>
        </div>
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
            <div className="flex justify-between gap-3"><span>Reviews Inserted</span><span>{lastRun?.reviews_inserted || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Duplicates</span><span>{lastRun?.duplicates || 0}</span></div>
            <div className="flex justify-between gap-3"><span>Failed</span><span>{lastRun?.failed || 0}</span></div>
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
