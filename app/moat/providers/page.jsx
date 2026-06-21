"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatProvidersManager from "@/components/moat/MoatProvidersManager"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/providers"
const page = MOAT_PAGES[PATH]

export default function MoatProvidersPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatProvidersManager adminToken={admin.token} />}
    </MoatShell>
  )
}
