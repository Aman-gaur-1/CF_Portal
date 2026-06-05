"use client"
import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getPoints, BROWSER_RENDERABLE, formatDate } from "@/lib/utils"
import { useAdaptivePolling } from "@/lib/use-adaptive-polling"
import { REVIEW_ACTIVITY_TTL_MS, serializeReviewActivity } from "@/lib/review-activity"
import Expander from "@/components/ui/Expander"
import Spinner from "@/components/ui/Spinner"
import AiStatusBadge from "@/components/ui/AiStatusBadge"
import SmartSearchInput from "@/components/ui/SmartSearchInput"
import PaginationControls from "@/components/ui/PaginationControls"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const POINT_OPTIONS = [
  { value: "100", label: "Assignment (+100 pts)" },
  { value: "200", label: "Project (+200 pts)" },
  { value: "50", label: "Small Task (+50 pts)" },
  { value: "20", label: "Micro Task (+20 pts)" },
  { value: "custom", label: "Manual points" },
]
const DEFAULT_PHASE_OPTIONS = ["Python", "Data Analytics"]
const REVIEW_REFRESH_MS = 15000
const SEARCH_DEBOUNCE_MS = 250
const BULK_PROGRESS_REFRESH_MS = 3000
const REVIEW_ACTIVITY_HEARTBEAT_MS = 60000

const TeacherAnalyticsCharts = dynamic(() => import("@/components/teacher/TeacherAnalyticsCharts"), {
  ssr: false,
  loading: () => (
    <div className="card p-5 mb-5" style={{ minHeight: 220 }}>
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    </div>
  ),
})

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

function isAbortError(err) {
  return err?.name === "AbortError"
}

function KpiCard({ id, label, value, active, onClick, tone = "var(--primary)" }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className="stat-card"
      style={{
        width: "100%",
        borderColor: active ? tone : "var(--stat-border)",
        background: active ? "linear-gradient(135deg,rgba(124,58,237,0.18),rgba(6,182,212,0.08))" : "var(--stat-bg)",
        boxShadow: active ? "0 18px 44px rgba(124,58,237,0.22)" : undefined,
      }}
    >
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
    </button>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-1 rounded font-semibold"
      style={{ background: copied ? "var(--success)" : "var(--primary)", color: "#1a1a1a" }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function isAiGeneratingUi(status, generatingIds, id) {
  return generatingIds.includes(String(id)) || status === "processing" || status === "pending"
}

function isMissingAiFeedback(row) {
  return row && !row.feedback && !row.ai_feedback && row.ai_status !== "processing"
}

function isReviewedSubmission(row) {
  return Boolean(
    row?.feedback ||
    row?.feedback_at ||
    row?.reviewed ||
    row?.reviewed_at ||
    ["reviewed", "finalized", "completed"].includes(String(row?.status || row?.review_status || "").toLowerCase())
  )
}

function isBulkJobActive(job) {
  return job?.status === "running"
}

function isEditableTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") || target.isContentEditable)
  )
}

function resolveSubmissionReviewState(row) {
  if (isReviewedSubmission(row)) {
    return { label: "REVIEWED", tone: "reviewed" }
  }

  if (row?.ai_feedback || row?.ai_status === "ready" || row?.ai_status === "completed") {
    return { label: "AI READY", tone: "ready" }
  }

  if (row?.ai_status === "failed") {
    return { label: "AI FAILED", tone: "failed" }
  }

  return { label: "NEEDS REVIEW", tone: "pending" }
}

function normalizeAiDraftState(row) {
  return row?.ai_feedback && row.ai_status === "failed"
    ? { ...row, ai_status: "ready", ai_error: null }
    : row
}

function ReviewStatusPill({ state }) {
  return <span className={`review-status-pill review-status-${state.tone}`}>{state.label}</span>
}

function aiProviderDiagnostics(row) {
  return row?.ai_evaluation?.diagnostics?.ai_provider || null
}

function aiStatusView(row, generatingIds = []) {
  const status = String(row?.ai_status || "").toLowerCase()
  const diagnostics = aiProviderDiagnostics(row)
  const queuedAt = row?.ai_feedback_at
  const elapsedMs = queuedAt ? Date.now() - new Date(queuedAt).getTime() : 0
  const locallyQueued = generatingIds.includes(String(row?.id))

  if (status === "ready" || row?.ai_feedback) {
    if (diagnostics?.fallback_used) {
      return {
        status: "ready",
        title: "Fallback Active",
        message: "Draft ready. A backup provider was used.",
        tone: "ready",
      }
    }
    return {
      status: "ready",
      title: "Ready",
      message: "Draft ready for review.",
      tone: "ready",
    }
  }

  if (status === "failed") {
    return {
      status: "failed",
      title: "Failed",
      message: publicAiError(row?.ai_error) || "AI draft failed. You can retry.",
      tone: "failed",
    }
  }

  if (status === "processing") {
    if (Number.isFinite(elapsedMs) && elapsedMs > 45_000) {
      return {
        status: "processing",
        title: "Delayed",
        message: "Provider response is taking longer than usual. This will keep updating automatically.",
        tone: "delayed",
      }
    }
    return {
      status: "processing",
      title: "Generating",
      message: "Generation in progress. You can continue reviewing other submissions.",
      tone: "active",
    }
  }

  if (status === "pending" || locallyQueued) {
    return {
      status: "pending",
      title: "Queued",
      message: row?.ai_error || "Queued successfully. Generation will start shortly.",
      tone: "queued",
    }
  }

  return null
}

