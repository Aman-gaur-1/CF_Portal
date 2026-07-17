"use client"

export default function ErrorState({
  title = "Something went wrong",
  message = "The page could not be loaded.",
  status = "Error",
  onRetry,
  homeHref = "/",
  dashboardHref = "/admin",
}) {
  return (
    <div className="error-state-shell">
      <div className="card error-state-card">
        <span className="badge-failed">{status}</span>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="error-state-actions">
          {onRetry && <button type="button" className="btn btn-primary" onClick={onRetry}>Retry</button>}
          <a className="btn btn-secondary" href={homeHref}>Return Home</a>
          <a className="btn btn-secondary" href={dashboardHref}>Return Dashboard</a>
        </div>
      </div>
    </div>
  )
}
