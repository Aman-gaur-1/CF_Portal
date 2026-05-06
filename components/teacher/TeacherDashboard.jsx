"use client"
import { useState } from "react"
import Tabs from "@/components/ui/Tabs"
import SubmissionsTab from "@/components/teacher/SubmissionsTab"
import StudentsTab from "@/components/teacher/StudentsTab"
import BatchesTab from "@/components/teacher/BatchesTab"

const TABS = [
  { id: "submissions", label: "📋 Submissions" },
  { id: "students", label: "👥 Students" },
  { id: "batches", label: "🗂️ Batches" },
]

export default function TeacherDashboard({ teacherName, onLogout }) {
  const [tab, setTab] = useState("submissions")

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg-main)" }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black gradient-text">Trainer Panel</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>🧑‍🏫 {teacherName} &nbsp;•&nbsp; ConsoleFlare</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>🚪 Logout</button>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === "submissions" && <SubmissionsTab teacherName={teacherName} />}
        {tab === "students" && <StudentsTab />}
        {tab === "batches" && <BatchesTab teacherName={teacherName} />}

        <div className="text-center mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
          Built with ❤️ by ConsoleFlare &nbsp;•&nbsp; © {new Date().getFullYear()}
        </div>
      </div>
    </div>
  )
}