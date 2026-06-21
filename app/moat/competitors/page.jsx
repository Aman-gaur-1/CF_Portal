"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatCompetitorsManager from "@/components/moat/MoatCompetitorsManager"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/competitors"
const page = MOAT_PAGES[PATH]

export default function MoatCompetitorsPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatCompetitorsManager adminToken={admin.token} />}
    </MoatShell>
  )
}
