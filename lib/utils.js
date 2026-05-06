export async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password.trim())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function sanitizeFilename(text) {
  return (text || '').trim().replace(/\s+/g, '_').replace(/[^\w\-.]/g, '') || 'unknown'
}

export const BADGE_LEVELS = [
  { threshold: 5000, icon: '💎', name: 'Legend' },
  { threshold: 2000, icon: '🏆', name: 'Master' },
  { threshold: 1000, icon: '🔥', name: 'Dedicated' },
  { threshold: 500, icon: '⚡', name: 'Active Learner' },
  { threshold: 100, icon: '🌱', name: 'Beginner' },
  { threshold: 0, icon: '🆕', name: 'Newcomer' },
]

export const MILESTONES = [100, 500, 1000, 2000, 5000]

export function getBadge(points) {
  return BADGE_LEVELS.find(b => points >= b.threshold) || BADGE_LEVELS[BADGE_LEVELS.length - 1]
}

export function getNextMilestone(points) {
  return MILESTONES.find(m => points < m) || null
}

export function getPoints(subType) {
  return subType === 'project' ? 200 : 100
}

export function calcPhaseScores(submissions) {
  return submissions.reduce((acc, sub) => {
    const phase = sub.phase || 'Python'
    acc[phase] = (acc[phase] || 0) + getPoints(sub.submission_type)
    return acc
  }, {})
}

export function getPhasesInOrder(submissions) {
  const seen = new Set(), phases = []
  for (const sub of [...submissions].reverse()) {
    const p = sub.phase || 'Python'
    if (!seen.has(p)) { phases.push(p); seen.add(p) }
  }
  return phases
}

export const BROWSER_RENDERABLE = new Set(['pdf','html','png','jpg','jpeg','gif','svg','txt','py'])

export function formatDate(iso) {
  return iso ? iso.slice(0, 10) : '—'
}
