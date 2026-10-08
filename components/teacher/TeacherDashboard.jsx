"use client"
import { useEffect, useState } from "react"
import Tabs from "@/components/ui/Tabs"
import SubmissionsTab from "@/components/teacher/SubmissionsTab"
import StudentsTab from "@/components/teacher/StudentsTab"
import BatchesTab from "@/components/teacher/BatchesTab"
import ThemeToggle from "@/components/ui/ThemeToggle"
import NotificationBell from "@/components/ui/NotificationBell"

const TABS = [
  { id: "reviews", label: "My Reviews" },
  { id: "students", label: "My Students" },
  { id: "batches", label: "My Batches" },
]

const openLinkedIn = () => window.open("https://www.linkedin.com/in/aman-gaur-39077214a", "_blank")

export default function TeacherDashboard({ teacherName, teacherToken, onLogout }) {
  const [tab, setTab] = useState("reviews")
  const [reviewFilter, setReviewFilter] = useState("")
  const [globalSearch, setGlobalSearch] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedTab = params.get("tab")
    const requestedFilter = params.get("filter")
    if (requestedTab && TABS.some(item => item.id === requestedTab)) setTab(requestedTab)
    if (requestedFilter === "open-queries") {
      setTab("reviews")
      setReviewFilter("Open Queries")
    }
  }, [])

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg-main)" }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black gradient-text">Teacher Workspace</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {teacherName} - assigned batches and reviews
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <NotificationBell userType="teacher" authToken={teacherToken} />
            <ThemeToggle />
            <button className="btn btn-secondary btn-sm" onClick={onLogout}>Logout</button>
          </div>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        <div className="teacher-global-search" role="search">
          <span aria-hidden>⌕</span>
          <input value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} placeholder="Search students, assignments, batches, or topics..." aria-label="Search across teacher workspace" />
          {globalSearch && <button type="button" onClick={() => setGlobalSearch("")} aria-label="Clear search">×</button>}
        </div>

        {tab === "reviews" && <SubmissionsTab teacherName={teacherName} teacherToken={teacherToken} requestedFilter={reviewFilter} globalSearch={globalSearch} />}
        {tab === "students" && <StudentsTab teacherToken={teacherToken} globalSearch={globalSearch} />}
        {tab === "batches" && <BatchesTab teacherName={teacherName} teacherToken={teacherToken} globalSearch={globalSearch} />}

        <div className="flex items-center justify-between mt-8 flex-wrap gap-3">
          <div className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <span>{"Built with by"}</span>
            <button
              onClick={openLinkedIn}
              style={{ color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: "inherit", fontWeight: 600 }}
            >
              {"Aman Gaur"}
            </button>
            <span>{"- ConsoleFlare -"} {new Date().getFullYear()}</span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
