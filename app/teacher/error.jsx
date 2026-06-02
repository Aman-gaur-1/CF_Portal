"use client"

export default function TeacherError({ error, reset }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-main)" }}>
      <div className="card p-6 w-full max-w-md text-center">
        <p className="text-sm font-semibold mb-2" style={{ color: "var(--danger)" }}>Teacher dashboard could not load</p>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          {error?.message || "Something went wrong while rendering the trainer workspace."}
        </p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  )
}
