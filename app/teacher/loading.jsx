import LoadingSkeleton from "@/components/ui/LoadingSkeleton"

export default function TeacherLoading() {
  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg-main)" }}>
      <div className="max-w-5xl mx-auto">
        <div className="card admin-panel">
          <LoadingSkeleton rows={5} label="Loading teacher dashboard" />
        </div>
      </div>
    </div>
  )
}
