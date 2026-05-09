"use client"
import { useState } from "react"
import Tabs from "@/components/ui/Tabs"
import SubmissionsTab from "@/components/teacher/SubmissionsTab"
import StudentsTab from "@/components/teacher/StudentsTab"
import BatchesTab from "@/components/teacher/BatchesTab"
import ThemeToggle from "@/components/ui/ThemeToggle"

const TABS = [
  { id: "submissions", label: "📋 Submissions" },
  { id: "students", label: "👥 Students" },
  { id: "batches", label: "🗂️ Batches" },
]

const openLinkedIn = () => window.open("https://www.linkedin.com/in/aman-gaur-39077214a", "_blank")

export default function TeacherDashboard({ teacherName, onLogout }) {
  const [tab, setTab] = useState("submissions")
  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg-main)" }}>
      <div className="max-w-5xl mx-auto">

        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black gradient-text">Trainer Panel</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {"🧑‍🏫"} {teacherName} {"•"} ConsoleFlare
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ThemeToggle />
            <button className="btn btn-secondary btn-sm" onClick={onLogout}>{"🚪"} Logout</button>
          </div>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === "submissions" && <SubmissionsTab teacherName={teacherName} />}
        {tab === "students" && <StudentsTab />}
        {tab === "batches" && <BatchesTab teacherName={teacherName} />}

        <div className="flex items-center justify-between mt-8 flex-wrap gap-3">
          <div className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <span>{"Built with ✨ by"}</span>
            <button
              onClick={openLinkedIn}
              style={{ color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: "inherit", fontWeight: 600 }}
            >
              {"Aman Gaur"}
            </button>
            <span>{"• ConsoleFlare •"} {new Date().getFullYear()}</span>
          </div>
          <ThemeToggle />
        </div>

      </div>
    </div>
  )
}
