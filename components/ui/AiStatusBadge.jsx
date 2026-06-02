/**
 * Displays AI draft pipeline status for submissions (trainer/student views).
 */
export default function AiStatusBadge({ status, error, showReady = true, neutral = false }) {
  if (!status) return null

  const config = {
    pending: {
      label: 'AI draft queued',
      color: 'var(--text-muted)',
      pulse: true,
    },
    processing: {
      label: 'AI drafting…',
      color: 'var(--accent-light)',
      pulse: true,
    },
    ready: {
      label: 'AI draft ready for review',
      color: 'var(--success)',
      pulse: false,
    },
    failed: {
      label: 'AI draft failed',
      color: 'var(--danger)',
      pulse: false,
    },
  }

  const item = config[status]
  if (!item) return null
  if (status === 'ready' && !showReady) return null
  const label = neutral ? neutralLabel(status) : item.label

  return (
    <span
      className={`text-xs font-medium px-2 py-1 rounded-full inline-flex items-center gap-1 ${item.pulse ? 'animate-pulse' : ''}`}
      style={{
        background: 'rgba(245,166,35,0.08)',
        color: item.color,
        border: '1px solid var(--border)',
      }}
      title={error || undefined}
    >
      {status === 'processing' && <span aria-hidden>⏳</span>}
      {status === 'ready' && <span aria-hidden>✨</span>}
      {status === 'failed' && <span aria-hidden>⚠️</span>}
      {label}
    </span>
  )
}

function neutralLabel(status) {
  const labels = {
    pending: 'Review queued',
    processing: 'Under review',
    ready: 'Feedback is being prepared',
    failed: 'Trainer review pending',
  }
  return labels[status] || 'Under review'
}
