import Spinner from "@/components/ui/Spinner"

export default function TeacherLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
      <Spinner size="lg" />
    </div>
  )
}