function AiGenerationNotice({ row, generatingIds }) {
  const view = aiStatusView(row, generatingIds)
  if (!view) return null

  const styles = {
    queued: { background: "rgba(245,166,35,0.08)", borderColor: "rgba(245,166,35,0.26)" },
    active: { background: "rgba(59,130,246,0.08)", borderColor: "rgba(59,130,246,0.24)" },
    delayed: { background: "rgba(245,166,35,0.12)", borderColor: "rgba(245,166,35,0.34)" },
    ready: { background: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.24)" },
    failed: { background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.24)" },
  }

  return (
    <div
      className="mb-3 rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
      style={{
        ...(styles[view.tone] || styles.queued),
        border: `1px solid ${(styles[view.tone] || styles.queued).borderColor}`,
      }}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">{view.title}</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{view.message}</p>
      </div>
      <AiStatusBadge
        status={view.status}
        error={publicAiError(row?.ai_error)}
        queuedAt={row?.ai_feedback_at}
        diagnostics={aiProviderDiagnostics(row)}
      />
    </div>
  )
}

function publicAiError(message) {
  const text = String(message || "").trim()
  if (!text) return ""
  if (/processing timed out|timed out after|timeout/i.test(text)) {
    return "AI service took too long. Please retry."
  }
  return text
}

function aiGenerationButtonLabel(row, generatingIds, regenerate = false) {
  const view = aiStatusView(row, generatingIds)
  if (view?.title === "Queued") return "Queued"
  if (view?.title === "Delayed") return "Provider delayed"
  if (view?.title === "Generating") return regenerate ? "Regenerating..." : "Generating draft..."
  if (String(row?.ai_status || "").toLowerCase() === "failed") return "Retry AI draft"
  return regenerate ? "Regenerate draft" : "Generate AI draft"
}

function submissionReviewActivity(submission, currentTeacherName) {
  return serializeReviewActivity(submission, currentTeacherName)
}

function formatReviewActivityAge(value) {
  const openedAt = new Date(value).getTime()
  if (!Number.isFinite(openedAt)) return "Opened recently"
  const minutes = Math.max(Math.floor((Date.now() - openedAt) / 60000), 0)
  if (minutes < 1) return "Opened just now"
  return `Opened ${minutes} min ago`
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase()
}

