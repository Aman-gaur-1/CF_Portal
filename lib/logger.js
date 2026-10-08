const debugEnabled = process.env.NODE_ENV !== 'production' || process.env.DEBUG_LOGS === 'true'

export function debugLog(...args) {
  if (debugEnabled) console.info(...args)
}
