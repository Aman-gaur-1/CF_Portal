"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatSourcesManager from "@/components/moat/MoatSourcesManager"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/sources"
const page = MOAT_PAGES[PATH]

export default function MoatSourcesPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatSourcesManager adminToken={admin.token} />}
    </MoatShell>
  )
}
