export default function LoadingSkeleton({ rows = 4, variant = "card", label = "Loading" }) {
  return (
    <div className={`loading-skeleton loading-skeleton-${variant}`} aria-label={label} role="status">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="loading-skeleton-row" key={index} />
      ))}
    </div>
  )
}
