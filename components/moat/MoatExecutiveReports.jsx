"use client"
import { useEffect, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import { ToastContainer, useToast } from "@/components/ui/Toast"
import { MoatKpiCard, MoatStatusBadge, moatAuthHeaders } from "@/components/moat/MoatUi"

const EMPTY_SUMMARY = {
  competitors_tracked: 0,
  sources_tracked: 0,
  reviews_collected: 0,
  reviews_analyzed: 0,
  pending_analysis: 0,
  opportunities_generated: 0,
  alerts_generated: 0,
  demand_signals: 0,
  market_gaps: 0,
  executive_summary: "",
}

function ReportList({ items, empty, render }) {
  if (!items?.length) return <p className="text-sm py-3" style={{ color: "var(--text-secondary)" }}>{empty}</p>
  return <div className="grid gap-2">{items.map(render)}</div>
}

function CompactSignal({ item }) {
  return (
    <div className="moat-report-row">
      <div className="min-w-0">
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{item.title || item.label}</p>
        {item.description && <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{item.description}</p>}
        {item.summary && <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{item.summary}</p>}
      </div>
      <div className="flex gap-2 flex-wrap justify-end">
        {item.category && <span className="badge-done">{item.category}</span>}
        {item.priority && <MoatStatusBadge value={item.priority} />}
        {item.severity && <MoatStatusBadge value={item.severity} />}
        {Number.isFinite(Number(item.evidence_count)) && <span className="badge-pending">{item.evidence_count} evidence</span>}
        {Number.isFinite(Number(item.count)) && <span className="badge-pending">{item.count}</span>}
      </div>
    </div>
  )
}

function CompetitorCard({ competitor }) {
  const sentiment = competitor.sentiment_distribution || {}
  return (
    <section className="moat-report-section">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Ranked by review volume</p>
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{competitor.competitor}</h3>
        </div>
        <span className="badge-pending">{competitor.review_count} reviews</span>
      </div>
      <div className="grid gap-2 md:grid-cols-3 mt-3">
        <div className="admin-queue-metric"><span>Positive</span><b>{sentiment.positive || 0}</b></div>
        <div className="admin-queue-metric"><span>Neutral</span><b>{sentiment.neutral || 0}</b></div>
        <div className="admin-queue-metric"><span>Negative</span><b>{sentiment.negative || 0}</b></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 mt-4">
        <div>
          <p className="label">Top Strengths</p>
          <ReportList items={competitor.top_strengths || []} empty="No strengths found." render={item => <CompactSignal key={item.label} item={item} />} />
        </div>
        <div>
          <p className="label">Top Weaknesses</p>
          <ReportList items={competitor.top_weaknesses || []} empty="No weaknesses found." render={item => <CompactSignal key={item.label} item={item} />} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 mt-4">
        <div>
          <p className="label">Opportunities</p>
          <ReportList items={competitor.opportunities || []} empty="No opportunities found." render={item => <CompactSignal key={item.id} item={item} />} />
        </div>
        <div>
          <p className="label">Demand Signals</p>
          <ReportList items={competitor.demand_signals || []} empty="No demand signals found." render={item => <CompactSignal key={item.id} item={item} />} />
        </div>
      </div>
    </section>
  )
}

function ReportSection({ title, children }) {
  return (
    <section className="card admin-panel moat-print-section">
      <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>{title}</h2>
      {children}
    </section>
  )
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function MoatExecutiveReports({ adminToken }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const { toasts, error: showError } = useToast()

  useEffect(() => {
    load()
  }, [adminToken])

  async function load() {
    if (!adminToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/moat/reports", {
        headers: moatAuthHeaders(adminToken),
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Could not load executive report.")
      setReport(data)
    } catch (err) {
      showError(err.message || "Could not load executive report.")
    } finally {
      setLoading(false)
    }
  }

  function copySummary() {
    navigator.clipboard?.writeText(summary.executive_summary || "")
  }

  function exportCsv() {
    const rows = [
      ["Metric", "Value"],
      ["Competitors", summary.competitors_tracked],
      ["Sources", summary.sources_tracked],
      ["Collected Reviews", summary.reviews_collected],
      ["Analyzed Reviews", summary.reviews_analyzed],
      ["Opportunities", summary.opportunities_generated],
      ["Alerts", summary.alerts_generated],
      ["Demand Signals", summary.demand_signals],
      ["Market Gaps", summary.market_gaps],
    ]
    downloadText("moat-executive-summary.csv", rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv")
  }

  const summary = { ...EMPTY_SUMMARY, ...(report?.summary || {}) }
  const biggestOpportunity = report?.opportunities?.top_recommended_actions?.[0]
  const biggestRisk = report?.alerts?.strongest_alerts?.[0]
  const fastestDemand = report?.demand?.fastest_growing_themes?.[0] || report?.demand?.strongest_demand?.[0]
  const strongestOpportunity = report?.opportunities?.top_recommended_actions?.[0]
  const highestRiskAlert = report?.alerts?.strongest_alerts?.[0]

  return (
    <div className="grid gap-5 moat-report-page">
      <div className="flex items-center justify-between gap-3 flex-wrap moat-print-hidden">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Executive-ready report generated from existing Moat intelligence.</p>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={loading}>Print</button>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()} disabled={loading}>PDF</button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={loading}>CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={copySummary} disabled={loading}>Copy Executive Summary</button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div> : (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <MoatKpiCard label="Competitors Tracked" value={summary.competitors_tracked} />
            <MoatKpiCard label="Sources Tracked" value={summary.sources_tracked} />
            <MoatKpiCard label="Reviews Collected" value={summary.reviews_collected} />
            <MoatKpiCard label="Reviews Analyzed" value={summary.reviews_analyzed} />
            <MoatKpiCard label="Pending Analysis" value={summary.pending_analysis} />
            <MoatKpiCard label="Opportunities" value={summary.opportunities_generated} />
            <MoatKpiCard label="Alerts" value={summary.alerts_generated} />
            <MoatKpiCard label="Demand Signals" value={summary.demand_signals} />
            <MoatKpiCard label="Market Gaps" value={summary.market_gaps} />
          </section>

          <ReportSection title="Executive Summary">
            <div className="moat-report-summary">{summary.executive_summary}</div>
            <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Generated at {report?.generated_at ? new Date(report.generated_at).toLocaleString() : "-"}</p>
          </ReportSection>

          <ReportSection title="Founder Summary">
            <div className="grid gap-3 md:grid-cols-2">
              <CompactSignal item={{ title: "Biggest Opportunity", description: biggestOpportunity?.description || biggestOpportunity?.title || "No opportunity found.", priority: biggestOpportunity?.priority, evidence_count: biggestOpportunity?.evidence_count }} />
              <CompactSignal item={{ title: "Biggest Risk", description: biggestRisk?.description || biggestRisk?.title || "No risk found.", severity: biggestRisk?.severity, evidence_count: biggestRisk?.evidence_count }} />
              <CompactSignal item={{ title: "Fastest Growing Demand", description: fastestDemand?.description || fastestDemand?.title || "No demand signal found.", priority: fastestDemand?.priority, evidence_count: fastestDemand?.evidence_count }} />
              <CompactSignal item={{ title: "Strongest Opportunity", description: strongestOpportunity?.description || strongestOpportunity?.title || "No opportunity found.", priority: strongestOpportunity?.priority, evidence_count: strongestOpportunity?.evidence_count }} />
              <CompactSignal item={{ title: "Highest Risk Alert", description: highestRiskAlert?.description || highestRiskAlert?.title || "No alert found.", severity: highestRiskAlert?.severity, evidence_count: highestRiskAlert?.evidence_count }} />
              <div className="moat-report-row">
                <div>
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>Immediate Actions</p>
                  <ol className="moat-recommendation-list mt-2">
                    {(report?.strategic_recommendations || []).slice(0, 3).map(item => <li key={item}>{item}</li>)}
                  </ol>
                </div>
              </div>
            </div>
          </ReportSection>

          <ReportSection title="Competitor Overview">
            <div className="grid gap-4">
              {(report?.competitor_overview?.ranked_competitors || []).filter(item => item.review_count > 0).map(competitor => (
                <CompetitorCard key={competitor.competitor_id} competitor={competitor} />
              ))}
            </div>
          </ReportSection>

          <ReportSection title="Opportunity Report">
            <div className="grid gap-3 md:grid-cols-4 mb-4">
              <MoatKpiCard label="Total Opportunities" value={report?.opportunities?.total_opportunities || 0} />
              <MoatKpiCard label="High Priority" value={report?.opportunities?.high_priority_opportunities || 0} />
              <MoatKpiCard label="Top Categories" value={(report?.opportunities?.top_categories || []).length} />
              <MoatKpiCard label="Recommended Actions" value={(report?.opportunities?.top_recommended_actions || []).length} />
            </div>
            <ReportList items={report?.opportunities?.top_recommended_actions || []} empty="No opportunity actions found." render={item => <CompactSignal key={item.id} item={item} />} />
          </ReportSection>

          <ReportSection title="Alerts Report">
            <div className="grid gap-3 md:grid-cols-3 mb-4">
              <MoatKpiCard label="Total Alerts" value={report?.alerts?.total_alerts || 0} />
              <MoatKpiCard label="Critical Alerts" value={report?.alerts?.critical_alerts || 0} />
              <MoatKpiCard label="High Severity Alerts" value={report?.alerts?.high_severity_alerts || 0} />
            </div>
            <ReportList items={report?.alerts?.strongest_alerts || []} empty="No alerts found." render={item => <CompactSignal key={item.id} item={item} />} />
          </ReportSection>

          <ReportSection title="Market Demand Report">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="label">Strongest Demand</p>
                <ReportList items={report?.demand?.strongest_demand || []} empty="No demand signals found." render={item => <CompactSignal key={item.id} item={item} />} />
              </div>
              <div>
                <p className="label">Market Gaps</p>
                <ReportList items={report?.demand?.market_gaps || []} empty="No market gaps found." render={item => <CompactSignal key={item.id} item={item} />} />
              </div>
            </div>
          </ReportSection>

          <ReportSection title="Strategic Recommendations">
            <ol className="moat-recommendation-list">
              {(report?.strategic_recommendations || []).map(item => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </ReportSection>
        </>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  )
}
