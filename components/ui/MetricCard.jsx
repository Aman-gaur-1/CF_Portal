export default function MetricCard({ label, value, hint, tone = "default", className = "", onClick, style }) {
  const Tag = onClick ? "button" : "article"
  return (
    <Tag type={onClick ? "button" : undefined} className={`metric-card metric-card-${tone} ${className}`.trim()} onClick={onClick} style={style}>
      <p className="metric-card-label">{label}</p>
      <p className="metric-card-value">{value}</p>
      {hint && <p className="metric-card-hint">{hint}</p>}
    </Tag>
  )
}
