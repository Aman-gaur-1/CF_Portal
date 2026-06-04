const STATE_WINDOW_MS = 10 * 60 * 1000
const PROVIDER_COOLDOWN_MS = 3 * 60 * 1000
const PROVIDER_FAILURE_THRESHOLD = 2
const MAX_EVENTS = 120

const state = globalThis.__cfAiRuntimeState || {
  providers: new Map(),
  generations: [],
}

globalThis.__cfAiRuntimeState = state

export function recordProviderLatency({ provider, model, elapsedMs, status, classification, fallbackUsed = false }) {
  const key = providerKey(provider)
  const now = Date.now()
  const current = state.providers.get(key) || {
    provider: key,
    model: model || null,
    events: [],
    cooledUntil: 0,
  }

  current.model = model || current.model
  current.events.push({
    at: now,
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
    status: status || null,
    classification: classification || null,
    fallbackUsed: Boolean(fallbackUsed),
  })
  current.events = trimEvents(current.events, now)

  const recentFailures = current.events.filter(event => isProviderSlowdown(event)).length
  if (recentFailures >= PROVIDER_FAILURE_THRESHOLD) {
    current.cooledUntil = Math.max(current.cooledUntil || 0, now + PROVIDER_COOLDOWN_MS)
    console.warn('[ai-runtime] provider cooled', {
      provider: key,
      cooled_for_ms: current.cooledUntil - now,
      recent_failures: recentFailures,
    })
  }

  state.providers.set(key, current)
}

export function recordGenerationResult({ durationMs, fallbackUsed = false, retryCount = 0, status = 'unknown' }) {
  const now = Date.now()
  state.generations.push({
    at: now,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    fallbackUsed: Boolean(fallbackUsed),
    retryCount: Number.isFinite(retryCount) ? retryCount : 0,
    status,
  })
  state.generations = trimEvents(state.generations, now)
}

export function providerHealthSummary(provider) {
  const key = providerKey(provider)
  const current = state.providers.get(key)
  if (!current) return { provider: key, cooled: false, cooledUntil: null, timeoutCount: 0, fallbackCount: 0, avgLatencyMs: null }

  const now = Date.now()
  current.events = trimEvents(current.events, now)
  const latencyEvents = current.events.filter(event => Number.isFinite(event.elapsedMs))
  const avgLatencyMs = latencyEvents.length
    ? Math.round(latencyEvents.reduce((sum, event) => sum + event.elapsedMs, 0) / latencyEvents.length)
    : null

  return {
    provider: key,
    cooled: (current.cooledUntil || 0) > now,
    cooledUntil: (current.cooledUntil || 0) > now ? new Date(current.cooledUntil).toISOString() : null,
    timeoutCount: current.events.filter(event => event.classification === 'timeout').length,
    fallbackCount: current.events.filter(event => event.fallbackUsed).length,
    avgLatencyMs,
  }
}

export function isProviderCooling(provider) {
  return Boolean(providerHealthSummary(provider).cooled)
}

export function aiRuntimeSnapshot({ queueDepth = 0 } = {}) {
  const now = Date.now()
  state.generations = trimEvents(state.generations, now)
  const completed = state.generations.filter(event => event.status === 'ready' && Number.isFinite(event.durationMs))
  const avgGenerationMs = completed.length
    ? Math.round(completed.reduce((sum, event) => sum + event.durationMs, 0) / completed.length)
    : null

  return {
    windowMs: STATE_WINDOW_MS,
    queueDepth,
    avgGenerationMs,
    timeoutCount: [...state.providers.values()].reduce((sum, provider) => {
      provider.events = trimEvents(provider.events, now)
      return sum + provider.events.filter(event => event.classification === 'timeout').length
    }, 0),
    fallbackCount: state.generations.filter(event => event.fallbackUsed).length,
    retryCount: state.generations.reduce((sum, event) => sum + (event.retryCount || 0), 0),
    providers: [...state.providers.keys()].map(providerHealthSummary),
  }
}

function trimEvents(events, now) {
  return events
    .filter(event => now - event.at <= STATE_WINDOW_MS)
    .slice(-MAX_EVENTS)
}

function isProviderSlowdown(event) {
  return (
    event.classification === 'timeout' ||
    event.classification === 'rate_limit' ||
    event.classification === 'service_unavailable' ||
    event.status === 429 ||
    event.status === 503 ||
    event.status === 504
  )
}

function providerKey(provider) {
  return String(provider || 'unknown').trim().toLowerCase() || 'unknown'
}
