export default function EmptyState({
  icon = "•",
  title = "Nothing to show",
  message = "Try adjusting your filters.",
  action = null,
}) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden>{icon}</div>
      <p className="empty-state-title">{title}</p>
      {message && <p className="empty-state-message">{message}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
