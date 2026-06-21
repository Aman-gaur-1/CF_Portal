"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatReadinessDashboard from "@/components/moat/MoatReadinessDashboard"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat"
const page = MOAT_PAGES[PATH]

export default function MoatPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatReadinessDashboard adminToken={admin.token} />}
    </MoatShell>
  )
}
