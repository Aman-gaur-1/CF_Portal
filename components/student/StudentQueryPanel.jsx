"use client"
import { useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { formatDate } from "@/lib/utils"

export default function StudentQueryPanel({ enabled, student, submissionId, queries = [], onCreated, onError, onSuccess }) {
  const [queryText, setQueryText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submissionQueries = useMemo(() => {
    return queries
      .filter(query => String(query.submission_id) === String(submissionId))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [queries, submissionId])

  if (!enabled) return null

  async function submitQuery() {
    const text = queryText.trim()
    if (!text) {
      onError?.("Query cannot be empty.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/student-queries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${student?.token || ""}`,
        },
        body: JSON.stringify({
          submissionId,
          queryText: text,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not raise query.")
      setQueryText("")
      onCreated?.(data.query)
      onSuccess?.("Query sent to your trainer.")
    } catch (err) {
      onError?.(err.message || "Could not raise query.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 p-4 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-semibold">Queries</p>
        {submissionQueries.some(query => query.status === "open") && <span className="badge-query-open">OPEN</span>}
      </div>

      <div className="grid gap-2 mb-4">
        <textarea
          className="input text-sm"
          rows={3}
          value={queryText}
          onChange={event => setQueryText(event.target.value)}
          placeholder="Ask your trainer about this feedback..."
        />
        <button className="btn btn-secondary btn-sm flex items-center justify-center gap-2" type="button" onClick={submitQuery} disabled={submitting || !queryText.trim()}>
          {submitting ? <Spinner size="sm" /> : "Raise Query"}
        </button>
      </div>

      {submissionQueries.length > 0 && (
        <div className="grid gap-2">
          {submissionQueries.map(query => (
            <div key={query.id} className="p-3 rounded-lg" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className={query.status === "resolved" ? "badge-query-resolved" : "badge-query-open"}>{query.status === "resolved" ? "RESOLVED" : "OPEN"}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{formatDate(query.created_at)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{query.query_text}</p>
              {query.trainer_response && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: "var(--success)" }}>Trainer response {query.resolved_at ? "- " + formatDate(query.resolved_at) : ""}</p>
                  <p className="text-sm whitespace-pre-wrap">{query.trainer_response}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
