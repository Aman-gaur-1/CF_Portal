/**
 * Displays AI draft pipeline status for submissions (trainer/student views).
 */
export default function AiStatusBadge({ status, error, showReady = true, neutral = false, queuedAt, diagnostics }) {
  if (!status) return null

  const detail = resolveDetail(status, { queuedAt, diagnostics })
  const config = {
    pending: {
      label: detail.label || 'Queued',
      color: 'var(--text-muted)',
      pulse: true,
    },
    processing: {
      label: detail.label || 'Generating',
      color: 'var(--accent-light)',
      pulse: true,
    },
    ready: {
      label: detail.label || 'AI draft ready',
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
  const title = [error, detail.title].filter(Boolean).join(' - ') || undefined

  return (
    <span
      className={`text-xs font-medium px-2 py-1 rounded-full inline-flex items-center gap-1 ${item.pulse ? 'animate-pulse' : ''}`}
      style={{
        background: 'rgba(245,166,35,0.08)',
        color: item.color,
        border: '1px solid var(--border)',
      }}
      title={title}
    >
      {status === 'pending' && <span aria-hidden>.</span>}
      {status === 'processing' && <span aria-hidden>~</span>}
      {status === 'ready' && <span aria-hidden>*</span>}
      {status === 'failed' && <span aria-hidden>!</span>}
      {label}
    </span>
  )
}

function resolveDetail(status, { queuedAt, diagnostics }) {
  const provider = diagnostics || {}
  if (status === 'ready' && provider.fallback_used) {
    return {
      label: 'AI draft ready (fallback used)',
      title: `Fallback active: ${(provider.fallback_from || []).join(', ')}`,
    }
  }

  if (status === 'processing' && queuedAt) {
    const elapsedMs = Date.now() - new Date(queuedAt).getTime()
    if (Number.isFinite(elapsedMs) && elapsedMs > 45_000) {
      return {
        label: 'Delayed provider response',
        title: 'The provider is taking longer than usual.',
      }
    }
  }

  if (status === 'processing') return { label: 'Generating' }
  if (status === 'pending') return { label: 'Queued' }
  return {}
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
