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
  { value: "all", label: "All" },
  { value: "positive", label: "Positive" },
  { value: "negative", label: "Negative" },
  { value: "neutral", label: "Neutral" },
  { value: "rating_gte_4", label: "Rating >= 4" },
  { value: "rating_lte_3", label: "Rating <= 3" },
  { value: "rating_lte_2", label: "Rating <= 2" },
]
const COMPETITOR_SCOPES = [
  { value: "selected", label: "Selected" },
  { value: "multiple", label: "Multiple" },
  { value: "all", label: "All" },
]
const SOURCE_TYPES = [
  { value: "google_maps", label: "Google Maps", supported: true, provider: "apify" },
  { value: "trustpilot", label: "Trustpilot", supported: false, provider: "future" },
  { value: "reddit", label: "Reddit", supported: false, provider: "future" },
  { value: "youtube", label: "YouTube", supported: false, provider: "future" },
  { value: "quora", label: "Quora", supported: false, provider: "future" },
  { value: "website", label: "Website", supported: false, provider: "future" },
]

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function formatDuration(startedAt, completedAt, durationMs) {
  if (durationMs) return `${Math.round(Number(durationMs) / 1000)}s`
  if (!startedAt || !completedAt) return "-"
  const started = new Date(startedAt).getTime()
  const completed = new Date(completedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return "-"
  return `${Math.round((completed - started) / 1000)}s`
}

function labelFor(items, value) {
  return items.find(item => item.value === value)?.label || value || "-"
}

function statusClass(value) {
  if (value === "failed") return "badge-failed"
  if (value === "succeeded" || value === "completed") return "badge-done"
  return "badge-pending"
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="text-right" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  )
}

