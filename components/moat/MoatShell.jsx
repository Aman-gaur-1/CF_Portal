"use client"
import { useEffect, useMemo, useState } from "react"
import Spinner from "@/components/ui/Spinner"
import ThemeToggle from "@/components/ui/ThemeToggle"

const SESSION_KEY = "cf_admin"

export const MOAT_NAV_ITEMS = [
  { href: "/scan", label: "Overview" },
  { href: "/scan/competitors", label: "Competitors" },
]

export const MOAT_NAV_GROUPS = [
  {
    label: "Collection",
    items: [
      { href: "/scan/sources", label: "Sources" },
      { href: "/scan/source-discovery", label: "Discovery" },
      { href: "/scan/providers", label: "Providers" },
      { href: "/scan/jobs", label: "Jobs" },
      { href: "/scan/test-sync", label: "Test Sync" },
    ],
  },
  {
    label: "Analysis",
    items: [
      { href: "/scan/reviews", label: "Reviews" },
      { href: "/scan/insights", label: "Insights" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/scan/opportunities", label: "Opportunities" },
      { href: "/scan/alerts", label: "Alerts" },
      { href: "/scan/market-demand", label: "Market Demand" },
    ],
  },
  {
    label: "Reporting",
    items: [
      { href: "/scan/reports", label: "Reports" },
    ],
  },
]

export const MOAT_ALL_NAV_ITEMS = [
  ...MOAT_NAV_ITEMS,
  { href: "/scan/sources", label: "Sources" },
  { href: "/scan/source-discovery", label: "Discovery" },
  { href: "/scan/providers", label: "Providers" },
  { href: "/scan/test-sync", label: "Test Sync" },
  { href: "/scan/jobs", label: "Jobs" },
  { href: "/scan/reviews", label: "Reviews" },
  { href: "/scan/insights", label: "Insights" },
  { href: "/scan/opportunities", label: "Opportunities" },
  { href: "/scan/market-demand", label: "Market Demand" },
  { href: "/scan/reports", label: "Reports" },
  { href: "/scan/alerts", label: "Alerts" },
]

function publicScanPath(path) {
  return String(path || "").replace(/^\/moat(?=\/|$)/, "/scan")
}

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
  const navGroups = useMemo(() => MOAT_NAV_GROUPS, [])
  const activePublicPath = publicScanPath(activePath)

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
            const isActive = activePublicPath === item.href
            return (
              <a key={item.href} className={`moat-nav-link${isActive ? " moat-nav-link-active" : ""}`} href={item.href}>
                {item.label}
              </a>
            )
          })}
          {navGroups.map(group => (
            <div key={group.label} className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase px-2" style={{ color: "var(--text-muted)" }}>{group.label}</span>
              <div className="flex gap-2 flex-wrap">
                {group.items.map(item => {
                  const isActive = activePublicPath === item.href
                  return (
                    <a key={item.href} className={`moat-nav-link${isActive ? " moat-nav-link-active" : ""}`} href={item.href}>
                      {item.label}
                    </a>
                  )
                })}
              </div>
            </div>
          ))}
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