export default function SubmissionsTab({ teacherName, teacherToken }) {
  const [data, setData] = useState([])
  const [batches, setBatches] = useState([])
  const [globalStats, setGlobalStats] = useState({
    totalSubmissions: 0,
    totalPending: 0,
    totalReviewed: 0,
    aiHealth: { ready: 0, failed: 0, processing: 0, pending: 0 },
    sevenDayTrend: [],
    batchDistribution: [],
  })
  const [loading, setLoading] = useState(true)
  const [activeKpi, setActiveKpi] = useState("total")
  const [statusFilter, setStatusFilter] = useState("All")
  const [aiStatusFilter, setAiStatusFilter] = useState("All")
  const [batchFilter, setBatchFilter] = useState("All Batches")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [submissionTypes, setSubmissionTypes] = useState({})
  const [submissionPhases, setSubmissionPhases] = useState({})
  const [submissionCustomPoints, setSubmissionCustomPoints] = useState({})
  const [phaseOptions, setPhaseOptions] = useState(DEFAULT_PHASE_OPTIONS)
  const [aiGeneratingIds, setAiGeneratingIds] = useState([])
  const [editingDraftId, setEditingDraftId] = useState(null)
  const [draftEdits, setDraftEdits] = useState({})
  const [draftSavingId, setDraftSavingId] = useState(null)
  const [feedbackSavingId, setFeedbackSavingId] = useState(null)
  const [feedbackEdits, setFeedbackEdits] = useState({})
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkStarting, setBulkStarting] = useState(false)
  const [bulkJob, setBulkJob] = useState(null)
  const [activeSubmissionId, setActiveSubmissionId] = useState(null)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 })
  const [reviewActivity, setReviewActivity] = useState(null)
  const [reviewSessionActive, setReviewSessionActive] = useState(false)
  const loadAbortRef = useRef(null)
  const bulkPollAbortRef = useRef(null)
  const activeSubmissionIdRef = useRef(null)
  const reviewInactivityTimerRef = useRef(null)
  const reviewSessionActiveRef = useRef(false)
  const confirmedPublishedRef = useRef(new Map())
  const submissionRefs = useRef({})
  const feedbackEditorRefs = useRef({})
  const { toasts, success, error: showError } = useToast()

  const load = useCallback(async ({ silent = false, requireAnalytics = false, throwOnError = false } = {}) => {
    if (loadAbortRef.current) loadAbortRef.current.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller

    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({
        mode: "reviews",
        page: String(page),
        status: statusFilter,
        aiStatus: aiStatusFilter,
        batch: batchFilter,
        search,
      })
      const confirmedReviewedIds = Array.from(confirmedPublishedRef.current.keys())
      if (confirmedReviewedIds.length) params.set("confirmedReviewedIds", confirmedReviewedIds.join(","))
      const [res, analyticsRes] = await Promise.all([
        fetch(`/api/teacher-data?${params}`, { headers: authHeaders(teacherToken), cache: "no-store", signal: controller.signal }),
        fetch(`/api/teacher-analytics?${new URLSearchParams(confirmedReviewedIds.length ? { confirmedReviewedIds: confirmedReviewedIds.join(",") } : {})}`, { headers: authHeaders(teacherToken), cache: "no-store", signal: controller.signal }),
      ])
      const scoped = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(scoped.error || "Could not load reviews.")

      const analytics = await analyticsRes.json().catch(() => ({}))
      if (requireAnalytics && !analyticsRes.ok) {
        throw new Error(analytics.error || "Could not refresh review counts.")
      }
      if (analyticsRes.ok) {
        setGlobalStats({
          totalSubmissions: analytics.totalSubmissions || 0,
          totalPending: analytics.totalPending || 0,
          totalReviewed: analytics.totalReviewed || 0,
          aiHealth: analytics.aiHealth || { ready: 0, failed: 0, processing: 0, pending: 0 },
          sevenDayTrend: analytics.sevenDayTrend || [],
          batchDistribution: analytics.batchDistribution || [],
        })
      }

      const rows = (scoped.submissions || [])
        .map(row => {
          const confirmed = confirmedPublishedRef.current.get(String(row.id))
          return normalizeAiDraftState(confirmed && !isReviewedSubmission(row) ? { ...row, ...confirmed } : row)
        })
        .filter(row => !(statusFilter === "Pending Feedback" && confirmedPublishedRef.current.has(String(row.id))))
      setData(rows)
      setBatches(scoped.batches || [])
      const nextPagination = scoped.pagination || { page: 1, pageSize: 50, total: rows.length, totalPages: 1 }
      setPagination(nextPagination)

      const types = {}, phases = {}, customPoints = {}
      const allPhases = new Set(DEFAULT_PHASE_OPTIONS)
      for (const r of rows) {
        const rawType = r.submission_type || "assignment"
        if (rawType === "assignment") types[r.id] = "100"
        else if (rawType === "project") types[r.id] = "200"
        else if (/^[0-9]+$/.test(rawType) && !["100", "200", "50", "20"].includes(rawType)) {
          types[r.id] = "custom"
          customPoints[r.id] = rawType
        } else types[r.id] = rawType
        phases[r.id] = r.phase || "Python"
        allPhases.add(r.phase || "Python")
      }
      setSubmissionTypes(types)
      setSubmissionCustomPoints(customPoints)
      setSubmissionPhases(phases)
      setPhaseOptions(Array.from(allPhases))
    } catch (err) {
      if (isAbortError(err)) {
        if (throwOnError) throw err
        return
      }
      showError(err.message || "Could not load reviews.")
      if (throwOnError) throw err
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
        setLoading(false)
      }
    }
  }, [aiStatusFilter, batchFilter, page, search, statusFilter, teacherToken])

  useEffect(() => {
    load()
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort()
    }
  }, [load])

  useAdaptivePolling(
    () => load({ silent: true }),
    { enabled: Boolean(teacherToken), activeMs: REVIEW_REFRESH_MS }
  )

  useEffect(() => {
    const searchTimer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(searchTimer)
  }, [searchInput])

  const loadBulkStatus = useCallback(async ({ signal } = {}) => {
    const res = await fetch("/api/teacher-bulk-ai", {
      headers: authHeaders(teacherToken),
      cache: "no-store",
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "Could not load bulk AI status.")
    setBulkJob(data.job || null)
    return data.job || null
  }, [teacherToken])

  useEffect(() => {
    const controller = new AbortController()
    bulkPollAbortRef.current = controller
    loadBulkStatus({ signal: controller.signal }).catch(err => {
      if (!isAbortError(err)) showError(err.message || "Could not load bulk AI status.")
    })
    return () => {
      controller.abort()
      if (bulkPollAbortRef.current) bulkPollAbortRef.current.abort()
    }
  }, [loadBulkStatus])

  const pollBulkStatus = useCallback(async () => {
    if (bulkPollAbortRef.current) bulkPollAbortRef.current.abort()

    const controller = new AbortController()
    bulkPollAbortRef.current = controller

    try {
      const job = await loadBulkStatus({ signal: controller.signal })
      if (job?.status && job.status !== "running") {
        await load({ silent: true })
      }
    } catch (err) {
      if (!isAbortError(err)) showError(err.message || "Could not refresh bulk AI progress.")
    }
  }, [load, loadBulkStatus])

  useAdaptivePolling(
    pollBulkStatus,
    { enabled: Boolean(teacherToken) && isBulkJobActive(bulkJob), activeMs: BULK_PROGRESS_REFRESH_MS }
  )

  useEffect(() => {
    activeSubmissionIdRef.current = activeSubmissionId
  }, [activeSubmissionId])

  const sendReviewActivity = useCallback(async (submissionId, action = "touch", { applyState = true, keepalive = false } = {}) => {
    if (!submissionId || !teacherToken) return null

    try {
      const res = await fetch("/api/teacher-review-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(teacherToken) },
        body: JSON.stringify({ submissionId, action }),
        keepalive,
      })
      const next = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(next.error || "Could not update review activity.")
      if (applyState && String(activeSubmissionIdRef.current) === String(submissionId)) {
        setReviewActivity(next.activity || null)
      }
      return next.activity || null
    } catch (err) {
      if (!keepalive) console.warn("[teacher-review-activity] request failed", err.message)
      return null
    }
  }, [teacherToken])

  useEffect(() => {
    if (activeSubmissionId === null) {
      setReviewActivity(null)
      return
    }

    function setSessionActive(value) {
      reviewSessionActiveRef.current = value
      setReviewSessionActive(value)
    }

    function clearInactivityTimer() {
      if (reviewInactivityTimerRef.current) {
        clearTimeout(reviewInactivityTimerRef.current)
        reviewInactivityTimerRef.current = null
      }
    }

    function expireSession() {
      clearInactivityTimer()
      setSessionActive(false)
      setReviewActivity(null)
      sendReviewActivity(activeSubmissionId, "clear", { applyState: false, keepalive: true })
    }

    function resetInactivityTimer() {
      clearInactivityTimer()
      if (!reviewSessionActiveRef.current) {
        setSessionActive(true)
        sendReviewActivity(activeSubmissionId)
      }
      reviewInactivityTimerRef.current = setTimeout(expireSession, REVIEW_ACTIVITY_TTL_MS)
    }

    setReviewActivity(null)
    setSessionActive(true)
    sendReviewActivity(activeSubmissionId)
    resetInactivityTimer()
    window.addEventListener("pointerdown", resetInactivityTimer)
    window.addEventListener("keydown", resetInactivityTimer)

    return () => {
      clearInactivityTimer()
      setSessionActive(false)
      window.removeEventListener("pointerdown", resetInactivityTimer)
      window.removeEventListener("keydown", resetInactivityTimer)
      sendReviewActivity(activeSubmissionId, "clear", { applyState: false, keepalive: true })
    }
  }, [activeSubmissionId, sendReviewActivity])

  useAdaptivePolling(
    () => sendReviewActivity(activeSubmissionId),
    {
      enabled: Boolean(teacherToken) && activeSubmissionId !== null && reviewSessionActive,
      activeMs: REVIEW_ACTIVITY_HEARTBEAT_MS,
      hiddenMs: REVIEW_ACTIVITY_HEARTBEAT_MS,
    }
  )

  function pendingRows() {
    return data.filter(row => !isReviewedSubmission(row))
  }

  function adjacentPendingId(currentId, direction) {
    const rows = pendingRows()
    if (!rows.length) return null
    const currentIndex = rows.findIndex(row => String(row.id) === String(currentId))
    if (currentIndex === -1) return rows[direction < 0 ? rows.length - 1 : 0].id
    return rows[currentIndex + direction]?.id ?? null
  }

  function navigatePending(direction) {
    const destinationId = adjacentPendingId(activeSubmissionId, direction)
    if (destinationId !== null) setActiveSubmissionId(destinationId)
  }

  function nextPendingIdAfterApproval(currentId) {
    const rows = pendingRows()
    const currentIndex = rows.findIndex(row => String(row.id) === String(currentId))
    return rows[currentIndex + 1]?.id ?? rows.find(row => String(row.id) !== String(currentId))?.id ?? null
  }

  useEffect(() => {
    if (activeSubmissionId === null) return
    const timer = setTimeout(() => {
      submissionRefs.current[activeSubmissionId]?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 0)
    return () => clearTimeout(timer)
  }, [activeSubmissionId])

  async function saveFeedback(r, textOverride) {
    const rawType = submissionTypes[r.id] || r.submission_type || "assignment"
    const finalType = rawType === "custom" ? submissionCustomPoints[r.id] : rawType
    const phase = submissionPhases[r.id] || r.phase || "Python"
    const feedback = (textOverride ?? feedbackEdits[r.id] ?? r.feedback ?? r.ai_feedback ?? "").trim()
    if (!feedback) { showError("Feedback cannot be empty."); return }

    setFeedbackSavingId(r.id)
    try {
      const res = await fetch("/api/teacher-feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(teacherToken) },
        body: JSON.stringify({ submissionId: r.id, feedback, submission_type: finalType, phase }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save feedback.")
      if (!data.success || !data.persisted || !data.submission?.feedback?.trim()) {
        throw new Error(data.error || "Feedback was not confirmed saved. Please refresh and try again.")
      }
      const published = data.submission
      if (String(published.id) !== String(r.id)) {
        throw new Error("Feedback was saved to an unexpected submission. Please refresh and check the queue.")
      }
      confirmedPublishedRef.current.set(String(r.id), published)
      const nextPendingId = nextPendingIdAfterApproval(r.id)
      setData(prev => {
        const nextRows = prev.map(row => String(row.id) === String(r.id) ? { ...row, ...published } : row)
        return statusFilter === "Pending Feedback"
          ? nextRows.filter(row => String(row.id) !== String(r.id) && !isReviewedSubmission(row))
          : nextRows
      })
      await load({ silent: true, requireAnalytics: true, throwOnError: true })
      success(nextPendingId === null ? "Feedback published." : "Feedback published. Opening next pending review.")
      setActiveSubmissionId(nextPendingId)
    } catch (err) {
      showError(err.message || "Could not save feedback.")
    } finally {
      setFeedbackSavingId(null)
    }
  }

  async function generateAiDraft(r) {
    const submissionId = String(r.id)
    setAiGeneratingIds(prev => [...prev, submissionId])
    setData(prev => prev.map(row => String(row.id) === submissionId
      ? { ...row, ai_status: "pending", ai_error: "Queued successfully. Generation will start shortly.", ai_feedback_at: new Date().toISOString() }
      : row
    ))
    try {
      const res = await fetch("/api/teacher-generate-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(teacherToken) },
        body: JSON.stringify({ submissionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 202) {
        setData(prev => prev.map(row => String(row.id) === submissionId
          ? { ...row, ai_status: data.status || "pending", ai_error: data.message || "Queued successfully. Generation will start shortly.", ai_feedback_at: row.ai_feedback_at || new Date().toISOString() }
          : row
        ))
        success(data.message || "AI draft queued. You can keep reviewing.")
        await load({ silent: true })
        return
      }
      if (!res.ok) throw new Error(data.error || "AI draft generation failed.")
      if (data.status !== "ready" || !data.ai_feedback?.trim()) {
        throw new Error(data.error || "AI draft was not confirmed ready. Please retry.")
      }
      setData(prev => prev.map(row => String(row.id) === submissionId
        ? { ...row, ai_status: "ready", ai_error: null, ai_feedback: data.ai_feedback, ai_feedback_at: new Date().toISOString() }
        : row
      ))
      await load({ silent: true })
      success(data.message || "AI draft ready.")
    } catch (err) {
      showError(err.message || "AI draft generation failed.")
      await load({ silent: true })
    } finally {
      setAiGeneratingIds(prev => prev.filter(id => id !== submissionId))
    }
  }

  async function saveAiDraftEdit(r) {
    const text = (draftEdits[r.id] ?? r.ai_feedback ?? "").trim()
    if (!text) { showError("Draft cannot be empty."); return }

    setDraftSavingId(r.id)
    try {
      const res = await fetch("/api/teacher-ai-draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(teacherToken) },
        body: JSON.stringify({ submissionId: r.id, ai_feedback: text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save draft.")
      success("Draft saved.")
      setEditingDraftId(null)
      await load({ silent: true })
    } catch (err) {
      showError(err.message || "Could not save draft.")
    } finally {
      setDraftSavingId(null)
    }
  }

  async function startBulkAiGeneration() {
    setBulkStarting(true)
    try {
      const res = await fetch("/api/teacher-bulk-ai", {
        method: "POST",
        headers: authHeaders(teacherToken),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not start bulk AI generation.")
      setBulkJob(data.job || null)
      setBulkConfirmOpen(false)
      if (data.job?.total) {
        success("Bulk AI generation started.")
      } else {
        success("No missing AI drafts to generate.")
        await load({ silent: true })
      }
    } catch (err) {
      showError(err.message || "Could not start bulk AI generation.")
    } finally {
      setBulkStarting(false)
    }
  }

  function applyKpiFilter(id) {
    setPage(1)
    setActiveKpi(id)
    setAiStatusFilter("All")
    if (id === "total") setStatusFilter("All")
    if (id === "pending") setStatusFilter("Pending Feedback")
    if (id === "reviewed") setStatusFilter("Feedback Done")
    if (id === "failed") {
      setStatusFilter("Failed AI")
      setAiStatusFilter("All")
    }
  }

  function handleStatusFilterChange(value) {
    setPage(1)
    setStatusFilter(value)
    setAiStatusFilter("All")
  }

  const batchOptions = useMemo(() => ["All Batches", ...batches.map(b => b.name)], [batches])
  const submissionCounts = useMemo(() => ({
    all: globalStats.totalSubmissions,
    pending: globalStats.totalPending,
    reviewed: globalStats.totalReviewed,
    failed: globalStats.aiHealth.failed,
  }), [globalStats])
  const statusOptions = useMemo(() => [
    { value: "All", label: `All (${submissionCounts.all})` },
    { value: "Pending Feedback", label: `Pending Feedback (${submissionCounts.pending})` },
    { value: "Feedback Done", label: `Reviewed (${submissionCounts.reviewed})` },
    { value: "Failed AI", label: `Failed AI (${submissionCounts.failed})` },
  ], [submissionCounts])
  const missingAiCount = useMemo(() => data.filter(isMissingAiFeedback).length, [data])
  const bulkActive = isBulkJobActive(bulkJob)
  const filtered = data
  const activeSubmission = useMemo(() => {
    return data.find(row => String(row.id) === String(activeSubmissionId)) || null
  }, [activeSubmissionId, data])

  useEffect(() => {
    if (activeSubmissionId !== null && !activeSubmission) setActiveSubmissionId(null)
  }, [activeSubmission, activeSubmissionId])

  const activeReviewActivity = reviewActivity || submissionReviewActivity(activeSubmission, teacherName)
  const otherReviewActivity = activeReviewActivity && activeReviewActivity.isCurrentTeacher === false
    ? activeReviewActivity
    : null
  const previousPendingId = adjacentPendingId(activeSubmissionId, -1)
  const nextPendingId = adjacentPendingId(activeSubmissionId, 1)

  useEffect(() => {
    function handleShortcut(event) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return

      const key = event.key.toLowerCase()
      if (key === "j" && nextPendingId !== null) {
        event.preventDefault()
        navigatePending(1)
      }
      if (key === "k" && previousPendingId !== null) {
        event.preventDefault()
        navigatePending(-1)
      }
      if (key === "a" && activeSubmission?.ai_feedback && !activeSubmission.feedback && feedbackSavingId !== activeSubmission.id) {
        event.preventDefault()
        saveFeedback(activeSubmission, activeSubmission.ai_feedback)
      }
      if (key === "r" && activeSubmission && !activeSubmission.feedback && !isAiGeneratingUi(activeSubmission.ai_status, aiGeneratingIds, activeSubmission.id)) {
        event.preventDefault()
        generateAiDraft(activeSubmission)
      }
      if (key === "e" && activeSubmission && !activeSubmission.feedback) {
        event.preventDefault()
        feedbackEditorRefs.current[activeSubmission.id]?.focus()
      }
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  })

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Review queue</p>
        <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{submissionCounts.pending} pending reviews</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard id="total" label="Total" value={globalStats.totalSubmissions} active={activeKpi === "total"} onClick={applyKpiFilter} />
        <KpiCard id="pending" label="Pending" value={globalStats.totalPending} active={activeKpi === "pending"} onClick={applyKpiFilter} tone="var(--primary)" />
        <KpiCard id="reviewed" label="Reviewed" value={globalStats.totalReviewed} active={activeKpi === "reviewed"} onClick={applyKpiFilter} tone="var(--success)" />
        <KpiCard id="failed" label="Failed AI" value={globalStats.aiHealth.failed} active={activeKpi === "failed"} onClick={applyKpiFilter} tone="var(--danger)" />
      </div>

      <TeacherAnalyticsCharts globalStats={globalStats} />

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 mb-4">
        <select className="select" value={statusFilter} onChange={e => handleStatusFilterChange(e.target.value)}>
          {statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select className="select" value={batchFilter} onChange={e => { setBatchFilter(e.target.value); setPage(1) }}>
          {batchOptions.map(b => <option key={b}>{b}</option>)}
        </select>
        <SmartSearchInput value={searchInput} onChange={setSearchInput} />
        {missingAiCount > 0 && (
          <button
            type="button"
            className="btn btn-secondary whitespace-nowrap"
            disabled={bulkActive || bulkStarting}
            onClick={() => setBulkConfirmOpen(true)}
          >
            {bulkActive ? "Generating..." : "Generate Missing AI"}
          </button>
        )}
      </div>

      {(bulkActive || bulkJob?.status === "complete" || bulkJob?.status === "failed") && bulkJob?.total > 0 && (
        <div className="card p-3 mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">
                {bulkActive ? "Generating AI feedback..." : bulkJob.status === "failed" ? "Bulk AI generation stopped" : "Bulk AI generation complete"}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {bulkJob.currentState ? `${bulkJob.currentState} - ` : ""}
                {bulkJob.completed} / {bulkJob.total} completed
                {bulkJob.failed ? ` - ${bulkJob.failed} failed` : ""}
                {bulkJob.remaining ? ` - ${bulkJob.remaining} remaining` : ""}
              </p>
            </div>
            {bulkActive && <Spinner size="sm" />}
          </div>
        </div>
      )}

      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.35)" }}>
          <div className="card p-5 w-full max-w-sm">
            <p className="text-base font-semibold mb-2">Generate Missing AI</p>
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              {missingAiCount} submissions need AI feedback.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary btn-sm" disabled={bulkStarting} onClick={() => setBulkConfirmOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm flex items-center gap-2" disabled={bulkStarting || missingAiCount === 0} onClick={startBulkAiGeneration}>
                {bulkStarting ? <Spinner size="sm" /> : null}
                Start Generation
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center"><p style={{ color: "var(--text-secondary)" }}>{search ? "No submissions matched your search." : "No assigned submissions found."}</p></div>
      ) : (
        filtered.map(r => {
          const hasFb = isReviewedSubmission(r)
          const rawType = submissionTypes[r.id] || r.submission_type || "assignment"
          const normalizedRawType = rawType === "assignment" ? "100" : rawType === "project" ? "200" : rawType
          const newType = /^[0-9]+$/.test(normalizedRawType) && !["100", "200", "50", "20"].includes(normalizedRawType) ? "custom" : normalizedRawType
          const customValue = submissionCustomPoints[r.id] || ""
          const newPhase = submissionPhases[r.id] || r.phase || "Python"
          const reviewState = resolveSubmissionReviewState(r)

          return (
            <div key={r.id} ref={node => { submissionRefs.current[r.id] = node }}>
              <Expander
                header={(
                  <span className="submission-row-summary">
                    <span className="submission-row-student">{r.student_name || "Student"}</span>
                    <span className="submission-row-batch">{r.batch || "No batch"}</span>
                    <span className="submission-row-topic"><span aria-hidden>📘</span>{r.topic || "Untitled assignment"}</span>
                  </span>
                )}
                badge={<ReviewStatusPill state={reviewState} />}
                open={String(activeSubmissionId) === String(r.id)}
                onToggle={open => setActiveSubmissionId(open ? r.id : null)}
              >
              {otherReviewActivity && (
                <div className="review-lock-notice">
                  <p className="font-semibold">Currently being reviewed by {otherReviewActivity.trainerName}</p>
                  <p className="mt-1">{formatReviewActivityAge(otherReviewActivity.openedAt)}</p>
                </div>
              )}
              <div className="review-workspace-toolbar">
                <div>
                  <p className="text-xs font-semibold">{submissionCounts.pending} pending reviews</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Shortcuts: J next, K previous, A approve, R regenerate, E edit</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigatePending(-1)} disabled={previousPendingId === null}>{"← Previous"}</button>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigatePending(1)} disabled={nextPendingId === null}>{"Next →"}</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-3">
                <span><b>Student:</b> {r.student_name}</span>
                <span><b>Batch:</b> {r.batch || "N/A"}</span>
                <span><b>Topic:</b> {r.topic}</span>
                <span><b>Date:</b> {formatDate(r.submitted_at)}</span>
              </div>

              {!hasFb && (
                <AiGenerationNotice row={r} generatingIds={aiGeneratingIds} />
              )}
              {r.comment && <p className="text-sm mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245,166,35,0.06)", color: "var(--text-secondary)" }}>Student note: {r.comment}</p>}
              {r.file_url && r.file_name && (
                <div className="flex gap-2 mb-3 flex-wrap items-center">
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{r.original_file_name || r.file_name}</span>
                  {BROWSER_RENDERABLE.has((r.original_file_name || r.file_name).split(".").pop()?.toLowerCase()) && (
                    <a href={r.file_url} target="_blank" className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "var(--accent)", color: "#fff" }}>Open</a>
                  )}
                  <a href={`${r.file_url}?download=${encodeURIComponent(r.original_file_name || r.file_name)}`} target="_blank" className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "var(--primary)", color: "#1a1a1a" }}>Download</a>
                </div>
              )}

              {r.ai_feedback && !hasFb && (
                <div className="mb-4 p-4 rounded-xl" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>AI Draft</p>
                      <AiStatusBadge
                        status={r.ai_feedback ? "ready" : r.ai_status || "ready"}
                        error={publicAiError(r.ai_error)}
                        queuedAt={r.ai_feedback_at}
                        diagnostics={r.ai_evaluation?.diagnostics?.ai_provider}
                      />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button className="btn btn-primary btn-xs" disabled={isAiGeneratingUi(r.ai_status, aiGeneratingIds, r.id) || feedbackSavingId === r.id} onClick={() => saveFeedback(r, r.ai_feedback)}>
                        Approve draft
                      </button>
                      <button className="btn btn-secondary btn-xs" disabled={isAiGeneratingUi(r.ai_status, aiGeneratingIds, r.id)} onClick={() => generateAiDraft(r)}>
                        {aiGenerationButtonLabel(r, aiGeneratingIds, true)}
                      </button>
                      <button className="btn btn-secondary btn-xs" disabled={isAiGeneratingUi(r.ai_status, aiGeneratingIds, r.id)} onClick={() => {
                        setDraftEdits(prev => ({ ...prev, [r.id]: r.ai_feedback }))
                        setEditingDraftId(editingDraftId === r.id ? null : r.id)
                      }}>
                        {editingDraftId === r.id ? "Cancel edit" : "Edit draft"}
                      </button>
                    </div>
                  </div>
                  {editingDraftId === r.id ? (
                    <>
                      <textarea className="input text-sm mb-2" rows={6} value={draftEdits[r.id] ?? r.ai_feedback} onChange={e => setDraftEdits(prev => ({ ...prev, [r.id]: e.target.value }))} />
                      <button className="btn btn-primary btn-sm" disabled={draftSavingId === r.id} onClick={() => saveAiDraftEdit(r)}>
                        {draftSavingId === r.id ? <Spinner size="sm" /> : "Save draft"}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>{r.ai_feedback}</p>
                  )}
                </div>
              )}

              {!r.ai_feedback && !hasFb && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <button className="btn btn-secondary btn-sm" disabled={isAiGeneratingUi(r.ai_status, aiGeneratingIds, r.id)} onClick={() => generateAiDraft(r)}>
                    {aiGenerationButtonLabel(r, aiGeneratingIds)}
                  </button>
                  {(r.ai_status === "failed" || r.ai_status === "pending") && r.ai_error && (
                    <span className="text-xs" style={{ color: "var(--danger)" }} title={publicAiError(r.ai_error)}>{publicAiError(r.ai_error)}</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-xl" style={{ background: "rgba(245,166,35,0.05)", border: "1px solid var(--border)" }}>
                <div>
                  <label className="label text-xs">Points</label>
                  <select className="select text-xs" value={newType} onChange={e => {
                    const selected = e.target.value
                    setSubmissionTypes(prev => ({ ...prev, [r.id]: selected }))
                    if (selected !== "custom") setSubmissionCustomPoints(prev => ({ ...prev, [r.id]: "" }))
                  }}>
                    {POINT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  {newType === "custom" && (
                    <input type="number" min="1" className="input text-xs mt-2" placeholder="Enter custom points" value={customValue} onChange={e => setSubmissionCustomPoints(prev => ({ ...prev, [r.id]: e.target.value }))} />
                  )}
                </div>
                <div>
                  <label className="label text-xs">Phase</label>
                  <select className="select text-xs" value={newPhase} onChange={e => setSubmissionPhases(prev => ({ ...prev, [r.id]: e.target.value }))}>
                    {phaseOptions.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <div className={r.code_text ? "grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4" : "mb-4"}>
                {r.code_text && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Pasted Code</p>
                      <CopyButton text={r.code_text} />
                    </div>
                    <pre className="code-block h-64">{r.code_text}</pre>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>
                    {hasFb ? "Published Feedback" : "Final Feedback"}
                  </p>
                  {hasFb ? (
                    <div className="feedback-box">
                      <p className="text-xs font-semibold mb-1" style={{ color: "var(--success)" }}>By {r.feedback_by || teacherName} {r.feedback_at ? "- " + formatDate(r.feedback_at) : ""}</p>
                      <p className="text-sm whitespace-pre-wrap">{r.feedback}</p>
                    </div>
                  ) : (
                    <>
                      <textarea
                        ref={node => { feedbackEditorRefs.current[r.id] = node }}
                        className="input text-sm mb-2"
                        rows={5}
                        value={feedbackEdits[r.id] ?? r.ai_feedback ?? ""}
                        onChange={e => setFeedbackEdits(prev => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="Write final feedback for this assigned student..."
                      />
                      <button className="btn btn-primary w-full flex items-center justify-center gap-2" onClick={() => saveFeedback(r)} disabled={feedbackSavingId === r.id || !(feedbackEdits[r.id] ?? r.ai_feedback ?? "").trim()}>
                        {feedbackSavingId === r.id ? <Spinner /> : "Publish Feedback"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              </Expander>
            </div>
          )
        })
      )}
      <PaginationControls {...pagination} page={page} onPageChange={setPage} />
      <ToastContainer toasts={toasts} />
    </div>
  )
}
