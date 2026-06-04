"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import SmartSearchInput from "@/components/ui/SmartSearchInput"
import PaginationControls from "@/components/ui/PaginationControls"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"

const SEARCH_DEBOUNCE_MS = 250
const EMPTY_QUEUE_DATA = {
  trainers: [],
  counts: {},
  submissions: [],
  job: null,
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
}

function QueueStatus({ status }) {
  if (status === "AI Failed") return <span className="badge-failed">AI Failed</span>
  if (status === "Processing") return <span className="badge-pending" title="Auto-resets if stuck > 3 min">Processing</span>
  return <span className="badge-pending">{status}</span>
}

export default function AdminAiGenerationQueue({ adminToken, success, showError, onQueued }) {
  const [data, setData] = useState(EMPTY_QUEUE_DATA)
  const [trainerName, setTrainerName] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const loadAbortRef = useRef(null)

  const loadQueue = useCallback(async ({ silent = false } = {}) => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), trainer: trainerName, search })
      const res = await fetch(`/api/admin-bulk-ai?${params}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
        signal: controller.signal,
      })
      const next = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(next.error || "Could not load AI generation queue.")
      setData(normalizeQueueData(next))
    } catch (err) {
      if (err.name !== "AbortError") showError(err.message || "Could not load AI generation queue.")
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
        if (!silent) setLoading(false)
      }
    }
  }, [adminToken, page, search, showError, trainerName])

  useEffect(() => {
    loadQueue()
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort()
    }
  }, [loadQueue])

  useAdaptivePolling(
    () => loadQueue({ silent: true }),
    { enabled: Boolean(adminToken) && data.job?.status === "running", activeMs: 2500 }
  )

  useEffect(() => {
    const searchTimer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(searchTimer)
  }, [searchInput])

  async function generatePending(selectedTrainerName = "") {
    setStarting(true)
    try {
      const res = await fetch("/api/admin-bulk-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ trainerName: selectedTrainerName }),
      })
      const next = await res.json().catch(() => ({}))
      if (!res.ok && res.status !== 202) throw new Error(next.error || "Could not queue AI drafts.")
      success(`${next.queued || 0} submissions queued for AI generation.`)
      if (next.queued) onQueued?.()
      await loadQueue({ silent: true })
    } catch (err) {
      showError(err.message || "Could not queue AI drafts.")
    } finally {
      setStarting(false)
    }
  }

  const jobRunning = data.job?.status === "running"
  const selectedLabel = trainerName || "all trainers"
  const counts = data.counts || EMPTY_QUEUE_DATA.counts
  const pagination = data.pagination || EMPTY_QUEUE_DATA.pagination
  const trainers = Array.isArray(data.trainers) ? data.trainers : []
  const submissions = Array.isArray(data.submissions) ? data.submissions : []

  return (
    <div className="card admin-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold">AI Generation Queue</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Generate missing drafts without overwriting existing work.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => generatePending()} disabled={starting || jobRunning}>
          {starting ? <Spinner size="sm" /> : "Generate All Pending"}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        <div className="admin-queue-metric"><span>Total pending AI drafts</span><b>{counts.pending || 0}</b></div>
        <div className="admin-queue-metric"><span>Processing</span><b>{counts.processing || 0}</b></div>
        <div className="admin-queue-metric"><span>AI failures</span><b>{counts.failed || 0}</b></div>
        <div className="admin-queue-metric"><span>Ready for review</span><b>{counts.ready || 0}</b></div>
      </div>

      {jobRunning && (
        <div className="admin-note mt-4 flex items-center justify-between gap-3">
          <span>
            {data.job.currentState ? `${data.job.currentState} - ` : ""}
            {data.job.completed} / {data.job.total} drafts generated{data.job.remaining ? ` - ${data.job.remaining} remaining` : ""}
          </span>
          <Spinner size="sm" />
        </div>
      )}

      <div className="grid gap-2 mt-4 md:grid-cols-[minmax(0,260px)_auto]">
        <select className="select" value={trainerName} onChange={e => { setTrainerName(e.target.value); setPage(1) }}>
          <option value="">All Trainers</option>
          {trainers.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={() => generatePending(trainerName)} disabled={!trainerName || starting || jobRunning}>
          Generate Pending For Selected Trainer
        </button>
      </div>

      <div className="mt-3">
        <SmartSearchInput value={searchInput} onChange={setSearchInput} />
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
          {pagination.total} pending for {trainerName || "all trainers"}
        </p>
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : submissions.length === 0 ? (
          <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>{search ? "No submissions matched your search." : `No pending AI drafts for ${selectedLabel}.`}</p>
        ) : (
          <div className="grid gap-2">
            {submissions.map(row => (
              <div className="admin-row" key={row.id}>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{row.studentName} - {row.topic}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{row.batch} - {row.trainerName}</p>
                </div>
                <QueueStatus status={row.status} />
              </div>
            ))}
          </div>
        )}
      </div>
      <PaginationControls {...pagination} page={page} onPageChange={setPage} />
    </div>
  )
}

function normalizeQueueData(next = {}) {
  return {
    ...EMPTY_QUEUE_DATA,
    ...next,
    trainers: Array.isArray(next.trainers) ? next.trainers : [],
    counts: next.counts && typeof next.counts === "object" ? next.counts : {},
    submissions: Array.isArray(next.submissions) ? next.submissions : [],
    job: next.job || null,
    pagination: next.pagination && typeof next.pagination === "object"
      ? { ...EMPTY_QUEUE_DATA.pagination, ...next.pagination }
      : EMPTY_QUEUE_DATA.pagination,
  }
}
