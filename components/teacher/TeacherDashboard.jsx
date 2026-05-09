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
          <div className="flex items-center gap-2 flex-wrap">
            <ThemeToggle />
            <button className="btn btn-secondary btn-sm" onClick={onLogout}>🚪 Logout</button>
          </div>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === "submissions" && <SubmissionsTab teacherName={teacherName} />}
        {tab === "students" && <StudentsTab />}
        {tab === "batches" && <BatchesTab teacherName={teacherName} />}

        <div className="flex items-center justify-between mt-8 flex-wrap gap-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Built with ❤️ by{"Aman Gaur"}
            
              href="https://www.linkedin.com/in/aman-gaur-39077214a"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold hover:underline"
              style={{ color: "var(--primary)" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452H17.21v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.987V9h3.102v1.561h.046c.432-.816 1.489-1.676 3.065-1.676 3.278 0 3.881 2.156 3.881 4.961v6.606zM5.337 7.433a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zm1.603 13.019H3.734V9h3.206v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/>
              </svg>
              Aman Gaur
            </a>
            {" "}&nbsp;•&nbsp; ConsoleFlare &nbsp;•&nbsp; © {new Date().getFullYear()}
          </p>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
