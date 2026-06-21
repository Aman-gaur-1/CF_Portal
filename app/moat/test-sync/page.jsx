"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatTestSyncManager from "@/components/moat/MoatTestSyncManager"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/test-sync"
const page = MOAT_PAGES[PATH]

export default function MoatTestSyncPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatTestSyncManager adminToken={admin.token} />}
    </MoatShell>
  )
}
