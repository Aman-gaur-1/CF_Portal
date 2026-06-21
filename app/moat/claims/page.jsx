"use client"
import MoatShell from "@/components/moat/MoatShell"
import MoatPlaceholder from "@/components/moat/MoatPlaceholder"
import { MOAT_PAGES } from "@/components/moat/moatPages"

const PATH = "/moat/claims"
const page = MOAT_PAGES[PATH]

export default function MoatClaimsPage() {
  return (
    <MoatShell activePath={PATH} title={page.title} description={page.description}>
      <MoatPlaceholder eyebrow={page.eyebrow} title={page.title}>{page.body}</MoatPlaceholder>
    </MoatShell>
  )
}
