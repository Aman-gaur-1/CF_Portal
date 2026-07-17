"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import RefreshButton from "@/components/ui/RefreshButton"
import { useRefreshAction } from "@/lib/use-refresh-action"

const DELAY_PRESETS = [
  { label: "10 min", value: 10 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "2 hours", value: 120 },
  { label: "24 hours", value: 1440 },
]

function formatApprovalSummary(data) {
  const reasons = formatApprovalReasons(data)
  const base = `Approved: ${data?.approved ?? data?.published ?? 0}. Skipped: ${data?.skipped || 0}.`
  const duration = data?.duration_ms ? ` Duration: ${(Number(data.duration_ms) / 1000).toFixed(1)} seconds.` : ""
  return reasons ? `${base} Reasons: ${reasons}.${duration}` : `${base}${duration}`
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
    "Will Skip:",
    String(preview?.skipped || 0),
    "",
    "Reasons:",
    reasons || "None",
  ].join("\n")
}

export default function WorkflowSettings({ adminToken, success, showError }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approvalProgress, setApprovalProgress] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [delayMinutes, setDelayMinutes] = useState(30)
  const [defaultPhaseSlug, setDefaultPhaseSlug] = useState("")
  const [approvalPhaseName, setApprovalPhaseName] = useState("")
  const [phases, setPhases] = useState([])

  useEffect(() => {
    load()
  }, [])

  const refreshAction = useRefreshAction({
    onRefresh: load,
    onSuccess: success,
    onError: showError,
  })

  const presetValue = useMemo(() => {
    const current = Number.parseInt(delayMinutes, 10)
    return DELAY_PRESETS.some(preset => preset.value === current) ? String(current) : "custom"
  }, [delayMinutes])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/admin-workflow-settings", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load workflow settings.")
      setEnabled(Boolean(data.autoApproval?.enabled))
      setDelayMinutes(data.autoApproval?.delayMinutes || 30)
      setDefaultPhaseSlug(data.defaultPhase?.slug || "")
      setPhases(data.phases || [])
    } catch (err) {
      showError(err.message || "Could not load workflow settings.")
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    const minutes = Number.parseInt(delayMinutes, 10)
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 10080) {
      showError("Auto approval delay must be between 5 minutes and 10080 minutes.")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin-workflow-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          autoApprovalEnabled: enabled,
          autoApprovalDelay: minutes,
          defaultPhaseSlug,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not save workflow settings.")
      setEnabled(Boolean(data.autoApproval?.enabled))
      setDelayMinutes(data.autoApproval?.delayMinutes || minutes)
      setDefaultPhaseSlug(data.defaultPhase?.slug || defaultPhaseSlug)
      success("Workflow settings saved.")
    } catch (err) {
      showError(err.message || "Could not save workflow settings.")
    } finally {
      setSaving(false)
    }
  }

  async function approveAll() {
    setApproving(true)
    setApprovalProgress("Calculating eligible submissions...")
    try {
      const previewRes = await fetch("/api/admin-workflow-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: "bulk_approve_preview", phase: approvalPhaseName }),
      })
      const preview = await previewRes.json().catch(() => ({}))
      if (!previewRes.ok) throw new Error(preview.error || "Could not preview AI feedback approvals.")
      if (!window.confirm(formatApprovalConfirmation(preview, approvalPhaseName))) return

      setApprovalProgress(`Processing 0 / ${preview.eligible || 0}...`)
      const res = await fetch("/api/admin-workflow-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: "bulk_approve", phase: approvalPhaseName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not approve AI feedback.")
      setApprovalProgress(`Processing ${data?.processed ?? data?.approved ?? 0} / ${preview.eligible || data?.eligible || 0} complete.`)
      success(formatApprovalSummary(data))
    } catch (err) {
      showError(err.message || "Could not approve AI feedback.")
    } finally {
      setApproving(false)
      setTimeout(() => setApprovalProgress(""), 1500)
    }
  }

  return (
    <div className="card admin-panel">
      <div className="section-divider">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Workflow Settings</span>
        <div className="line" />
        {loading && <Spinner size="sm" />}
      </div>

      <div className="grid gap-3 md:grid-cols-[auto_150px_1fr_auto] items-end">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-primary)" }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Auto Approval
        </label>

        <select
          className="select"
          value={presetValue}
          onChange={e => {
            if (e.target.value !== "custom") setDelayMinutes(Number.parseInt(e.target.value, 10))
          }}
        >
          {DELAY_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          <option value="custom">Custom</option>
        </select>

        <input
          className="input"
          type="number"
          min="5"
          max="10080"
          value={delayMinutes}
          onChange={e => setDelayMinutes(e.target.value)}
          placeholder="Delay minutes"
        />

        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || loading}>Save</button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] mt-4">
        <select className="select" value={defaultPhaseSlug} onChange={e => setDefaultPhaseSlug(e.target.value)}>
          {phases.map(phase => <option key={phase.id} value={phase.slug}>{phase.name}</option>)}
        </select>
        <RefreshButton
          onClick={refreshAction.refresh}
          refreshing={refreshAction.refreshing}
          updatedLabel={refreshAction.updatedLabel}
          disabled={loading || saving}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] mt-4 items-center">
        <select
          className="select"
          value={approvalPhaseName}
          onChange={e => setApprovalPhaseName(e.target.value)}
          aria-label="Bulk approval phase"
        >
          <option value="">All Phases</option>
          {phases.map(phase => <option key={phase.id} value={phase.name}>{phase.name}</option>)}
        </select>
        <div className="flex justify-end items-center gap-3 flex-wrap">
        {approvalProgress && (
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            {approvalProgress}
          </span>
        )}
        <button className="btn btn-secondary btn-sm" onClick={approveAll} disabled={approving}>
          {approving ? "Processing..." : "Approve All AI Ready"}
        </button>
        </div>
      </div>
    </div>
  )
}
