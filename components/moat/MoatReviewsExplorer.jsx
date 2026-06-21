"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"

const PAGE_SIZE = 25
const EMPTY_FILTERS = {
  competitor_id: "all",
  source_id: "all",
  rating: "all",
  start_date: "",
  end_date: "",
  search: "",
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

function ratingText(value) {
  const rating = Number(value)
  return Number.isFinite(rating) ? `${rating.toFixed(rating % 1 ? 1 : 0)} / 5` : "-"
}

function truncate(value, length = 180) {
  const text = String(value || "").trim()
  if (text.length <= length) return text
  return `${text.slice(0, length).trim()}...`
}

function buildQuery(filters, page) {
  const params = new URLSearchParams()
  params.set("page", String(page))
  Object.entries(filters).forEach(([key, value]) => {
    const normalized = String(value || "").trim()
    if (normalized && normalized !== "all") params.set(key, normalized)
  })
  return params.toString()
}

function KpiCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-num">{value}</p>
      {hint && <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  )
}

function ReviewDrawer({ review, onClose }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  if (!review) return null

  const metadata = {
    id: review.id,
    external_review_id: review.external_review_id,
    competitor_id: review.competitor_id,
    source_id: review.source_id,
    rating: review.rating,
    reviewed_at: review.reviewed_at,
    collected_at: review.collected_at,
    review_url: review.review_url,
    source_url: review.source?.url,
  }

  return (
    <div className="moat-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="moat-drawer" role="dialog" aria-modal="true" aria-label="Review details" onClick={event => event.stopPropagation()}>
        <div className="moat-drawer-header">
          <div className="min-w-0">
            <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{review.competitor?.name || "Unknown competitor"}</p>
            <h2 className="text-lg font-semibold truncate" style={{ color: "var(--text-primary)" }}>{ratingText(review.rating)}</h2>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="grid gap-4">
          <section>
            <p className="label">Full Review Text</p>
            <div className="moat-review-full-text">{review.review_text || "-"}</div>
          </section>
          <section>
            <p className="label">Metadata</p>
            <pre className="code-block">{JSON.stringify(metadata, null, 2)}</pre>
          </section>
          <section>
            <p className="label">Raw Payload</p>
            <pre className="code-block">{JSON.stringify(review.raw_payload || {}, null, 2)}</pre>
          </section>
        </div>
      </aside>
    </div>
  )
}

export default function MoatReviewsExplorer({ adminToken }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [reviews, setReviews] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [filterOptions, setFilterOptions] = useState({ competitors: [], sources: [], ratings: [5, 4, 3, 2, 1] })
  const [pagination, setPagination] = useState({ page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 })
  const [selectedReview, setSelectedReview] = useState(null)
  const { toasts, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [adminToken, appliedFilters, page])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const query = buildQuery(appliedFilters, page)
      const res = await fetch(`/api/moat/reviews?${query}`, {
        headers: authHeaders(adminToken),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load reviews.")
      setReviews(data.reviews || [])
      setMetrics(data.metrics || null)
      setFilterOptions(data.filters || { competitors: [], sources: [], ratings: [5, 4, 3, 2, 1] })
      setPagination(data.pagination || { page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 })
    } catch (err) {
      showError(err.message || "Could not load reviews.")
    } finally {
      setLoading(false)
    }
  }

  const sourceOptions = useMemo(() => {
    return filterOptions.sources.filter(source => {
      return filters.competitor_id === "all" || source.competitor_id === filters.competitor_id
    })
  }, [filterOptions.sources, filters.competitor_id])

  function updateFilter(key, value) {
    setFilters(prev => {
      const next = { ...prev, [key]: value }
      if (key === "competitor_id") next.source_id = "all"
      return next
    })
  }

  function applyFilters(event) {
    event.preventDefault()
    setPage(1)
    setAppliedFilters(filters)
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const totalStart = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.page_size) + 1
  const totalEnd = Math.min(pagination.total, pagination.page * pagination.page_size)

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Total Reviews" value={metrics?.total_reviews ?? 0} hint="Matching filters" />
        <KpiCard label="Average Rating" value={metrics?.average_rating ? metrics.average_rating.toFixed(2) : "-"} hint="Known ratings" />
        <KpiCard label="Competitors Covered" value={metrics?.competitors_covered ?? 0} hint="With reviews" />
        <KpiCard label="Sources Covered" value={metrics?.sources_covered ?? 0} hint="With reviews" />
      </section>

      <section className="card admin-panel">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[1fr_1fr_140px_145px_145px]">
          <select className="select" value={filters.competitor_id} onChange={event => updateFilter("competitor_id", event.target.value)}>
            <option value="all">All competitors</option>
            {filterOptions.competitors.map(competitor => (
              <option key={competitor.id} value={competitor.id}>{competitor.name}</option>
            ))}
          </select>
          <select className="select" value={filters.source_id} onChange={event => updateFilter("source_id", event.target.value)}>
            <option value="all">All sources</option>
            {sourceOptions.map(source => (
              <option key={source.id} value={source.id}>{source.label}</option>
            ))}
          </select>
          <select className="select" value={filters.rating} onChange={event => updateFilter("rating", event.target.value)}>
            <option value="all">All ratings</option>
            {filterOptions.ratings.map(rating => <option key={rating} value={rating}>{rating} stars</option>)}
          </select>
          <input className="input" type="date" value={filters.start_date} onChange={event => updateFilter("start_date", event.target.value)} />
          <input className="input" type="date" value={filters.end_date} onChange={event => updateFilter("end_date", event.target.value)} />
          <input className="input lg:col-span-3" value={filters.search} onChange={event => updateFilter("search", event.target.value)} placeholder="Search review text" />
          <button className="btn btn-primary btn-sm" disabled={loading}>{loading ? <Spinner /> : "Apply"}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters} disabled={loading}>Reset</button>
        </form>
      </section>

      <section className="card admin-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Collected Reviews</p>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>

        {loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : (
          <>
            <div className="moat-table-wrap">
              <table className="moat-table">
                <thead>
                  <tr>
                    <th>Competitor</th>
                    <th>Rating</th>
                    <th>Review Date</th>
                    <th>Review Text</th>
                    <th>Source</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map(review => (
                    <tr key={review.id}>
                      <td>{review.competitor?.name || "Unknown"}</td>
                      <td><span className="badge-pending">{ratingText(review.rating)}</span></td>
                      <td>{formatDate(review.reviewed_at)}</td>
                      <td className="moat-review-cell">{truncate(review.review_text)}</td>
                      <td>{review.source?.type ? review.source.type.replace(/_/g, " ") : "Unknown"}</td>
                      <td className="text-right">
                        <button className="btn btn-secondary btn-sm" onClick={() => setSelectedReview(review)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reviews.length === 0 && <p className="text-sm py-6" style={{ color: "var(--text-secondary)" }}>No collected reviews found.</p>}

            <div className="pagination-row">
              <span>{totalStart}-{totalEnd} of {pagination.total}</span>
              <span>Page {pagination.page} of {pagination.total_pages}</span>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" disabled={!pagination.has_previous || loading} onClick={() => setPage(prev => Math.max(1, prev - 1))}>Previous</button>
                <button className="btn btn-secondary btn-sm" disabled={!pagination.has_next || loading} onClick={() => setPage(prev => prev + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>

      <ReviewDrawer review={selectedReview} onClose={() => setSelectedReview(null)} />
      <ToastContainer toasts={toasts} />
    </div>
  )
}
