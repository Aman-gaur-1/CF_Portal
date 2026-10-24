"use client"
import { useEffect, useState } from "react"
import Tabs from "@/components/ui/Tabs"
import SubmissionsTab from "@/components/teacher/SubmissionsTab"
import StudentsTab from "@/components/teacher/StudentsTab"
import AttendanceTab from "@/components/teacher/AttendanceTab"
import ThemeToggle from "@/components/ui/ThemeToggle"
import NotificationBell from "@/components/ui/NotificationBell"
import StudentHealthPanel from "@/components/teacher/StudentHealthPanel"
import PageHeader from "@/components/ui/PageHeader"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "attendance", label: "Attendance" },
  { id: "students", label: "Students" },
  { id: "coursework", label: "Coursework" },
]

const LEGACY_TAB_ALIASES = {
  reviews: "overview",
  batches: "overview",
  health: "coursework",
}

const openLinkedIn = () => window.open("https://www.linkedin.com/in/aman-gaur-39077214a", "_blank")

export default function TeacherDashboard({ teacherName, teacherToken, onLogout }) {
  const [tab, setTab] = useState("overview")
  const [reviewFilter, setReviewFilter] = useState("")
  const [globalSearch, setGlobalSearch] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedTab = params.get("tab")
    const requestedFilter = params.get("filter")
    const resolvedTab = LEGACY_TAB_ALIASES[requestedTab] || requestedTab
    if (resolvedTab && TABS.some(item => item.id === resolvedTab)) setTab(resolvedTab)
    if (requestedFilter === "open-queries") {
      setTab("overview")
      setReviewFilter("Open Queries")
    }
  }, [])

  return (
    <div className="teacher-shell">
      <div className="teacher-content">
        <PageHeader
          eyebrow="ConsoleFlare teaching workspace"
          title="Teacher Workspace"
          subtitle="Review submissions, support your students, and clear attendance requests from one focused workspace."
          meta={<span className="portal-chip">{teacherName}</span>}
          actions={<><NotificationBell userType="teacher" authToken={teacherToken} /><ThemeToggle /><button className="btn btn-secondary btn-sm" onClick={onLogout}>Log out</button></>}
        />

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        <div className="teacher-global-search" role="search">
          <span aria-hidden>⌕</span>
          <input value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} placeholder="Search students, assignments, batches, or topics..." aria-label="Search across teacher workspace" />
          {globalSearch && <button type="button" onClick={() => setGlobalSearch("")} aria-label="Clear search">×</button>}
        </div>

        {tab === "overview" && <SubmissionsTab teacherName={teacherName} teacherToken={teacherToken} requestedFilter={reviewFilter} globalSearch={globalSearch} />}
        {tab === "attendance" && <AttendanceTab teacherToken={teacherToken} />}
        {tab === "students" && <StudentsTab teacherToken={teacherToken} globalSearch={globalSearch} />}
        {tab === "coursework" && <StudentHealthPanel teacherToken={teacherToken} initialTab="coursework" hideNavigation />}

        <div className="portal-footer">
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