export default function MoatJobsManager({ adminToken }) {
  const [jobs, setJobs] = useState([])
  const [providers, setProviders] = useState([])
  const [providerConfigs, setProviderConfigs] = useState([])
  const [competitors, setCompetitors] = useState([])
  const [sourceProfiles, setSourceProfiles] = useState([])
  const [autoSync, setAutoSync] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [runningAction, setRunningAction] = useState("")
  const [expandedJobId, setExpandedJobId] = useState("")
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
      const [jobsRes, competitorsRes, profilesRes, providersRes] = await Promise.all([
        fetch(`/api/moat/jobs?status=${encodeURIComponent(status)}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          cache: "no-store",
        }),
        fetch("/api/moat/competitors?active=true", {
          headers: { Authorization: `Bearer ${adminToken}` },
          cache: "no-store",
        }),
        fetch("/api/moat/source-profiles?active=true", {
          headers: { Authorization: `Bearer ${adminToken}` },
          cache: "no-store",
        }),
        fetch("/api/moat/providers", {
          headers: { Authorization: `Bearer ${adminToken}` },
          cache: "no-store",
        }),
      ])

      const jobsData = await jobsRes.json().catch(() => ({}))
      if (!jobsRes.ok) throw new Error(jobsData.error || "Could not load jobs.")
      setJobs(jobsData.jobs || [])
      setProviders(jobsData.providers || [])
      setAutoSync(jobsData.autoSync || null)

      const competitorsData = await competitorsRes.json().catch(() => ({}))
      if (competitorsRes.ok) setCompetitors(competitorsData.competitors || [])

      const profilesData = await profilesRes.json().catch(() => ({}))
      if (profilesRes.ok) setSourceProfiles(profilesData.sourceProfiles || [])

      const providersData = await providersRes.json().catch(() => ({}))
      if (providersRes.ok) setProviderConfigs(providersData.providers || [])
    } catch (err) {
      showError(err.message || "Could not load jobs.")
    } finally {
      setLoading(false)
    }
  }

  const selectedCompetitorIds = useMemo(() => {
    if (competitorScope === "all") return []
    return selectedCompetitors
  }, [competitorScope, selectedCompetitors])

  const matchedProfiles = useMemo(() => {
    return sourceProfiles.filter(profile => {
      const matchesCompetitor = competitorScope === "all" || selectedCompetitors.includes(profile.competitor_id)
      const matchesSource = selectedSources.includes(profile.source_type)
      return matchesCompetitor && matchesSource
    })
  }, [competitorScope, selectedCompetitors, selectedSources, sourceProfiles])

  const selectedCompetitorNames = useMemo(() => {
    if (competitorScope === "all") return "All active competitors"
    const names = competitors.filter(item => selectedCompetitors.includes(item.id)).map(item => item.name)
    if (competitorScope === "selected") return names[0] || "No competitor selected"
    return names.length ? `${names.length} competitors` : "No competitors selected"
  }, [competitorScope, competitors, selectedCompetitors])

  const selectedSourceLabels = useMemo(() => {
    return SOURCE_TYPES.filter(source => selectedSources.includes(source.value)).map(source => source.label).join(", ")
  }, [selectedSources])

  const unsupportedSources = useMemo(() => {
    return SOURCE_TYPES.filter(source => selectedSources.includes(source.value) && !source.supported)
  }, [selectedSources])

  const apifyConfig = useMemo(() => {
    return providerConfigs.find(provider => provider.provider_name === "apify")
  }, [providerConfigs])

  const providerGuidance = useMemo(() => {
    if (selectedSources.includes("google_maps") && (!apifyConfig?.enabled || apifyConfig?.status !== "ready")) {
      return "Google Maps collection needs the Apify provider enabled and ready in Providers."
    }
    if (unsupportedSources.length > 0) {
      return `${unsupportedSources.map(source => source.label).join(", ")} source profiles are tracked, but collection providers are not available yet.`
    }
    return ""
  }, [apifyConfig, selectedSources, unsupportedSources])

  const dateRangeInvalid = collectionMode === "date_range" && (!startDate || !endDate || startDate > endDate)
  const competitorSelectionInvalid = competitorScope !== "all" && selectedCompetitors.length === 0
  const hasNoCompetitors = !loading && competitors.length === 0
  const hasNoSourceProfiles = !loading && competitors.length > 0 && sourceProfiles.length === 0
  const startDisabled = loading || Boolean(runningAction) || dateRangeInvalid || competitorSelectionInvalid || hasNoCompetitors
  const actionDisabled = loading || Boolean(runningAction)
  const latestJobId = lastRun?.details?.find(detail => detail.job_id)?.job_id || "-"
  const runStatus = lastRun ? (lastRun.failed > 0 ? "Completed with failures" : "Completed") : "Not started"
  const providerText = providers.map(provider => provider.label).join(", ") || "Apify, Outscraper, Custom Scraper"

  function buildCollectionPayload() {
    return {
      collection_mode: collectionMode,
      review_filter: reviewFilter,
      competitor_ids: selectedCompetitorIds,
      source_types: selectedSources,
      start_date: collectionMode === "date_range" ? startDate : "",
      end_date: collectionMode === "date_range" ? endDate : "",
    }
  }

  async function postAction(action, endpoint, payload = {}) {
    if (!adminToken || runningAction) return
    setRunningAction(action)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(payload),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `${action} failed.`)
      setLastRun(data.processed_profiles !== undefined ? data : lastRun)
      showSuccess(`${action} completed.`)
      await load()
    } catch (err) {
      showError(err.message || `${action} failed.`)
    } finally {
      setRunningAction("")
    }
  }

  function startCollection() {
    postAction("Start Collection", "/api/moat/reviews/collect", buildCollectionPayload())
  }

  function runQuickAction(action, endpoint) {
    postAction(action, endpoint, {})
  }

  function toggleCompetitor(id) {
    setSelectedCompetitors(prev => {
      if (competitorScope === "selected") return prev.includes(id) ? [] : [id]
      return prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    })
  }

  function toggleSource(value) {
    setSelectedSources(prev => {
      const next = prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]
      return next.length ? next : ["google_maps"]
    })
  }

  function onCompetitorScopeChange(value) {
    setCompetitorScope(value)
    setSelectedCompetitors(prev => value === "selected" ? prev.slice(0, 1) : prev)
  }

  function jobMode(job) {
    return job.request_payload?.collection_mode || "-"
  }

  function jobFilter(job) {
    return job.request_payload?.review_filter || "all"
  }

  function jobSource(job) {
    return job.review_sources?.source_type || job.request_payload?.source_scope?.[0] || "all sources"
  }

  return (
    <div className="grid gap-5 pb-24 lg:pb-0">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.8fr)]">
        <div className="card admin-panel">
          <div className="grid gap-1">
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Collection Configuration</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Choose the mode, filter, competitors, sources, and dates before starting a collection.</p>
          </div>

          <div className="grid gap-4 mt-4 lg:grid-cols-3">
            <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Collection Mode
              <select className="select" value={collectionMode} onChange={event => setCollectionMode(event.target.value)}>
                {COLLECTION_MODES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Review Filter
              <select className="select" value={reviewFilter} onChange={event => setReviewFilter(event.target.value)}>
                {REVIEW_FILTERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Competitor Scope
              <select className="select" value={competitorScope} onChange={event => onCompetitorScopeChange(event.target.value)}>
                {COMPETITOR_SCOPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>

          {collectionMode === "historical_backfill" && (
            <div className="mt-4 rounded-lg border p-3 text-sm" style={{ borderColor: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.08)", color: "var(--text-secondary)" }}>
              This may collect a large number of reviews.
            </div>
          )}

          <div className="grid gap-4 mt-4 lg:grid-cols-2">
            <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Start Date
              <input className="input" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} disabled={collectionMode !== "date_range"} />
            </label>
            <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              End Date
              <input className="input" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} disabled={collectionMode !== "date_range"} />
            </label>
          </div>
          {dateRangeInvalid && (
            <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>Start Date and End Date are required, and End Date must be after Start Date.</p>
          )}

          <div className="grid gap-2 mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Source Selector</p>
            <div className="flex flex-wrap gap-2">
              {SOURCE_TYPES.map(source => (
                <label key={source.value} className={selectedSources.includes(source.value) ? "badge-done cursor-pointer" : "badge-pending cursor-pointer"} title={source.supported ? "" : "Tracked only. Provider collection is not available yet."}>
                  <input className="mr-1" type="checkbox" checked={selectedSources.includes(source.value)} onChange={() => toggleSource(source.value)} />
                  {source.label}
                </label>
              ))}
            </div>
          </div>

          {competitorScope !== "all" && (
            <div className="grid gap-2 mt-4">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Competitor Selector</p>
              <div className="flex flex-wrap gap-2">
                {competitors.map(competitor => (
                  <label key={competitor.id} className={selectedCompetitors.includes(competitor.id) ? "badge-done cursor-pointer" : "badge-pending cursor-pointer"}>
                    <input className="mr-1" type="checkbox" checked={selectedCompetitors.includes(competitor.id)} onChange={() => toggleCompetitor(competitor.id)} />
                    {competitor.name}
                  </label>
                ))}
              </div>
              {competitorSelectionInvalid && <p className="text-xs" style={{ color: "var(--danger)" }}>Select at least one competitor for this scope.</p>}
            </div>
          )}
        </div>

        <aside className="card admin-panel">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Collection Summary</p>
          <div className="grid gap-2 mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            <DetailRow label="Mode" value={labelFor(COLLECTION_MODES, collectionMode)} />
            <DetailRow label="Review Filter" value={labelFor(REVIEW_FILTERS, reviewFilter)} />
            <DetailRow label="Competitors" value={selectedCompetitorNames} />
            <DetailRow label="Sources" value={selectedSourceLabels || "-"} />
            <DetailRow label="Estimated Profiles" value={matchedProfiles.length} />
            <DetailRow label="Estimated Provider Calls" value={matchedProfiles.length} />
          </div>

          <div className="grid gap-2 mt-4">
            {hasNoCompetitors && <p className="text-sm" style={{ color: "var(--danger)" }}>No competitors are active yet. Add competitors before running review collection.</p>}
            {hasNoSourceProfiles && <p className="text-sm" style={{ color: "var(--danger)" }}>No source profiles are active. Run Source Discovery before collecting reviews.</p>}
            {providerGuidance && <p className="text-sm" style={{ color: "var(--danger)" }}>{providerGuidance}</p>}
          </div>

          <div className="mt-5 hidden lg:block">
            <button className="btn btn-primary w-full" disabled={startDisabled} onClick={startCollection}>
              {runningAction === "Start Collection" ? "Starting..." : "Start Collection"}
            </button>
          </div>
        </aside>
      </section>

      <section className="card admin-panel">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Primary Actions</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Start Collection uses the configuration above. Quick actions run independently.</p>
          </div>
          <button className="btn btn-primary" disabled={startDisabled} onClick={startCollection}>
            {runningAction === "Start Collection" ? "Starting..." : "Start Collection"}
          </button>
        </div>
      </section>

      <section className="card admin-panel">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Quick Actions</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>These actions do not use the selected collection configuration.</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
            <button className="btn btn-secondary btn-sm" disabled={actionDisabled} onClick={() => runQuickAction("Collect Missing Reviews", "/api/moat/reviews/collect-missing")}>
              {runningAction === "Collect Missing Reviews" ? "Running..." : "Collect Missing Reviews"}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={actionDisabled} onClick={() => runQuickAction("Run Daily Sync Now", "/api/moat/reviews/daily-sync")}>
              {runningAction === "Run Daily Sync Now" ? "Running..." : "Run Daily Sync Now"}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={actionDisabled} onClick={() => runQuickAction("Refresh Source Profiles", "/api/moat/source-discovery/refresh-all")}>
              {runningAction === "Refresh Source Profiles" ? "Running..." : "Refresh Source Profiles"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.45fr)]">
        <div className="card admin-panel">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Execution Results</p>
          <div className="grid gap-2 mt-3 text-sm sm:grid-cols-2" style={{ color: "var(--text-secondary)" }}>
            <DetailRow label="Status" value={runStatus} />
            <DetailRow label="Profiles Processed" value={lastRun?.processed_profiles || 0} />
            <DetailRow label="Jobs Created" value={lastRun?.jobs_created || 0} />
            <DetailRow label="Reviews Fetched" value={lastRun?.reviews_fetched || 0} />
            <DetailRow label="Reviews Inserted" value={lastRun?.reviews_inserted || 0} />
            <DetailRow label="Duplicates" value={lastRun?.duplicates || 0} />
            <DetailRow label="Failed" value={lastRun?.failed || 0} />
            <DetailRow label="Duration" value={formatDuration(null, null, lastRun?.duration_ms)} />
            <DetailRow label="Started At" value={formatDate(lastRun?.started_at)} />
            <DetailRow label="Completed At" value={formatDate(lastRun?.completed_at)} />
            <DetailRow label="Latest Job ID" value={latestJobId} />
          </div>
        </div>

        <div className="card admin-panel">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Daily Auto Sync</p>
          <div className="grid gap-2 mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            <DetailRow label="Enabled" value={autoSync?.enabled ? "Enabled" : "Disabled"} />
            <DetailRow label="Cadence" value={autoSync?.cadence || "daily"} />
            <DetailRow label="Last Sync" value={formatDate(autoSync?.last_sync_time)} />
            <DetailRow label="Next Sync" value={formatDate(autoSync?.next_scheduled_sync)} />
            <DetailRow label="Profiles" value={autoSync?.profiles_processed || 0} />
            <DetailRow label="Reviews" value={autoSync?.reviews_collected || 0} />
          </div>
        </div>
      </section>

      <section className="card admin-panel">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Job History</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{providerText}</p>
          </div>
          <select className="select" value={status} onChange={event => setStatus(event.target.value)}>
            {STATUSES.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>

        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
          <div className="grid gap-2 mt-4">
            {jobs.map(job => {
              const expanded = expandedJobId === `${job.id}-${job.created_at}`
              return (
                <div key={`${job.id}-${job.created_at}`} className="admin-row items-start">
                  <div className="min-w-0">
                    <div className="grid gap-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Competitor</p>
                        <p className="font-semibold truncate">{job.competitors?.name || "Unknown competitor"}</p>
                      </div>
                      <div>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Source</p>
                        <p className="truncate">{jobSource(job)}</p>
                      </div>
                      <div>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Mode / Filter</p>
                        <p className="truncate">{jobMode(job)} / {jobFilter(job)}</p>
                      </div>
                      <div>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Reviews / Duration</p>
                        <p>{job.reviews_collected || 0} / {formatDuration(job.started_at, job.completed_at)}</p>
                      </div>
                    </div>
                    <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                      Started {formatDate(job.started_at || job.created_at)} - Completed {formatDate(job.completed_at)}
                    </p>
                    {expanded && (
                      <div className="grid gap-2 mt-3 text-sm sm:grid-cols-2" style={{ color: "var(--text-secondary)" }}>
                        <DetailRow label="Job ID" value={job.id} />
                        <DetailRow label="Status" value={job.status || "-"} />
                        <DetailRow label="Started" value={formatDate(job.started_at || job.created_at)} />
                        <DetailRow label="Completed" value={formatDate(job.completed_at)} />
                        <DetailRow label="Source URL" value={job.review_sources?.source_url || "-"} />
                        <DetailRow label="Requested By" value={job.requested_by || job.request_payload?.requested_by || "-"} />
                        {job.error_message && <p className="sm:col-span-2" style={{ color: "var(--danger)" }}>{job.error_message}</p>}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end flex-wrap">
                    <span className={statusClass(job.status)}>{job.status}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setExpandedJobId(expanded ? "" : `${job.id}-${job.created_at}`)}>
                      {expanded ? "Collapse" : "Expand"}
                    </button>
                  </div>
                </div>
              )
            })}
            {jobs.length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No ingestion jobs found.</p>}
          </div>
        )}
      </section>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t p-3 lg:hidden" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
        <button className="btn btn-primary w-full" disabled={startDisabled} onClick={startCollection}>
          {runningAction === "Start Collection" ? "Starting..." : "Start Collection"}
        </button>
      </div>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
