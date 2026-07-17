"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import SmartSearchInput from "@/components/ui/SmartSearchInput"
import PaginationControls from "@/components/ui/PaginationControls"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"
import { useRefreshAction } from "@/lib/use-refresh-action"

const SEARCH_DEBOUNCE_MS = 250
const EMPTY_QUEUE_DATA = {
  trainers: [],
  phases: [],
  counts: {},
  submissions: [],
  job: null,
  metrics: null,
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
}

function QueueStatus({ status, failureReason }) {
  if (/manual review/i.test(failureReason || "")) return <span className="badge-pending">Manual Review</span>
  if (status === "AI Failed") return <span className="badge-failed">Failed</span>
  if (status === "Processing") return <span className="badge-pending" title="Auto-resets if stuck > 3 min">Processing</span>
  return <span className="badge-done">Ready</span>
}

function formatApprovalReasons(data, separator = "; ") {
  return Object.entries(data?.reasons || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(separator)
}

function formatApprovalConfirmation(preview, phaseName) {
  const phaseLabel = phaseName || "All Phases"
  const reasons = formatApprovalReasons(preview, "\n")
  return [
    "Approve All AI Ready?",
    "",
    "Mode:",
    phaseName ? "Selected Phase" : "Approve All Phases",
    "",
    "Phase:",
    phaseLabel,
    "",
    "Eligible:",
    String(preview?.eligible || 0),
    "",
    "Skipped:",
    String(preview?.skipped || 0),
    "",
    "Reasons:",
    reasons || "None",
  ].join("\n")
}

function formatApprovalSummary(data) {
  const reasons = formatApprovalReasons(data)
  const base = `Approved: ${data?.approved ?? data?.published ?? 0}. Skipped: ${data?.skipped || 0}.`
  const duration = data?.duration_ms ? ` Duration: ${(Number(data.duration_ms) / 1000).toFixed(1)} seconds.` : ""
  return reasons ? `${base} Reasons: ${reasons}.${duration}` : `${base}${duration}`
}

export default function AdminAiGenerationQueue({ adminToken, success, showError, onQueued }) {
  const [data, setData] = useState(EMPTY_QUEUE_DATA)
  const [trainerName, setTrainerName] = useState("")
  const [phaseName, setPhaseName] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [detailRow, setDetailRow] = useState(null)
  const loadAbortRef = useRef(null)
  const jobWasRunningRef = useRef(false)

  const loadQueue = useCallback(async ({ silent = false } = {}) => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), trainer: trainerName, phase: phaseName, search })
      const res = await fetch(`/api/admin-bulk-ai?${params}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
        signal: controller.signal,
      })
      const next = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(next.error || "Could not load AI generation queue.")
      const normalized = normalizeQueueData(next)
      setData(normalized)
      return normalized
    } catch (err) {
      if (err.name === "AbortError") return null
      showError(err.message || "Could not load AI generation queue.")
      throw err
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
        if (!silent) setLoading(false)
      }
    }
  }, [adminToken, page, phaseName, search, showError, trainerName])

  const refreshAction = useRefreshAction({
    onRefresh: () => loadQueue({ silent: true }),
    onSuccess: success,
    onError: showError,
  })

  useEffect(() => {
    loadQueue().catch(() => {})
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort()
    }
  }, [loadQueue])

  useAdaptivePolling(
    () => loadQueue({ silent: true }),
    { enabled: Boolean(adminToken) && data.job?.status === "running", activeMs: 2500 }
  )

  useEffect(() => {
    if (jobWasRunningRef.current && data.job?.status === "complete") {
      success(formatJobSummary(data.job))
      onQueued?.()
    }
    if (jobWasRunningRef.current && data.job?.status === "failed") {
      showError(data.job?.error || "Bulk AI generation failed.")
    }
    jobWasRunningRef.current = data.job?.status === "running"
  }, [data.job, onQueued, showError, success])

  useEffect(() => {
    const searchTimer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(searchTimer)
  }, [searchInput])

  async function generatePending(selectedTrainerName = "") {
    if (starting || jobRunning) return
    setStarting(true)
    try {
      const res = await fetch("/api/admin-bulk-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ trainerName: selectedTrainerName, phase: phaseName }),
      })
      const next = await res.json().catch(() => ({}))
      if (!res.ok && res.status !== 202) throw new Error(next.error || "Could not queue AI drafts.")
      setData(prev => normalizeQueueData({ ...prev, ...next, job: next.job || prev.job }))
      success(next.queued ? `Generating ${next.queued} AI drafts...` : "No pending AI drafts to generate.")
      if (next.queued) onQueued?.()
      await loadQueue({ silent: true })
    } catch (err) {
      showError(err.message || "Could not queue AI drafts.")
    } finally {
      setStarting(false)
    }
  }

  async function generateOne(row) {
    if (!row?.id || starting || jobRunning) return
    setStarting(true)
    try {
      const res = await fetch("/api/admin-bulk-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ submissionId: row.id }),
      })
      const next = await res.json().catch(() => ({}))
      if (!res.ok && res.status !== 202) throw new Error(next.error || "Could not queue AI draft.")
      setData(prev => normalizeQueueData({ ...prev, ...next, job: next.job || prev.job }))
      success(next.queued ? `Generating draft for ${row.studentName}.` : "No pending draft to generate.")
      await loadQueue({ silent: true })
    } catch (err) {
      showError(err.message || "Could not queue AI draft.")
    } finally {
      setStarting(false)
    }
  }

  async function approveAiReady() {
    if (approving) return
    setApproving(true)
    try {
      const previewRes = await fetch("/api/admin-workflow-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: "bulk_approve_preview", phase: phaseName }),
      })
      const preview = await previewRes.json().catch(() => ({}))
      if (!previewRes.ok) throw new Error(preview.error || "Could not preview AI-ready approvals.")
      if (!window.confirm(formatApprovalConfirmation(preview, phaseName))) return

      const res = await fetch("/api/admin-workflow-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: "bulk_approve", phase: phaseName }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error || "Could not approve AI-ready submissions.")
      success(formatApprovalSummary(result))
      await loadQueue({ silent: true })
    } catch (err) {
      showError(err.message || "Could not approve AI-ready submissions.")
    } finally {
      setApproving(false)
    }
  }

  const jobRunning = data.job?.status === "running"
  const selectedLabel = `${trainerName || "all trainers"} / ${phaseName || "all phases"}`
  const counts = data.counts || EMPTY_QUEUE_DATA.counts
  const metrics = data.metrics || {}
  const pagination = data.pagination || EMPTY_QUEUE_DATA.pagination
  const trainers = Array.isArray(data.trainers) ? data.trainers : []
  const phases = Array.isArray(data.phases) ? data.phases : []
  const submissions = Array.isArray(data.submissions) ? data.submissions : []

  const job = data.job || {}
  const processed = Number(job.completed || 0) + Number(job.failed || 0) + Number(job.skipped || 0)
  const progressPercent = job.total ? Math.min(Math.round((processed / job.total) * 100), 100) : 0
  const elapsedMs = job.startedAt ? Math.max(Date.now() - new Date(job.startedAt).getTime(), 0) : 0
  const etaMs = jobRunning && processed > 0 ? Math.max(Math.round((elapsedMs / processed) * (job.remaining || 0)), 0) : null
  const queueHealth = counts.failed > 0 ? "Needs attention" : counts.processing > 0 ? "Active" : counts.pending > 0 ? "Ready" : "Clear"
  const filterLabel = `${trainerName || "All Trainers"} / ${phaseName || "All Phases"}`

  return (
    <div className="card admin-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold">AI Generation Queue</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Generate missing drafts without overwriting existing work.</p>
        </div>
        <div className="queue-actions">
          <RefreshButton
            onClick={refreshAction.refresh}
            refreshing={refreshAction.refreshing}
            updatedLabel={refreshAction.updatedLabel}
            disabled={starting}
          />
          <button className="btn btn-primary btn-sm queue-action-btn" onClick={() => generatePending(trainerName)} disabled={starting || jobRunning}>
            {starting ? <Spinner size="sm" /> : jobRunning ? "Generating..." : "Generate Pending"}
          </button>
          <button className="btn btn-secondary btn-sm queue-action-btn" onClick={approveAiReady} disabled={approving || jobRunning}>
            {approving ? <Spinner size="sm" /> : "Approve All AI Ready"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        <div className="admin-queue-metric"><span>Pending</span><b>{counts.pending || 0}</b></div>
        <div className="admin-queue-metric"><span>Ready</span><b>{counts.ready || 0}</b></div>
        <div className="admin-queue-metric"><span>Failed</span><b>{counts.failed || 0}</b></div>
        <div className="admin-queue-metric"><span>Queue Health</span><b>{queueHealth}</b></div>
      </div>
      <button className="provider-expand-label" type="button" onClick={() => setInsightsOpen(value => !value)}>
        {insightsOpen ? "Hide Queue Insights" : "Queue Insights"}
      </button>
      {insightsOpen && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
          <div className="admin-queue-metric"><span>Processing</span><b>{counts.processing || 0}</b></div>
          <div className="admin-queue-metric"><span>Already Generated</span><b>{counts.alreadyGenerated || counts.ready || 0}</b></div>
        <div className="admin-queue-metric"><span>Success %</span><b>{counts.successPercent == null ? "-" : `${counts.successPercent}%`}</b></div>
        <div className="admin-queue-metric"><span>Average Queue Time</span><b>{formatDuration(counts.averageQueueMs)}</b></div>
        <div className="admin-queue-metric"><span>Last Generated</span><b>{formatRelativeTime(counts.lastGeneratedAt)}</b></div>
        </div>
      )}

      {metrics.queue && (
        <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
          Runtime queue: {metrics.queue.active || 0} active / {metrics.queue.limit || 1} capacity
        </p>
      )}

      {jobRunning && (
        <div className="admin-note mt-4 grid gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold">Generating AI Drafts...</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {data.job.currentState ? `${data.job.currentState} - ` : ""}
                {processed} / {data.job.total} processed
                {data.job.remaining ? ` - ${data.job.remaining} remaining` : ""}
                {data.job.currentSubmissionId ? ` - Current item: #${data.job.currentSubmissionId}` : ""}
              </p>
            </div>
            <Spinner size="sm" />
          </div>
          <div className="progress-bar-wrap" aria-label={`AI generation progress ${progressPercent}%`}>
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="admin-queue-metric"><span>Generated</span><b>{data.job.completed || 0}</b></div>
            <div className="admin-queue-metric"><span>Failed</span><b>{data.job.failed || 0}</b></div>
            <div className="admin-queue-metric"><span>Skipped</span><b>{data.job.skipped || 0}</b></div>
            <div className="admin-queue-metric"><span>Elapsed</span><b>{formatDuration(elapsedMs)}</b></div>
            <div className="admin-queue-metric"><span>ETA</span><b>{etaMs === null ? "Calculating" : formatDuration(etaMs)}</b></div>
          </div>
        </div>
      )}

      {data.job?.status === "complete" && data.job.total > 0 && (
        <div className="admin-note mt-4">
          <p className="font-semibold">Completed</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{formatJobSummary(data.job)}</p>
        </div>
      )}

      <div className="grid gap-2 mt-4 md:grid-cols-[minmax(0,220px)_minmax(0,220px)_1fr]">
        <label className="sr-only" htmlFor="admin-ai-trainer-filter">Trainer</label>
        <select id="admin-ai-trainer-filter" className="select" value={trainerName} onChange={e => { setTrainerName(e.target.value); setPage(1) }}>
          <option value="">All Trainers</option>
          {trainers.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <label className="sr-only" htmlFor="admin-ai-phase-filter">Phase</label>
        <select id="admin-ai-phase-filter" className="select" value={phaseName} onChange={e => { setPhaseName(e.target.value); setPage(1) }}>
          <option value="">All Phases</option>
          {phases.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <SmartSearchInput value={searchInput} onChange={setSearchInput} />
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
          {pagination.total} pending for {filterLabel}
        </p>
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : submissions.length === 0 ? (
          <div className="admin-empty-state">
            <p className="font-semibold">Everything is up to date</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              {search ? "No submissions matched your search." : `No pending AI drafts for ${selectedLabel}.`}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {submissions.map(row => (
              <div className="admin-row admin-queue-row" key={row.id}>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{row.studentName}</p>
                  <p className="text-sm mt-1 truncate" style={{ color: "var(--text-secondary)" }}>{row.topic}</p>
                  <div className="queue-row-meta">
                    <span>Trainer: {row.trainerName}</span>
                    <span>Batch: {row.batch}</span>
                    <span>Phase: {row.phase}</span>
                    <span>Submitted: {formatRelativeTime(row.submittedAt)}</span>
                  </div>
                  {row.failureReason && <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{row.failureReason}</p>}
                </div>
                <QueueStatus status={row.status} failureReason={row.failureReason} />
                <div className="flex gap-2 flex-wrap justify-end">
                  <button className="btn btn-primary btn-xs" type="button" onClick={() => generateOne(row)} disabled={starting || jobRunning}>Generate</button>
                  <button className="btn btn-secondary btn-xs" type="button" onClick={() => setDetailRow(row)}>View Details</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <PaginationControls {...pagination} page={page} onPageChange={setPage} />
      {detailRow && (
        <div className="activity-drawer-backdrop" role="presentation" onClick={() => setDetailRow(null)}>
          <aside className="activity-drawer" role="dialog" aria-modal="true" aria-label="Queue item details" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{detailRow.studentName}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{detailRow.topic}</p>
              </div>
              <button className="btn btn-secondary btn-xs" type="button" onClick={() => setDetailRow(null)}>Close</button>
            </div>
            <div className="grid gap-2 mt-4">
              {[
                ["Trainer", detailRow.trainerName],
                ["Batch", detailRow.batch],
                ["Phase", detailRow.phase],
                ["Submitted", formatRelativeTime(detailRow.submittedAt)],
                ["AI Status", detailRow.status],
                ["Failure Reason", detailRow.failureReason || "-"],
              ].map(([label, value]) => (
                <div className="admin-summary-row" key={label}><span>{label}</span><b>{value}</b></div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function normalizeQueueData(next = {}) {
  return {
    ...EMPTY_QUEUE_DATA,
    ...next,
    trainers: Array.isArray(next.trainers) ? next.trainers : [],
    phases: Array.isArray(next.phases) ? next.phases : [],
    counts: next.counts && typeof next.counts === "object" ? next.counts : {},
    submissions: Array.isArray(next.submissions) ? next.submissions : [],
    job: next.job || null,
    metrics: next.metrics || null,
    pagination: next.pagination && typeof next.pagination === "object"
      ? { ...EMPTY_QUEUE_DATA.pagination, ...next.pagination }
      : EMPTY_QUEUE_DATA.pagination,
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return "-"
  const seconds = Math.max(Math.round(Number(ms || 0) / 1000), 0)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

function formatRelativeTime(value) {
  if (!value) return "-"
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return "-"
  const minutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(value).toLocaleDateString()
}

function formatJobSummary(job = {}) {
  const duration = job.finishedAt && job.startedAt
    ? ` Duration: ${formatDuration(new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime())}.`
    : ""
  return `Generated: ${job.completed || 0}. Skipped: ${job.skipped || 0}. Failed: ${job.failed || 0}.${duration}`
}
