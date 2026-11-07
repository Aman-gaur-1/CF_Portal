"use client"
import { useEffect, useRef } from "react"

const DEFAULT_ACTIVE_MS = 60000

export function useAdaptivePolling(callback, {
  enabled = true,
  activeMs = DEFAULT_ACTIVE_MS,
  refreshOnResume = true,
  refreshOnOnline = true,
  backoffMs = null,
} = {}) {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return

    let stopped = false
    let timerId = null
    let inFlight = false
    let attempt = 0

    function clearTimer() {
      if (timerId !== null) {
        clearTimeout(timerId)
        timerId = null
      }
    }

    function schedule() {
      clearTimer()
      if (stopped || activeMs === null || activeMs === false || !navigator.onLine || document.visibilityState === "hidden") return
      const backoffDelay = Array.isArray(backoffMs) && backoffMs.length
        ? backoffMs[Math.min(attempt, backoffMs.length - 1)]
        : activeMs
      timerId = setTimeout(run, Math.max(Number(backoffDelay) || DEFAULT_ACTIVE_MS, 1000))
    }

    async function run() {
      clearTimer()
      if (stopped || !navigator.onLine || document.visibilityState === "hidden" || inFlight) return

      inFlight = true
      try {
        await callbackRef.current()
        attempt += 1
      } catch {
        // Loaders own user-facing errors. Keep polling resilient after failures.
      } finally {
        inFlight = false
        schedule()
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && refreshOnResume) {
        attempt = 0
        run()
        return
      }
      schedule()
    }

    function handleOnline() {
      if (refreshOnOnline) {
        attempt = 0
        run()
      }
    }

    function handleOffline() {
      clearTimer()
    }

    schedule()
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      stopped = true
      clearTimer()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [activeMs, backoffMs, enabled, refreshOnOnline, refreshOnResume])
}
