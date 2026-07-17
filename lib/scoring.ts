import type { Submission } from '@/types'

export const MILESTONES = [100, 500, 1000, 2000, 5000]
export const BADGE_LEVELS = [
  { threshold: 5000, icon: '💎', name: 'Legend' },
  { threshold: 2000, icon: '🏆', name: 'Master' },
  { threshold: 1000, icon: '🔥', name: 'Dedicated' },
  { threshold: 500,  icon: '⚡', name: 'Active Learner' },
  { threshold: 100,  icon: '🌱', name: 'Beginner' },
  { threshold: 0,    icon: '🆕', name: 'Newcomer' },
]

export function getBadgeInfo(points: number): { icon: string; name: string } {
  return BADGE_LEVELS.find(b => points >= b.threshold) ?? BADGE_LEVELS[BADGE_LEVELS.length - 1]
}

export function getNextMilestone(points: number): number | null {
  return MILESTONES.find(m => points < m) ?? null
}

export function calcPhaseScores(rows: Submission[]): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const sub of rows) {
    const phase = sub.phase || 'Unassigned'
    const pts = sub.submission_type === 'project' ? 200 : 100
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
