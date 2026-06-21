"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"
import { buildMoatQuery, MoatDrawer, MoatKpiCard, MoatStatusBadge, moatAuthHeaders } from "@/components/moat/MoatUi"

const EMPTY_FILTERS = {
  competitor_id: "all",
  category: "all",
  priority: "all",
  search: "",
}

const EMPTY_KPIS = {
  total_opportunities: 0,
  high_priority: 0,
  competitors_covered: 0,
  categories_covered: 0,
}

function OpportunityDrawer({ opportunity, onClose }) {
  if (!opportunity) return null

  return (
    <MoatDrawer open={Boolean(opportunity)} title={opportunity.title} eyebrow={opportunity.competitor} label="Opportunity details" onClose={onClose}>
      <div className="grid gap-4">
          <section>
            <p className="label">Full Opportunity Description</p>
            <div className="moat-review-full-text">{opportunity.description}</div>
          </section>

          <section className="grid gap-2 md:grid-cols-3">
            <div className="admin-queue-metric"><span>Confidence</span><b>{Math.round(Number(opportunity.confidence_score || 0) * 100)}%</b></div>
            <div className="admin-queue-metric"><span>Priority Score</span><b>{opportunity.priority_score}</b></div>
            <div className="admin-queue-metric"><span>Evidence</span><b>{opportunity.evidence_count}</b></div>
          </section>

          <section>
            <p className="label">Supporting Signals</p>
            <div className="flex gap-2 flex-wrap">
              {(opportunity.supporting_signals || []).map(signal => (
                <span key={signal} className="badge-pending">{signal}</span>
              ))}
            </div>
          </section>

          <section>
            <p className="label">Supporting Categories</p>
            <div className="flex gap-2 flex-wrap">
              {(opportunity.supporting_categories || []).map(category => (
                <span key={category} className="badge-done">{category}</span>
              ))}
            </div>
          </section>

          <section>
            <p className="label">Source Insight References</p>
            <pre className="code-block">{JSON.stringify(opportunity.source_insight_references || [], null, 2)}</pre>
          </section>
      </div>
    </MoatDrawer>
  )
}

function OpportunityCard({ opportunity, onOpen }) {
  return (
    <button className="moat-opportunity-card" onClick={() => onOpen(opportunity)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{opportunity.competitor}</p>
          <h3 className="text-base font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{opportunity.title}</h3>
        </div>
        <MoatStatusBadge value={opportunity.priority} />
      </div>
      <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>{opportunity.description}</p>
      <div className="flex gap-2 flex-wrap mt-4">
        <span className="badge-done">{opportunity.category}</span>
        <span className="badge-pending">{Math.round(Number(opportunity.confidence_score || 0) * 100)}% confidence</span>
        <span className="badge-pending">{opportunity.evidence_count} evidence</span>
      </div>
    </button>
  )
}

export default function MoatOpportunitiesExplorer({ adminToken }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [filterOptions, setFilterOptions] = useState({ competitors: [], categories: [], priorities: ["High", "Medium", "Low"] })
  const [kpis, setKpis] = useState(EMPTY_KPIS)
  const [opportunities, setOpportunities] = useState([])
  const [selectedOpportunity, setSelectedOpportunity] = useState(null)
  const [loading, setLoading] = useState(true)
  const { toasts, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [adminToken, appliedFilters])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const query = buildMoatQuery(appliedFilters)
      const res = await fetch(`/api/moat/opportunities${query ? `?${query}` : ""}`, {
        headers: moatAuthHeaders(adminToken),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load opportunities.")
      setOpportunities(data.opportunities || [])
      setKpis({ ...EMPTY_KPIS, ...(data.kpis || {}) })
      setFilterOptions(data.filters || { competitors: [], categories: [], priorities: ["High", "Medium", "Low"] })
    } catch (err) {
      showError(err.message || "Could not load opportunities.")
    } finally {
      setLoading(false)
    }
  }

  function applyFilters(event) {
    event.preventDefault()
    setAppliedFilters(filters)
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
  }

  const visibleCategories = useMemo(() => filterOptions.categories || [], [filterOptions.categories])

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-4">
        <MoatKpiCard label="Total Opportunities" value={kpis.total_opportunities} hint="Matching filters" />
        <MoatKpiCard label="High Priority" value={kpis.high_priority} hint="Actionable now" />
        <MoatKpiCard label="Competitors Covered" value={kpis.competitors_covered} hint="With opportunities" />
        <MoatKpiCard label="Categories Covered" value={kpis.categories_covered} hint="Opportunity areas" />
      </section>

      <section className="card admin-panel">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[1fr_180px_160px_1fr_auto_auto]">
          <select className="select" value={filters.competitor_id} onChange={event => setFilters(prev => ({ ...prev, competitor_id: event.target.value }))}>
            <option value="all">All competitors</option>
            {(filterOptions.competitors || []).map(competitor => (
              <option key={competitor.id} value={competitor.id}>{competitor.name}</option>
            ))}
          </select>
          <select className="select" value={filters.category} onChange={event => setFilters(prev => ({ ...prev, category: event.target.value }))}>
            <option value="all">All categories</option>
            {visibleCategories.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
          <select className="select" value={filters.priority} onChange={event => setFilters(prev => ({ ...prev, priority: event.target.value }))}>
            <option value="all">All priorities</option>
            {(filterOptions.priorities || []).map(priority => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <input className="input" value={filters.search} onChange={event => setFilters(prev => ({ ...prev, search: event.target.value }))} placeholder="Search opportunities" />
          <button className="btn btn-primary btn-sm" disabled={loading}>{loading ? <Spinner /> : "Apply"}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters} disabled={loading}>Reset</button>
        </form>
      </section>

      <section className="card admin-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Opportunity Explorer</p>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>

        {loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : (
          <div className="grid gap-3 md:grid-cols-2">
            {opportunities.map(opportunity => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} onOpen={setSelectedOpportunity} />
            ))}
            {opportunities.length === 0 && <p className="text-sm py-6" style={{ color: "var(--text-secondary)" }}>No opportunities found from current intelligence.</p>}
          </div>
        )}
      </section>

      <OpportunityDrawer opportunity={selectedOpportunity} onClose={() => setSelectedOpportunity(null)} />
      <ToastContainer toasts={toasts} />
    </div>
  )
}
