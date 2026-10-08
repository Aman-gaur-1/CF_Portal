"use client"
import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Tabs from "@/components/ui/Tabs"
import Spinner from "@/components/ui/Spinner"
import ThemeToggle from "@/components/ui/ThemeToggle"
import NotificationBell from "@/components/ui/NotificationBell"
import RefreshButton from "@/components/ui/RefreshButton"
import { ToastContainer, useToast } from "@/components/ui/Toast"
import AdminAiGenerationQueue from "@/components/admin/AdminAiGenerationQueue"
import ReviewProgressByTeacher from "@/components/admin/ReviewProgressByTeacher"
import RecentActivity from "@/components/admin/RecentActivity"
import PhaseManagement from "@/components/admin/PhaseManagement"
import WorkflowSettings from "@/components/admin/WorkflowSettings"
import AdminQueriesPanel from "@/components/admin/AdminQueriesPanel"
import AdminActivityLog from "@/components/admin/AdminActivityLog"
import { useRefreshAction } from "@/lib/use-refresh-action"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People" },
  { id: "ai", label: "AI Ops" },
  { id: "activity", label: "Activity Log" },
  { id: "queries", label: "Queries" },
  { id: "settings", label: "Settings" },
]

const EMPTY_AI_SETTING = {
  id: null,
  provider: "qwen",
  provider_label: "Qwen",
  model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
  base_url: "https://integrate.api.nvidia.com/v1",
  infrastructure: "NVIDIA",
  api_key: "",
  masked_key_preview: null,
  enabled: true,
  priority: 1,
  is_active: false,
  last_test_success: false,
}

const PRIMARY_AI_SETTING = {
  ...EMPTY_AI_SETTING,
  slot: "primary",
  role: "Primary",
  is_active: true,
  priority: 1,
}

const BACKUP_AI_SETTING = {
  ...EMPTY_AI_SETTING,
  slot: "backup",
  role: "Backup",
  provider: "openrouter",
  provider_label: "OpenRouter",
  model: "",
  base_url: "https://openrouter.ai/api/v1",
  infrastructure: "OpenRouter",
  is_active: false,
  priority: 2,
}

const AI_GENERATION_MODES = [
  { id: "auto", label: "Auto" },
  { id: "primary", label: "Force Primary" },
  { id: "backup", label: "Force Backup" },
]

const EMPTY_ADMIN_METRICS = {
  totalAssignments: 0,
  totalReviewed: 0,
  pendingReviews: 0,
  reviewCompletionRate: 0,
  aiReady: 0,
  aiFailed: 0,
  aiFinished: 0,
  successRate: null,
  todayRequests: 0,
  generatedToday: 0,
  failedToday: 0,
  pendingQueue: 0,
}

function SectionTitle({ title, detail }) {
  return (
    <div className="section-divider">
      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</span>
      <div className="line" />
      {detail && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{detail}</span>}
    </div>
  )
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-num">{value}</div>
      {hint && <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  )
}

function SoftBadge({ children, tone = "pending" }) {
  const cls = tone === "done" ? "badge-done" : tone === "failed" ? "badge-failed" : "badge-pending"
  return <span className={cls}>{children}</span>
}

function providerReliabilityTone(successPercent) {
  if (successPercent >= 90) return "healthy"
  if (successPercent >= 75) return "warning"
  return "poor"
}

function formatLastUsed(value) {
  if (!value) return "No timestamp"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "No timestamp"
  const elapsed = Date.now() - date.getTime()
  const minutes = Math.max(Math.round(elapsed / 60000), 0)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 12) return `${hours} hours ago`
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return `Today ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function formatLatency(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value <= 0) return "Not available"
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(1)} s`
}

function modelDisplayName(model) {
  const raw = String(model || "Unknown model")
  const last = raw.split("/").pop() || raw
  return last
    .replace(/^glm/i, "GLM")
    .replace(/mistral-small/i, "Mistral Small")
    .replace(/kimi/i, "Kimi")
    .replace(/deepseek/i, "DeepSeek")
    .replace(/-/g, " ")
}

function providerStatus(provider) {
  if (provider.enabled === false) return { label: "Disabled", tone: "pending" }
  if (provider.failed > 0 && provider.generated === 0) return { label: "Failed", tone: "failed" }
  if (provider.success_percent >= 90) return { label: "Healthy", tone: "done" }
  return { label: "Warning", tone: "pending" }
}

