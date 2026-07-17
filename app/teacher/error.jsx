"use client"
import ErrorState from "@/components/ui/ErrorState"

export default function TeacherError({ error, reset }) {
  return (
    <ErrorState
      status="Teacher"
      title="Teacher dashboard could not load"
      message={error?.message || "Something went wrong while rendering the trainer workspace."}
      onRetry={reset}
    />
  )
}
