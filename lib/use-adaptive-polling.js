"use client"
import { useEffect, useRef } from "react"

const DEFAULT_ACTIVE_MS = 15000
const DEFAULT_HIDDEN_MS = 60000

export function useAdaptivePolling(callback, {
  enabled = true,
  activeMs = DEFAULT_ACTIVE_MS,
  hiddenMs = DEFAULT_HIDDEN_MS,
  refreshOnResume = true,
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

    function clearTimer() {
      if (timerId !== null) {
        clearTimeout(timerId)
        timerId = null
      }
    }

    function schedule() {
      clearTimer()
      if (stopped || !navigator.onLine) return
      const delay = document.visibilityState === "hidden" ? hiddenMs : activeMs
      timerId = setTimeout(run, delay)
    }

    async function run() {
      clearTimer()
      if (stopped || !navigator.onLine || inFlight) return

      inFlight = true
      try {
        await callbackRef.current()
      } catch {
        // Loaders own user-facing errors. Keep polling resilient after failures.
      } finally {
        inFlight = false
        schedule()
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && refreshOnResume) {
        run()
        return
      }
      schedule()
    }

    function handleOnline() {
      run()
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
  }, [activeMs, enabled, hiddenMs, refreshOnResume])
}
