"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatJobsManager from "@/components/moat/MoatJobsManager"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/jobs"
const page = MOAT_PAGES[PATH]

export default function MoatJobsPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatJobsManager adminToken={admin.token} />}
    </MoatShell>
  )
}
