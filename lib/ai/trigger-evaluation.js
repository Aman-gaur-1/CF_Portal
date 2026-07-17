/**
 * Trigger AI evaluation and return an inspectable result.
 * Defaults to resolving with { ok: false } on failure so callers may still use it
 * as fire-and-forget without unhandled promise rejections.
 */
export function triggerAiEvaluation(submissionId, { throwOnError = false, token = '' } = {}) {
  if (!submissionId) {
    const error = new Error('submissionId is required')
    if (throwOnError) return Promise.reject(error)
    console.warn('[AI] trigger skipped: submissionId is required')
    return Promise.resolve({ ok: false, error: error.message })
  }

  console.info('[AI] trigger start', { submissionId })

  return fetch('/api/generate-feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ submissionId }),
  })
    .then(async res => {
      let data = {}
      try {
        data = await res.json()
      } catch {
        /* ignore */
      }

      if (res.ok || res.status === 202) {
        console.info('[AI] trigger accepted', {
          submissionId,
          status: res.status,
          aiStatus: data?.status,
        })
        return { ok: true, status: res.status, data }
      }

      const detail = data?.error || ''
      const error = new Error(
        `AI trigger failed for submission ${submissionId}: HTTP ${res.status}${detail ? ` - ${detail}` : ''}`
      )
      error.status = res.status
      error.data = data
      console.warn(
        `[AI] auto-evaluate failed for submission ${submissionId}: HTTP ${res.status}${detail ? ` - ${detail}` : ''}`
      )
      if (throwOnError) throw error
      return { ok: false, status: res.status, error: detail || error.message, data }
    })
    .catch(err => {
      console.warn(`[AI] auto-evaluate network error for submission ${submissionId}:`, err?.message || err)
      if (throwOnError) throw err
      return { ok: false, error: err?.message || 'Network error' }
    })
}
