"use client"
import { useCallback, useEffect, useMemo, useState } from "react"

export function useRefreshAction({
  onRefresh,
  onSuccess,
  onError,
  successMessage = "Updated just now.",
  errorMessage = "Refresh failed. Retry.",
} = {}) {
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!lastUpdatedAt) return undefined
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [lastUpdatedAt])

  const refresh = useCallback(async () => {
    if (refreshing || typeof onRefresh !== "function") return
    setRefreshing(true)
    try {
      await onRefresh()
      const now = new Date()
      setLastUpdatedAt(now)
      onSuccess?.(successMessage)
      return { ok: true, updatedAt: now }
    } catch (err) {
      onError?.(err?.message || errorMessage)
      return { ok: false, error: err }
    } finally {
      setRefreshing(false)
    }
  }, [errorMessage, onError, onRefresh, onSuccess, refreshing, successMessage])

  const updatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return ""
    const elapsedMs = now - lastUpdatedAt.getTime()
    if (elapsedMs < 45_000) return "Updated just now"
    return `Last updated: ${relativeRefreshTime(elapsedMs)}`
  }, [lastUpdatedAt, now])

  return { refresh, refreshing, lastUpdatedAt, updatedLabel }
}

function relativeRefreshTime(elapsedMs) {
  const minutes = Math.max(Math.round(elapsedMs / 60_000), 1)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
