"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatInsightsManager from "@/components/moat/MoatInsightsManager"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/insights"
const page = MOAT_PAGES[PATH]

export default function MoatInsightsPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatInsightsManager adminToken={admin.token} />}
    </MoatShell>
  )
}
