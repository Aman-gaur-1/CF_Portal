"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import ThemeToggle from "@/components/ui/ThemeToggle"

const SESSION_KEY = "cf_admin"

export const MOAT_NAV_ITEMS = [
  { href: "/moat", label: "Overview" },
  { href: "/moat/competitors", label: "Competitors" },
  { href: "/moat/sources", label: "Sources" },
  { href: "/moat/source-discovery", label: "Discovery" },
  { href: "/moat/providers", label: "Providers" },
  { href: "/moat/test-sync", label: "Test Sync" },
  { href: "/moat/jobs", label: "Jobs" },
  { href: "/moat/reviews", label: "Reviews" },
  { href: "/moat/insights", label: "Insights" },
  { href: "/moat/opportunities", label: "Opportunities" },
  { href: "/moat/market-demand", label: "Market Demand" },
  { href: "/moat/reports", label: "Reports" },
  { href: "/moat/alerts", label: "Alerts" },
]

function readAdminSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY)
    if (!saved) return null
    const parsed = JSON.parse(saved)
    return parsed?.token ? parsed : null
  } catch {
    return null
  }
}

export default function MoatShell({ activePath, title, description, children }) {
  const [admin, setAdmin] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const session = readAdminSession()
    if (!session) {
      window.location.href = "/admin"
      return
    }
    setAdmin(session)
    setLoading(false)
  }, [])

  const navItems = useMemo(() => MOAT_NAV_ITEMS, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen admin-shell" style={{ background: "var(--bg-main)" }}>
      <div className="max-w-6xl mx-auto">
        <div className="admin-header">
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>MOAT ENGINE</p>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{description}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ThemeToggle />
            <a className="btn btn-secondary btn-sm" href="/admin">Admin</a>
          </div>
        </div>

        <nav className="moat-nav" aria-label="Moat navigation">
          {navItems.map(item => {
            const isActive = activePath === item.href
            return (
              <a key={item.href} className={`moat-nav-link${isActive ? " moat-nav-link-active" : ""}`} href={item.href}>
                {item.label}
              </a>
            )
          })}
        </nav>

        <main className="mt-5">
          {typeof children === "function" ? children({ admin }) : children}
        </main>

        <p className="text-xs mt-6" style={{ color: "var(--text-muted)" }}>
          Signed in as {admin?.name || "admin"}
        </p>
      </div>
    </div>
  )
}
