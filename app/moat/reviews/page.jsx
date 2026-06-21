"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatReviewsExplorer from "@/components/moat/MoatReviewsExplorer"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/reviews"
const page = MOAT_PAGES[PATH]

export default function MoatReviewsPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatReviewsExplorer adminToken={admin.token} />}
    </MoatShell>
  )
}
