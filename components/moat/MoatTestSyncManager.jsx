"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

export default function MoatTestSyncManager({ adminToken }) {
  const [competitor, setCompetitor] = useState(null)
  const [sourceProfiles, setSourceProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState("")
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState(null)
  const { toasts, success, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/moat/test-sync", {
        headers: { Authorization: `Bearer ${adminToken}` },
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load sync options.")
      setCompetitor(data.competitor || null)
      setSourceProfiles(data.sourceProfiles || [])
      if (data.sourceProfiles?.[0]?.id) setSelectedProfileId(data.sourceProfiles[0].id)
    } catch (err) {
      showError(err.message || "Could not load sync options.")
    } finally {
      setLoading(false)
    }
  }

  const selectedProfile = useMemo(() => {
    return sourceProfiles.find(profile => profile.id === selectedProfileId) || null
  }, [selectedProfileId, sourceProfiles])

  async function runSync() {
    if (!competitor?.id || !selectedProfileId) {
      showError("Scaler Google Maps source profile is required.")
      return
    }

    setRunning(true)
    setResult(null)
    try {
      const res = await fetch("/api/moat/test-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ competitor_id: competitor.id, source_profile_id: selectedProfileId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not run sync.")
      setResult(data.result || null)
      success("Scaler Google Maps sync finished.")
    } catch (err) {
      showError(err.message || "Could not run sync.")
      setResult({ error: err.message || "Could not run sync." })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="grid gap-5">
      <section className="card admin-panel">
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Controlled POC Scope</p>
        <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
          Only Scaler + Google Maps is enabled here. The sync uses the selected source profile URL, not a competitor-name search.
        </p>
      </section>

      <section className="card admin-panel">
        {loading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div> : (
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label">Competitor</label>
                <input className="input" value={competitor?.name || "Scaler not found"} disabled />
              </div>
              <div>
                <label className="label">Source</label>
                <select className="select" value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)}>
                  {sourceProfiles.map(profile => (
                    <option key={profile.id} value={profile.id}>{profile.source_type} - {profile.active === false ? "inactive" : "active"}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
              {selectedProfile?.profile_url || "Add an active Scaler Google Maps source profile before running sync."}
            </p>
            <div className="flex justify-end">
              <button className="btn btn-primary btn-sm" onClick={runSync} disabled={running || !selectedProfile}>
                {running ? <Spinner /> : "Run Sync"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card admin-panel">
        <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Job Result</p>
        {!result && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No sync has run in this session.</p>}
        {result?.error && <p className="text-sm" style={{ color: "var(--danger)" }}>{result.error}</p>}
        {result && !result.error && (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="admin-note"><b>Job</b><p>{result.job?.status || "-"}</p></div>
            <div className="admin-note"><b>Fetched</b><p>{result.fetchedCount ?? 0}</p></div>
            <div className="admin-note"><b>Inserted</b><p>{result.insertedCount ?? 0}</p></div>
            <div className="admin-note"><b>Duplicates</b><p>{result.duplicateCount ?? 0}</p></div>
          </div>
        )}
        {result?.sampleReview && (
          <div className="admin-note mt-3">
            <p className="font-semibold">Sample stored review</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{result.sampleReview.review_text}</p>
          </div>
        )}
      </section>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
