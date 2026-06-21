"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatSourceDiscoveryManager from "@/components/moat/MoatSourceDiscoveryManager"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/source-discovery"
const page = MOAT_PAGES[PATH]

export default function MoatSourceDiscoveryPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatSourceDiscoveryManager adminToken={admin.token} />}
    </MoatShell>
  )
}
