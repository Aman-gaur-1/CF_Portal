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
  demand_signals: 0,
  high_demand_signals: 0,
  market_gaps: 0,
  competitors_covered: 0,
}

function MiniSignal({ item, onOpen }) {
  return (
    <button className="moat-insight-row text-left" onClick={() => onOpen(item)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{item.competitor} - {item.category}</p>
          <h3 className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{item.title}</h3>
        </div>
        <MoatStatusBadge value={item.priority} />
      </div>
      <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>{item.description}</p>
      <div className="flex gap-2 flex-wrap mt-3">
        <span className="badge-pending">{item.demand_score} demand</span>
        <span className="badge-pending">{item.evidence_count} evidence</span>
      </div>
    </button>
  )
}

function MarketGapRow({ gap }) {
  return (
    <div className="moat-insight-row">
      <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{gap.competitor} - {gap.category}</p>
      <h3 className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{gap.title}</h3>
      <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>{gap.description}</p>
      <div className="flex gap-2 flex-wrap mt-3">
        <span className="badge-pending">{gap.evidence_count} evidence</span>
        <span className="badge-done">{Math.round(Number(gap.confidence_score || 0) * 100)}% confidence</span>
      </div>
    </div>
  )
}

function DemandDrawer({ signal, onClose }) {
  if (!signal) return null

  return (
    <MoatDrawer open={Boolean(signal)} title={signal.title} eyebrow={`${signal.competitor} - ${signal.category}`} label="Market demand details" onClose={onClose}>
      <div className="grid gap-4">
          <section>
            <p className="label">Full Description</p>
            <div className="moat-review-full-text">{signal.description}</div>
          </section>

          <section className="grid gap-2 md:grid-cols-4">
            <div className="admin-queue-metric"><span>Demand</span><b>{signal.demand_score}</b></div>
            <div className="admin-queue-metric"><span>Confidence</span><b>{Math.round(Number(signal.confidence_score || 0) * 100)}%</b></div>
            <div className="admin-queue-metric"><span>Priority</span><b>{signal.priority}</b></div>
            <div className="admin-queue-metric"><span>Evidence</span><b>{signal.evidence_count}</b></div>
          </section>

          <section>
            <p className="label">Market Gap</p>
            <div className="moat-review-full-text">{signal.market_gap?.title || "No market gap detected."}</div>
          </section>

          <section>
            <p className="label">Supporting Signals</p>
            <div className="flex gap-2 flex-wrap">
              {(signal.supporting_signals || []).map(item => (
                <span key={item} className="badge-pending">{item}</span>
              ))}
            </div>
          </section>

          <section>
            <p className="label">Supporting Evidence</p>
            <pre className="code-block">{JSON.stringify(signal.supporting_evidence || [], null, 2)}</pre>
          </section>

          <section>
            <p className="label">Related Insights</p>
            <pre className="code-block">{JSON.stringify(signal.related_insights || [], null, 2)}</pre>
          </section>

          <section>
            <p className="label">Related Opportunities</p>
            <pre className="code-block">{JSON.stringify(signal.related_opportunities || [], null, 2)}</pre>
          </section>
      </div>
    </MoatDrawer>
  )
}

function DemandCard({ signal, onOpen }) {
  return (
    <button className="moat-demand-card" onClick={() => onOpen(signal)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{signal.competitor} - {signal.category}</p>
          <h3 className="text-base font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{signal.title}</h3>
        </div>
        <MoatStatusBadge value={signal.priority} />
      </div>
      <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>{signal.description}</p>
      <div className="flex gap-2 flex-wrap mt-4">
        <span className="badge-done">{signal.category}</span>
        <span className="badge-pending">{signal.demand_score} demand</span>
        <span className="badge-pending">{Math.round(Number(signal.confidence_score || 0) * 100)}% confidence</span>
        <span className="badge-pending">{signal.evidence_count} evidence</span>
      </div>
    </button>
  )
}

function DemandSection({ title, items, empty, onOpen }) {
  return (
    <section className="card admin-panel">
      <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{title}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {(items || []).map(item => (
          <MiniSignal key={`${title}-${item.id}`} item={item} onOpen={onOpen} />
        ))}
      </div>
      {(items || []).length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>{empty}</p>}
    </section>
  )
}

export default function MoatMarketDemandExplorer({ adminToken }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [filterOptions, setFilterOptions] = useState({ competitors: [], categories: [], priorities: ["Critical", "High", "Medium", "Low"] })
  const [kpis, setKpis] = useState(EMPTY_KPIS)
  const [signals, setSignals] = useState([])
  const [trends, setTrends] = useState({})
  const [selectedSignal, setSelectedSignal] = useState(null)
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
      const res = await fetch(`/api/moat/market-demand${query ? `?${query}` : ""}`, {
        headers: moatAuthHeaders(adminToken),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load market demand.")
      setSignals(data.demand_signals || [])
      setTrends(data.trends || {})
      setKpis({ ...EMPTY_KPIS, ...(data.kpis || {}) })
      setFilterOptions(data.filters || { competitors: [], categories: [], priorities: ["Critical", "High", "Medium", "Low"] })
    } catch (err) {
      showError(err.message || "Could not load market demand.")
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

  const categories = useMemo(() => filterOptions.categories || [], [filterOptions.categories])
  const priorities = useMemo(() => filterOptions.priorities || [], [filterOptions.priorities])

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-4">
        <MoatKpiCard label="Demand Signals" value={kpis.demand_signals} hint="Matching filters" />
        <MoatKpiCard label="High Demand Signals" value={kpis.high_demand_signals} hint="Critical or high" />
        <MoatKpiCard label="Market Gaps" value={kpis.market_gaps} hint="Detected gaps" />
        <MoatKpiCard label="Competitors Covered" value={kpis.competitors_covered} hint="With demand signals" />
      </section>

      <section className="card admin-panel">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[1fr_200px_160px_1fr_auto_auto]">
          <select className="select" value={filters.competitor_id} onChange={event => setFilters(prev => ({ ...prev, competitor_id: event.target.value }))}>
            <option value="all">All competitors</option>
            {(filterOptions.competitors || []).map(competitor => (
              <option key={competitor.id} value={competitor.id}>{competitor.name}</option>
            ))}
          </select>
          <select className="select" value={filters.category} onChange={event => setFilters(prev => ({ ...prev, category: event.target.value }))}>
            <option value="all">All categories</option>
            {categories.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
          <select className="select" value={filters.priority} onChange={event => setFilters(prev => ({ ...prev, priority: event.target.value }))}>
            <option value="all">All priorities</option>
            {priorities.map(priority => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <input className="input" value={filters.search} onChange={event => setFilters(prev => ({ ...prev, search: event.target.value }))} placeholder="Search demand" />
          <button className="btn btn-primary btn-sm" disabled={loading}>{loading ? <Spinner /> : "Apply"}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters} disabled={loading}>Reset</button>
        </form>
      </section>

      <section className="card admin-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Top Demand Signals</p>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>

        {loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : (
          <div className="grid gap-3 md:grid-cols-2">
            {signals.map(signal => (
              <DemandCard key={signal.id} signal={signal} onOpen={setSelectedSignal} />
            ))}
            {signals.length === 0 && <p className="text-sm py-6" style={{ color: "var(--text-secondary)" }}>No market demand signals found from current intelligence.</p>}
          </div>
        )}
      </section>

      {!loading && (
        <>
          <DemandSection title="Emerging Demand" items={trends.emerging_demand || []} empty="No emerging demand detected." onOpen={setSelectedSignal} />

          <section className="card admin-panel">
            <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Market Gaps</p>
            <div className="grid gap-3 md:grid-cols-2">
              {(trends.market_gaps || []).map(gap => (
                <MarketGapRow key={gap.id} gap={gap} />
              ))}
            </div>
            {(trends.market_gaps || []).length === 0 && <p className="text-sm py-4" style={{ color: "var(--text-secondary)" }}>No market gaps detected.</p>}
          </section>

          <DemandSection title="High Growth Areas" items={trends.high_growth_areas || []} empty="No high growth areas detected." onOpen={setSelectedSignal} />
          <DemandSection title="Opportunity Alignment" items={trends.opportunity_alignment || []} empty="No opportunity alignment detected." onOpen={setSelectedSignal} />
        </>
      )}

      <DemandDrawer signal={selectedSignal} onClose={() => setSelectedSignal(null)} />
      <ToastContainer toasts={toasts} />
    </div>
  )
}