function providerIcon(provider) {
  const label = String(provider.final_provider_name || provider.provider_label || provider.provider || "AI").trim()
  if (/openrouter/i.test(label)) return "OR"
  if (/nvidia|nemotron|qwen/i.test(label)) return "NV"
  if (/step/i.test(label)) return "ST"
  return label.slice(0, 2).toUpperCase()
}

function ProviderHealthCard({ provider }) {
  const [open, setOpen] = useState(false)
  const tone = providerReliabilityTone(provider.success_percent)
  const status = providerStatus(provider)
  function toggle() {
    setOpen(value => !value)
  }
  return (
    <div
      className={`provider-health-card provider-health-${tone}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          toggle()
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="provider-icon" aria-hidden>{providerIcon(provider)}</span>
          <div className="min-w-0">
            <p className="font-semibold">{provider.final_provider_name || provider.provider_label}</p>
            <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>{modelDisplayName(provider.model)}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <SoftBadge tone={status.tone}>{status.label}</SoftBadge>
          <SoftBadge tone={provider.is_active || provider.slot === "primary" ? "done" : "pending"}>{provider.is_active || provider.slot === "primary" ? "Primary" : "Backup"}</SoftBadge>
          <span className="provider-health-dot" aria-label={`${tone} reliability`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="admin-queue-metric"><span>Success Rate</span><b>{provider.success_percent}%</b></div>
        <div className="admin-queue-metric"><span>Avg Response</span><b>{formatLatency(provider.avg_latency_ms)}</b></div>
      </div>
      <p className="provider-expand-label">{open ? "Collapse" : "Expand"}</p>
      {open && (
        <div className="provider-details mt-3">
          <div className="admin-summary-row"><span>Provider</span><b>{provider.final_provider_name || provider.provider_label}</b></div>
          <div className="admin-summary-row"><span>Model</span><b>{modelDisplayName(provider.model)}</b></div>
          <div className="admin-summary-row"><span>Base URL</span><b>{provider.base_url || "Not stored"}</b></div>
          <div className="admin-summary-row"><span>Model ID</span><b>{provider.model || "Unknown"}</b></div>
          <div className="admin-summary-row"><span>Generation Mode</span><b>{provider.generation_mode || "auto"}</b></div>
          <div className="admin-summary-row"><span>Timeout</span><b>Runtime default</b></div>
          <div className="admin-summary-row"><span>Last Success</span><b>{formatLastUsed(provider.last_success_at)}</b></div>
          <div className="admin-summary-row"><span>Last Failure</span><b>{formatLastUsed(provider.last_failure_at)}</b></div>
          <div className="admin-summary-row"><span>Provider Diagnostics</span><b>{provider.diagnostics?.last_test_message || "No test message"}</b></div>
          <div className="admin-summary-row"><span>Fallback History</span><b>{provider.fallback_used_count ? `${provider.fallback_used_count} fallback events` : "No fallback events"}</b></div>
          <div className="admin-summary-row"><span>Average Response Time</span><b>{formatLatency(provider.avg_latency_ms)}</b></div>
          <div className="admin-summary-row"><span>Generated</span><b>{provider.generated}</b></div>
          <div className="admin-summary-row"><span>Failed</span><b>{provider.failed}</b></div>
          <div className="admin-summary-row"><span>Success %</span><b>{provider.success_percent}%</b></div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ children }) {
  return <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>{children}</p>
}

function RowShell({ children }) {
  return (
    <div className="admin-row">
      {children}
    </div>
  )
}

export default function AdminDashboard({ adminName, adminToken, onLogout }) {
  const [tab, setTab] = useState("overview")
  const [globalSearch, setGlobalSearch] = useState("")
  const [students, setStudents] = useState([])
  const [batches, setBatches] = useState([])
  const [trainers, setTrainers] = useState([])
  const [metrics, setMetrics] = useState(EMPTY_ADMIN_METRICS)
  const [batchStats, setBatchStats] = useState({})
  const [studentSubmissionCounts, setStudentSubmissionCounts] = useState({})
  const [submissions, setSubmissions] = useState([])
  const [expandedStudentId, setExpandedStudentId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [aiRuntime, setAiRuntime] = useState(null)
  const [aiHealth, setAiHealth] = useState({ providers: [], unattributed_failures: 0 })
  const [primaryProviderForm, setPrimaryProviderForm] = useState(PRIMARY_AI_SETTING)
  const [backupProviderForm, setBackupProviderForm] = useState(BACKUP_AI_SETTING)
  const [aiGenerationMode, setAiGenerationMode] = useState("auto")
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false)
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false)
  const [aiTestingId, setAiTestingId] = useState(null)
  const [aiTestResult, setAiTestResult] = useState(null)
  const [newTrainer, setNewTrainer] = useState("")
  const [newBatch, setNewBatch] = useState("")
  const [batchTrainer, setBatchTrainer] = useState("")
  const [deleteBatchTarget, setDeleteBatchTarget] = useState(null)
  const [studentSearch, setStudentSearch] = useState("")
  const [studentBatchFilter, setStudentBatchFilter] = useState("All Batches")
  const [editingStudentId, setEditingStudentId] = useState(null)
  const [studentProfileForm, setStudentProfileForm] = useState({ name: "", batch: "", password: "" })
  const [activityRefreshKey, setActivityRefreshKey] = useState(0)
  const { toasts, success, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [])

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true)

    try {
      const res = await fetch("/api/admin-dashboard", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load admin dashboard.")

      setStudents(data.students || [])
      setBatches(data.batches || [])
      setTrainers(data.trainers || [])
      setMetrics({ ...EMPTY_ADMIN_METRICS, ...(data.metrics || {}) })
      setBatchStats(data.batchStats || {})
      setStudentSubmissionCounts(data.studentSubmissionCounts || {})
      setSubmissions(data.submissions || [])

      const firstTrainer =
        data.trainers?.[0]?.name ||
        data.batches?.find(batch => batch.created_by)?.created_by ||
        adminName
      if (!batchTrainer && firstTrainer) setBatchTrainer(firstTrainer)
    } catch (err) {
      showError(err.message || "Could not load admin dashboard.")
    }

    setLoading(false)
    await loadAiSettings()
  }

  const refreshAction = useRefreshAction({
    onRefresh: () => load({ silent: true }),
    onSuccess: success,
    onError: showError,
  })

  async function loadAiSettings() {
    if (!adminToken) return
    setAiSettingsLoading(true)
    try {
      const res = await fetch("/api/admin-ai-settings", {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load AI settings.")
      const rows = data.settings || []
      setAiRuntime(data.runtime || null)
      setAiHealth(data.health || { providers: [], unattributed_failures: 0 })
      setAiGenerationMode(data.generationMode || "auto")
      setPrimaryProviderForm({ ...PRIMARY_AI_SETTING, ...(rows.find(row => row.slot === "primary") || rows.find(row => row.is_active) || {}), api_key: "" })
      setBackupProviderForm({ ...BACKUP_AI_SETTING, ...(rows.find(row => row.slot === "backup") || rows.find(row => !row.is_active) || {}), api_key: "" })
    } catch (err) {
      showError(err.message || "Could not load AI settings.")
    } finally {
      setAiSettingsLoading(false)
    }
  }

  const trainerNames = useMemo(() => {
    return [...new Set([
      adminName,
      ...trainers.map(t => t.name),
      ...batches.map(b => b.created_by),
    ].filter(Boolean))]
  }, [adminName, trainers, batches])

  const batchRows = useMemo(() => {
    return batches.map(batch => {
      const batchStudents = students.filter(student => student.batch === batch.name)
      const stats = batchStats[batch.name] || {}
      return {
        ...batch,
        studentCount: batchStudents.length,
        submissionCount: stats.submissionCount || 0,
        pendingCount: stats.pendingCount || 0,
      }
    })
  }, [batchStats, batches, students])

  const filteredStudents = useMemo(() => {
    const search = (studentSearch || globalSearch).trim().toLowerCase()
    return students.filter(student => {
      const matchesSearch = !search || student.name?.toLowerCase().includes(search)
      const matchesBatch = studentBatchFilter === "All Batches" || student.batch === studentBatchFilter
      return matchesSearch && matchesBatch
    })
  }, [students, studentSearch, globalSearch, studentBatchFilter])

  function providerDefaults(provider) {
    if (provider === "openrouter") return { base_url: "https://openrouter.ai/api/v1", infrastructure: "OpenRouter" }
    if (provider === "step") return { base_url: "https://api.stepfun.com/v1", infrastructure: "Step official" }
    return { base_url: "https://integrate.api.nvidia.com/v1", infrastructure: "NVIDIA" }
  }

  function providerLabel(provider) {
    if (provider === "qwen") return "Qwen"
    if (provider === "nemotron") return "Nemotron"
    if (provider === "openrouter") return "OpenRouter"
    if (provider === "step") return "Step"
    return provider
  }

  function providerHealth(setting) {
    if (!setting?.last_tested_at) return "untested"
    if (setting?.last_test_success) return "healthy"
    const message = String(setting?.last_test_message || "")
    return /timeout/i.test(message) ? "slow" : "failed"
  }

  function activeGenerationProviderLabel() {
    if (aiGenerationMode === "backup") return providerLabel(backupProviderForm.provider)
    if (aiGenerationMode === "primary") return providerLabel(primaryProviderForm.provider)
    return providerLabel(primaryProviderForm.provider)
  }

  function generationModeLabel() {
    return AI_GENERATION_MODES.find(mode => mode.id === aiGenerationMode)?.label || "Auto"
  }

  function healthTone(status) {
    if (status === "healthy") return "done"
    if (status === "failed") return "failed"
    return "pending"
  }

  function changeProviderSlot(slot, provider) {
    const defaults = providerDefaults(provider)
    const setter = slot === "primary" ? setPrimaryProviderForm : setBackupProviderForm
    setter(prev => ({
      ...prev,
      provider,
      provider_label: providerLabel(provider),
      base_url: prev.id ? prev.base_url : defaults.base_url,
      infrastructure: defaults.infrastructure,
    }))
  }

  function editProviderSlot(slot, field, value) {
    const setter = slot === "primary" ? setPrimaryProviderForm : setBackupProviderForm
    setter(prev => ({ ...prev, [field]: value }))
  }

  async function saveProviderSlot(slot) {
    if (!adminToken) { showError("Please log in again to manage AI settings."); return }
    const setting = slot === "primary" ? primaryProviderForm : backupProviderForm
    if (!setting.provider.trim() || !setting.model.trim() || !setting.base_url.trim()) {
      showError("Provider, model, and base URL are required.")
      return
    }

    setAiSettingsSaving(true)
    try {
      const res = await fetch("/api/admin-ai-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          ...setting,
          slot,
          enabled: true,
          is_active: slot === "primary",
          priority: slot === "primary" ? 1 : 2,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save AI provider.")
      success(`${slot === "primary" ? "Primary" : "Backup"} provider saved.`)
      await loadAiSettings()
    } catch (err) {
      showError(err.message || "Could not save AI provider.")
    } finally {
      setAiSettingsSaving(false)
    }
  }

  async function testProviderSlot(slot) {
    if (!adminToken) { showError("Please log in again to test AI settings."); return }
    const setting = slot === "primary" ? primaryProviderForm : backupProviderForm
    setAiTestingId(slot)
    setAiTestResult(null)
    try {
      const res = await fetch("/api/admin-ai-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(setting),
      })
      const data = await res.json().catch(() => ({}))
      setAiTestResult(data)
      if (!res.ok || !data.ok) throw new Error(data.message || data.error || "AI provider test failed.")
      success(`${slot === "primary" ? "Primary" : "Backup"} connection succeeded.`)
      await loadAiSettings()
    } catch (err) {
      showError(err.message || "AI provider test failed.")
    } finally {
      setAiTestingId(null)
    }
  }

  async function saveGenerationMode(mode) {
    if (!adminToken) { showError("Please log in again to manage AI settings."); return }
    if (mode === aiGenerationMode) return

    const previousMode = aiGenerationMode
    setAiGenerationMode(mode)
    setAiSettingsSaving(true)
    try {
      const res = await fetch("/api/admin-ai-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: "generation_mode", generationMode: mode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save AI generation mode.")
      setAiGenerationMode(data.generationMode || mode)
      success("AI generation mode updated.")
      await loadAiSettings()
    } catch (err) {
      setAiGenerationMode(previousMode)
      showError(err.message || "Could not save AI generation mode.")
    } finally {
      setAiSettingsSaving(false)
    }
  }

  async function addTrainer() {
    const name = newTrainer.trim()
    if (!name) { showError("Teacher name is required."); return }
    if (trainerNames.includes(name)) { showError("Teacher already exists."); return }

    setSaving(true)
    const { error } = await supabase.from("trainers").insert({ name, created_by: adminName })
    setSaving(false)
    if (error) { showError("Could not add teacher."); return }
    recordRosterActivity("teacher_created", name)
    setNewTrainer("")
    success("Teacher added.")
    load({ silent: true })
  }

  async function deleteTrainer(name) {
    if (!name || name === adminName) return

    setSaving(true)
    const [{ error: batchError }, { error: trainerError }] = await Promise.all([
      supabase.from("batches").update({ created_by: "" }).eq("created_by", name),
      supabase.from("trainers").delete().eq("name", name),
    ])
    setSaving(false)
    if (batchError || trainerError) { showError("Could not remove teacher."); return }
    recordRosterActivity("teacher_deactivated", name)
    success("Teacher removed and batches unassigned.")
    load({ silent: true })
  }

  async function recordRosterActivity(eventType, teacherName) {
    try {
      await fetch("/api/admin-activity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ eventType, teacherName }),
      })
      setActivityRefreshKey(key => key + 1)
    } catch (err) {
      console.warn("[admin-activity] roster activity failed", err.message)
    }
  }

  async function addBatch() {
    const name = newBatch.trim()
    if (!name) { showError("Batch name is required."); return }
    if (!batchTrainer.trim()) { showError("Assign a teacher first."); return }

    setSaving(true)
    const { error } = await supabase.from("batches").insert({
      name,
      created_by: batchTrainer.trim(),
      created_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { showError(error.message?.includes("duplicate") ? "Batch already exists." : "Could not add batch."); return }
    setNewBatch("")
    success("Batch created.")
    load({ silent: true })
  }

  async function assignBatch(batchId, trainerName) {
    const { error } = await supabase.from("batches").update({ created_by: trainerName }).eq("id", batchId)
    if (error) { showError("Could not assign teacher."); return }
    success("Batch assignment updated.")
    load({ silent: true })
  }

  async function deleteBatch() {
    if (!deleteBatchTarget || saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin-batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ batchId: deleteBatchTarget.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not delete batch.")
      success(`Batch “${deleteBatchTarget.name}” deleted.`)
      setDeleteBatchTarget(null)
      load({ silent: true })
    } catch (error) {
      showError(error.message || "Could not delete batch.")
    } finally {
      setSaving(false)
    }
  }

  async function moveStudent(studentId, batchName) {
    const student = students.find(row => row.id === studentId)
    if (!student) return
    await saveStudentProfile({ studentId, name: student.name, batch: batchName, password: "" }, "Student batch updated.")
  }

  function openStudentProfile(student) {
    setEditingStudentId(student.id)
    setStudentProfileForm({ name: student.name || "", batch: student.batch || "", password: "" })
  }

  function closeStudentProfile() {
    setEditingStudentId(null)
    setStudentProfileForm({ name: "", batch: "", password: "" })
  }

  async function saveStudentProfile(profile = studentProfileForm, message = "Student profile updated.") {
    if (!adminToken) { showError("Please log in again to edit students."); return }
    const studentId = profile.studentId || editingStudentId
    if (!studentId) return

    setSaving(true)
    try {
      const res = await fetch("/api/admin-student-profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ ...profile, studentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not update student profile.")
      success(message)
      closeStudentProfile()
      load({ silent: true })
    } catch (err) {
      showError(err.message || "Could not update student profile.")
    } finally {
      setSaving(false)
    }
  }

  function renderOverview() {
    return (
      <div className="grid gap-5">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <MetricCard label="Total Students" value={students.length} hint={`${batches.length} batches`} />
          <MetricCard label="Total Teachers" value={trainerNames.length} hint="Active roster" />
          <MetricCard label="Total Assignments" value={metrics.totalAssignments} hint={`${metrics.totalReviewed} reviewed - ${metrics.pendingReviews} pending`} />
          <MetricCard label="Total Reviewed" value={metrics.totalReviewed} hint={`${metrics.reviewCompletionRate}% completion rate`} />
          <MetricCard label="Pending Reviews" value={metrics.pendingReviews} hint="Need attention" />
          <MetricCard label="AI Draft Failures" value={metrics.aiFailed} hint="Can retry" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReviewProgressByTeacher adminToken={adminToken} />

          <div className="card admin-panel">
            <SectionTitle title="AI Health" detail="Recent signal" />
            <div className="grid gap-3">
              <div className="admin-summary-row">
                <span>Generation success rate</span>
                <b>{metrics.aiFinished ? `${metrics.successRate}%` : "No runs"}</b>
              </div>
              <div className="admin-summary-row">
                <span>Last active provider</span>
                <b>{aiRuntime?.last_active_provider || "None yet"}</b>
              </div>
              <div className="admin-summary-row">
                <span>Last fallback</span>
                <b>{aiRuntime?.last_fallback_used ? "Used backup" : "Not used"}</b>
              </div>
            </div>
          </div>
        </div>

        <RecentActivity adminToken={adminToken} refreshKey={activityRefreshKey} success={success} showError={showError} />
      </div>
    )
  }

  function renderPeople() {
    return (
      <div className="grid gap-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card admin-panel">
            <SectionTitle title="Teachers" detail={`${trainerNames.length} total`} />
            <div className="flex gap-2 mb-4">
              <input className="input" value={newTrainer} onChange={e => setNewTrainer(e.target.value)} placeholder="Teacher name" />
              <button className="btn btn-primary btn-sm" onClick={addTrainer} disabled={saving}>Add</button>
            </div>
            <div className="grid gap-2">
              {trainerNames.filter(name => !globalSearch.trim() || name.toLowerCase().includes(globalSearch.trim().toLowerCase())).map(name => (
                <RowShell key={name}>
                  <span className="font-semibold">{name}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => deleteTrainer(name)} disabled={saving || name === adminName}>
                    {name === adminName ? "Admin" : "Remove"}
                  </button>
                </RowShell>
              ))}
            </div>
          </div>

          <div className="card admin-panel">
            <SectionTitle title="Batches" detail={`${batches.length} total`} />
            <div className="grid gap-2 mb-4 md:grid-cols-[1fr_1fr_auto]">
              <input className="input" value={newBatch} onChange={e => setNewBatch(e.target.value)} placeholder="Batch name" />
              <select className="select" value={batchTrainer} onChange={e => setBatchTrainer(e.target.value)}>
                {trainerNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={addBatch} disabled={saving}>Create</button>
            </div>
            <div className="grid gap-2">
              {batchRows.filter(batch => !globalSearch.trim() || `${batch.name} ${batch.created_by || ""}`.toLowerCase().includes(globalSearch.trim().toLowerCase())).map(batch => (
                <RowShell key={batch.id}>
                  <div>
                    <p className="font-semibold">{batch.name}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{batch.studentCount} students - {batch.pendingCount} pending</p>
                  </div>
                  <div className="admin-batch-actions">
                    <select className="select text-sm max-w-[220px]" value={batch.created_by || ""} onChange={e => assignBatch(batch.id, e.target.value)}>
                      <option value="">Unassigned</option>
                      {trainerNames.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <button className="btn btn-danger-outline btn-sm" type="button" onClick={() => setDeleteBatchTarget(batch)} disabled={saving} aria-label={`Delete ${batch.name}`}>Delete</button>
                  </div>
                </RowShell>
              ))}
            </div>
          </div>
        </div>

        <div className="card admin-panel">
          <SectionTitle title="Students" detail={`${filteredStudents.length} visible`} />
          <div className="grid gap-3 md:grid-cols-2 mb-4">
            <input className="input" value={studentSearch} onChange={e => setStudentSearch(e.target.value)} placeholder="Search students" />
            <select className="select" value={studentBatchFilter} onChange={e => setStudentBatchFilter(e.target.value)}>
              <option>All Batches</option>
              {batches.map(batch => <option key={batch.id}>{batch.name}</option>)}
            </select>
          </div>

          {filteredStudents.length === 0 ? <EmptyState>No students found.</EmptyState> : (
            <div className="grid gap-2">
              {filteredStudents.slice(0, 100).map(student => {
                const count = studentSubmissionCounts[String(student.id)] || 0
                const studentSubmissions = submissions.filter(row => String(row.student_id) === String(student.id))
                const expanded = expandedStudentId === student.id
                return (
                  <div key={student.id} className="admin-row">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{student.name}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{student.batch || "No batch"} - {count} submissions</p>
                      {count > 0 && <button type="button" className="admin-student-submissions-toggle" onClick={() => setExpandedStudentId(expanded ? null : student.id)}>{expanded ? "Hide submissions" : "View submissions"}</button>}
                      {expanded && <div className="admin-student-submissions">
                        {studentSubmissions.map(submission => <div className="admin-student-submission" key={submission.id}>
                          <div><b>{submission.topic || "Untitled assignment"}</b><span>{submission.phase || submission.submission_type || "Assignment"}</span></div>
                          <span className={submission.feedback || submission.feedback_at ? "badge-done" : submission.ai_status === "failed" ? "badge-failed" : "badge-pending"}>{submission.feedback || submission.feedback_at ? "Reviewed" : submission.ai_status === "failed" ? "AI Failed" : "Pending"}</span>
                        </div>)}
                      </div>}
                      {editingStudentId === student.id && (
                        <div className="grid gap-2 mt-3 md:grid-cols-3">
                          <input className="input" value={studentProfileForm.name} onChange={e => setStudentProfileForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Student name" />
                          <select className="select" value={studentProfileForm.batch} onChange={e => setStudentProfileForm(prev => ({ ...prev, batch: e.target.value }))}>
                            <option value="">No batch</option>
                            {batches.map(batch => <option key={batch.id} value={batch.name}>{batch.name}</option>)}
                          </select>
                          <input type="password" className="input" value={studentProfileForm.password} onChange={e => setStudentProfileForm(prev => ({ ...prev, password: e.target.value }))} placeholder="New password (optional)" autoComplete="new-password" />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      {editingStudentId === student.id ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => saveStudentProfile()} disabled={saving}>Save</button>
                          <button className="btn btn-secondary btn-sm" onClick={closeStudentProfile} disabled={saving}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <select className="select text-sm max-w-[180px]" value={student.batch || ""} onChange={e => moveStudent(student.id, e.target.value)} disabled={saving}>
                            <option value="">No batch</option>
                            {batches.map(batch => <option key={batch.id} value={batch.name}>{batch.name}</option>)}
                          </select>
                          <button className="btn btn-secondary btn-sm" onClick={() => openStudentProfile(student)}>Edit Profile</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {deleteBatchTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.45)" }} role="dialog" aria-modal="true" aria-label="Delete batch confirmation">
          <div className="card p-5 w-full max-w-md">
            <p className="text-base font-semibold">Delete batch?</p>
            <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
              You are about to delete <b>{deleteBatchTarget.name}</b>. Batches containing students or submissions cannot be deleted.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setDeleteBatchTarget(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-danger-outline btn-sm" type="button" onClick={deleteBatch} disabled={saving}>{saving ? "Checking..." : "Delete batch"}</button>
            </div>
          </div>
        </div>
      )}
    )
  }

  function renderAiOps() {
    return (
      <div className="grid gap-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="AI Success Rate" value={metrics.aiFinished ? `${metrics.successRate}%` : "No runs"} hint={`${metrics.aiReady} ready / ${metrics.aiFailed} failed`} />
          <MetricCard label="Pending Queue" value={metrics.pendingQueue || 0} hint="Missing AI drafts" />
          <MetricCard label="Primary Provider" value={providerLabel(primaryProviderForm.provider)} hint={primaryProviderForm.model || "No model set"} />
          <MetricCard label="Fallback Status" value={aiRuntime?.last_fallback_used ? "Used" : "Idle"} hint={aiRuntime?.last_fallback_from?.length ? aiRuntime.last_fallback_from.join(", ") : "Primary handled last run"} />
        </div>

        <div className="card admin-panel">
          <SectionTitle title="AI Provider Health" detail="Production drafts only" />
          {aiSettingsLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : aiHealth.providers.length === 0 ? (
            <EmptyState>No provider usage diagnostics are available yet.</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {aiHealth.providers.map(provider => (
                <ProviderHealthCard key={`${provider.provider}:${provider.model}`} provider={provider} />
              ))}
            </div>
          )}
          {aiHealth.unattributed_failures > 0 && (
            <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
              {aiHealth.unattributed_failures} failed {aiHealth.unattributed_failures === 1 ? "draft has" : "drafts have"} no stored provider diagnostics.
            </p>
          )}
        </div>

        <AdminAiGenerationQueue adminToken={adminToken} success={success} showError={showError} globalSearch={globalSearch} onQueued={() => setActivityRefreshKey(key => key + 1)} />
      </div>
    )
  }

  function ProviderSlotForm({ slot, title, setting, badge }) {
    const health = providerHealth(setting)
    return (
      <div className="provider-card">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="font-semibold">{title}</p>
            <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>{setting.provider_label || providerLabel(setting.provider)} - {setting.model || "No model set"}</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <SoftBadge tone={slot === "primary" ? "done" : "pending"}>{badge}</SoftBadge>
            <SoftBadge tone={healthTone(health)}>{health}</SoftBadge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Provider</label>
            <select className="select" value={setting.provider || "qwen"} onChange={e => changeProviderSlot(slot, e.target.value)}>
              <option value="qwen">Qwen / NVIDIA</option>
              <option value="openrouter">OpenRouter</option>
              <option value="nemotron">Nemotron / NVIDIA</option>
              <option value="step">Step</option>
            </select>
          </div>
          <div>
            <label className="label">Model</label>
            <input className="input" value={setting.model || ""} onChange={e => editProviderSlot(slot, "model", e.target.value)} placeholder={slot === "primary" ? "nvidia/llama-3.1-nemotron-nano-8b-v1" : "openrouter model id"} />
          </div>
        </div>

        <div className="grid gap-3 mt-3">
          <div>
            <label className="label">Base URL</label>
            <input className="input" value={setting.base_url || ""} onChange={e => editProviderSlot(slot, "base_url", e.target.value)} placeholder={slot === "primary" ? "https://integrate.api.nvidia.com/v1" : "https://openrouter.ai/api/v1"} />
          </div>
          <div>
            <label className="label">API Key</label>
            <input className="input" type="password" value={setting.api_key || ""} onChange={e => editProviderSlot(slot, "api_key", e.target.value)} placeholder={setting.masked_key_preview ? `Stored: ${setting.masked_key_preview}` : "Paste key to store encrypted"} autoComplete="new-password" />
            <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>
              {setting.last_test_message ? `Last test: ${setting.last_test_message}` : "Last test: untested"}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap mt-4">
          <button className="btn btn-primary btn-sm" onClick={() => saveProviderSlot(slot)} disabled={aiSettingsSaving}>
            {aiSettingsSaving ? <Spinner size="sm" /> : "Save"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => testProviderSlot(slot)} disabled={aiTestingId !== null}>
            {aiTestingId === slot ? <Spinner size="sm" /> : "Test Connection"}
          </button>
        </div>
      </div>
    )
  }

  function renderSettings() {
    return (
      <div className="grid gap-5">
        <div className="card admin-panel">
          <SectionTitle title="AI Providers" detail="Primary and backup only" />
          {aiSettingsLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="grid gap-4">
              <div className="admin-generation-mode">
                <div className="min-w-0">
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>AI Generation Mode</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    Active: {activeGenerationProviderLabel()} ({generationModeLabel()})
                  </p>
                </div>
                <div className="admin-segmented" role="group" aria-label="AI generation mode">
                  {AI_GENERATION_MODES.map(mode => (
                    <button
                      key={mode.id}
                      type="button"
                      className={mode.id === aiGenerationMode ? "is-active" : ""}
                      onClick={() => saveGenerationMode(mode.id)}
                      disabled={aiSettingsSaving}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ProviderSlotForm slot="primary" title="Primary Provider" setting={primaryProviderForm} badge="Primary" />
                <ProviderSlotForm slot="backup" title="Backup Provider" setting={backupProviderForm} badge="Active Backup" />
              </div>
            </div>
          )}

          {aiTestResult && (
            <div className="admin-note mt-4" style={{ color: aiTestResult.ok ? "var(--success)" : "var(--danger)" }}>
              <p className="font-semibold">{aiTestResult.ok ? "Connection OK" : "Connection Failed"}</p>
              <p className="mt-1" style={{ color: "var(--text-secondary)" }}>{aiTestResult.message || aiTestResult.error}</p>
            </div>
          )}
        </div>

        <div className="card admin-panel">
          <SectionTitle title="Routes" detail="Quick access" />
          <div className="grid gap-3 md:grid-cols-3">
            <a className="btn btn-secondary" href="/">Student Portal</a>
            <a className="btn btn-secondary" href="/teacher">Teacher Portal</a>
            <a className="btn btn-primary" href="/admin">Admin Portal</a>
          </div>
        </div>

        <WorkflowSettings adminToken={adminToken} success={success} showError={showError} />
        <PhaseManagement adminToken={adminToken} success={success} showError={showError} />
      </div>
    )
  }

  return (
    <div className="min-h-screen admin-shell" style={{ background: "var(--bg-main)" }}>
      <div className="max-w-6xl mx-auto">
        <div className="admin-header">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>ConsoleFlare Admin</h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{adminName} - operations and review control</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <NotificationBell userType="admin" authToken={adminToken} />
            <ThemeToggle />
            <RefreshButton onClick={refreshAction.refresh} refreshing={refreshAction.refreshing} updatedLabel={refreshAction.updatedLabel} />
            <button className="btn btn-secondary btn-sm" onClick={onLogout}>Logout</button>
          </div>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <div className="teacher-global-search admin-global-search" role="search">
          <span aria-hidden>⌕</span>
          <input value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} placeholder="Search students, teachers, batches, assignments, or activity..." aria-label="Search across admin portal" />
          {globalSearch && <button type="button" onClick={() => setGlobalSearch("")} aria-label="Clear search">×</button>}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : (
          <>
            {tab === "overview" && renderOverview()}
            {tab === "people" && renderPeople()}
            {tab === "ai" && renderAiOps()}
            {tab === "activity" && <AdminActivityLog adminToken={adminToken} success={success} showError={showError} globalSearch={globalSearch} />}
            {tab === "queries" && <AdminQueriesPanel adminToken={adminToken} showError={showError} globalSearch={globalSearch} />}
            {tab === "settings" && renderSettings()}
          </>
        )}
      </div>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
