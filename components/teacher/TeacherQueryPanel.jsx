"use client"
import { useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { formatDate } from "@/lib/utils"

export default function TeacherQueryPanel({ enabled, submissionId, queries = [], teacherToken, onResolved, onError, onSuccess }) {
  const [responses, setResponses] = useState({})
  const [savingId, setSavingId] = useState(null)

  const submissionQueries = useMemo(() => {
    return queries
      .filter(query => String(query.submission_id) === String(submissionId))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [queries, submissionId])

  if (!enabled || submissionQueries.length === 0) return null

  async function resolveQuery(query) {
    const trainerResponse = (responses[query.id] || query.trainer_response || "").trim()
    if (!trainerResponse) {
      onError?.("Response cannot be empty.")
      return
    }

    setSavingId(query.id)
    try {
      const res = await fetch("/api/teacher-queries", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${teacherToken}`,
        },
        body: JSON.stringify({ queryId: query.id, trainerResponse }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not resolve query.")
      onResolved?.(data.query)
      onSuccess?.("Query resolved.")
    } catch (err) {
      onError?.(err.message || "Could not resolve query.")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div
      className="mb-4 p-4 rounded-xl"
      style={{
        background: "linear-gradient(135deg,rgba(239,68,68,0.14),rgba(245,158,11,0.13))",
        border: "2px solid rgba(239,68,68,0.42)",
        boxShadow: "0 14px 32px rgba(239,68,68,0.12)",
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-black uppercase tracking-[0.18em]" style={{ color: "var(--danger)" }}>Student Query</p>
        <span className="badge-query-open">{submissionQueries.filter(query => query.status === "open").length} open</span>
      </div>

      <div className="grid gap-3">
        {submissionQueries.map(query => {
          const resolved = query.status === "resolved"
          return (
            <div key={query.id} className="p-3 rounded-lg" style={{ background: "var(--bg-card)", border: resolved ? "1px solid var(--border)" : "1px solid rgba(239,68,68,0.35)" }}>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className={resolved ? "badge-query-resolved" : "badge-query-open"}>{resolved ? "RESOLVED" : "OPEN"}</span>
                <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Asked: {formatDate(query.created_at)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap mb-3">{query.query_text}</p>
              {resolved ? (
                <div className="feedback-box">
                  <p className="text-xs font-semibold mb-1" style={{ color: "var(--success)" }}>Resolved by {query.resolved_by || "Trainer"} {query.resolved_at ? "- " + formatDate(query.resolved_at) : ""}</p>
                  <p className="text-sm whitespace-pre-wrap">{query.trainer_response}</p>
                </div>
              ) : (
                <div className="grid gap-2">
                  <textarea
                    className="input text-sm"
                    rows={3}
                    value={responses[query.id] ?? ""}
                    onChange={event => setResponses(prev => ({ ...prev, [query.id]: event.target.value }))}
                    placeholder="Respond to the student query..."
                  />
                  <button className="btn btn-primary btn-sm flex items-center justify-center gap-2" type="button" onClick={() => resolveQuery(query)} disabled={savingId === query.id || !(responses[query.id] || "").trim()}>
                    {savingId === query.id ? <Spinner size="sm" /> : "Reply and Mark Resolved"}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
