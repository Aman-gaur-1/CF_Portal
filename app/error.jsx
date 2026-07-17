"use client"
import ErrorState from "@/components/ui/ErrorState"

export default function AppError({ error, reset }) {
  return (
    <ErrorState
      status="Error"
      title="This page could not load"
      message={error?.message || "A loading or network failure interrupted the page."}
      onRetry={reset}
    />
  )
}
