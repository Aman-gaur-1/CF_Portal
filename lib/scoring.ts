import type { Submission } from '@/types'

import {
  BADGE_LEVELS,
  MILESTONES,
  getBadge as getCanonicalBadge,
  getCourseworkPoints,
  getNextMilestone as getCanonicalNextMilestone,
} from './coursework-scoring'

export { BADGE_LEVELS, MILESTONES }

export function getBadgeInfo(points: number): { icon: string; name: string } {
  return getCanonicalBadge(points)
}

export function getNextMilestone(points: number): number | null {
  return getCanonicalNextMilestone(points)
}

export function calcPhaseScores(rows: Submission[]): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const sub of rows) {
    const phase = sub.phase || 'Unassigned'
    const pts = getCourseworkPoints(sub.submission_type)
    scores[phase] = (scores[phase] ?? 0) + pts
  }
  return scores
}

export function getPhasesInOrder(rows: Submission[]): string[] {
  const seen = new Set<string>()
  const phases: string[] = []
  for (const sub of [...rows].reverse()) {
    const p = sub.phase || 'Unassigned'
    if (!seen.has(p)) { phases.push(p); seen.add(p) }
  }
  return phases
}
