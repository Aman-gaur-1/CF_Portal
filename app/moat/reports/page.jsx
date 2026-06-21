"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatExecutiveReports from "@/components/moat/MoatExecutiveReports"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/reports"
const page = MOAT_PAGES[PATH]

export default function MoatReportsPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatExecutiveReports adminToken={admin.token} />}
    </MoatShell>
  )
}
