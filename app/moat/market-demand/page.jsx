"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatMarketDemandExplorer from "@/components/moat/MoatMarketDemandExplorer"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/market-demand"
const page = MOAT_PAGES[PATH]

export default function MoatMarketDemandPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      {({ admin }) => <MoatMarketDemandExplorer adminToken={admin.token} />}
    </MoatShell>
  )
}
