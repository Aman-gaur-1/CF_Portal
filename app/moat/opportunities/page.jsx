"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatOpportunitiesExplorer from "@/components/moat/MoatOpportunitiesExplorer"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/opportunities"
const page = MOAT_PAGES[PATH]

export default function MoatOpportunitiesPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatOpportunitiesExplorer adminToken={admin.token} />}
    </MoatShell>
  )
}
