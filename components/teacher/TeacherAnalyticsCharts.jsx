"use client"
import { useEffect, useRef, useState } from "react"
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts"

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null
  return (
    <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", boxShadow: "var(--shadow-sm)", backdropFilter: "blur(16px)" }}>
      {label ? <p className="font-semibold mb-1">{label}</p> : null}
      {payload.map(item => (
        <p key={`${item.dataKey || item.name}-${item.value}`} style={{ color: item.color || "var(--text-secondary)" }}>
          {item.name || item.dataKey}: {item.value}
        </p>
      ))}
    </div>
  )
}

function EmptyChart({ children = "No data yet" }) {
  return (
    <div className="h-full flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
      {children}
    </div>
  )
}

function MeasuredChart({ height, emptyText, children }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!ref.current) return undefined

    function updateWidth() {
      if (!ref.current) return
      setWidth(Math.max(0, Math.floor(ref.current.getBoundingClientRect().width)))
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} style={{ height, width: "100%", minWidth: 0 }}>
      {width > 0 ? children(width, height) : <EmptyChart>{emptyText}</EmptyChart>}
    </div>
  )
}

function normalizeTrend(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row, index) => ({
    label: row?.label || row?.date || `Day ${index + 1}`,
    submissions: toNumber(row?.submissions),
  }))
}

export default function TeacherAnalyticsCharts({ globalStats }) {
  const trendRows = normalizeTrend(globalStats?.sevenDayTrend)

  return (
    <div className="card chart-card p-5 min-w-0 mb-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <p className="text-sm font-semibold">7-Day Submission Trend</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Submission volume by day</p>
        </div>
      </div>
      {trendRows.some(row => row.submissions > 0) ? (
        <MeasuredChart height={196}>
          {(width, height) => (
            <LineChart width={width} height={height} data={trendRows} margin={{ top: 12, right: 14, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" />
              <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="submissions" name="Submissions" stroke="var(--accent)" strokeWidth={3} dot={{ r: 3, fill: "var(--bg-card)", stroke: "var(--accent)", strokeWidth: 2 }} activeDot={{ r: 5, fill: "var(--accent)", stroke: "var(--bg-card)", strokeWidth: 2 }} />
            </LineChart>
          )}
        </MeasuredChart>
      ) : (
        <div style={{ height: 196 }}>
          <EmptyChart />
        </div>
      )}
    </div>
  )
}
