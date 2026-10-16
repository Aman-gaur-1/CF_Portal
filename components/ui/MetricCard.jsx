export default function MetricCard({ label, value, hint, tone = "default", className = "" }) {
  return (
    <article className={`metric-card metric-card-${tone} ${className}`.trim()}>
      <p className="metric-card-label">{label}</p>
      <p className="metric-card-value">{value}</p>
      {hint && <p className="metric-card-hint">{hint}</p>}
    </article>
  )
}
