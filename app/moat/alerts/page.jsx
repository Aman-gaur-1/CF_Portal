"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatAlertsExplorer from "@/components/moat/MoatAlertsExplorer"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/alerts"
const page = MOAT_PAGES[PATH]

export default function MoatAlertsPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatAlertsExplorer adminToken={admin.token} />}
    </MoatShell>
  )
}
