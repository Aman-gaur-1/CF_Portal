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
  { threshold: 5000, icon: '💎', name: 'Legend', bg: 'linear-gradient(135deg,#db2777,#f97316)', color: '#ffffff' },
  { threshold: 2000, icon: '🏆', name: 'Master', bg: 'linear-gradient(135deg,#7c3aed,#38bdf8)', color: '#ffffff' },
  { threshold: 1000, icon: '🔥', name: 'Dedicated', bg: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#ffffff' },
  { threshold: 500, icon: '⚡', name: 'Active Learner', bg: 'linear-gradient(135deg,#22c55e,#14b8a6)', color: '#ffffff' },
  { threshold: 100, icon: '🌱', name: 'Beginner', bg: 'linear-gradient(135deg,#818cf8,#a78bfa)', color: '#111827' },
  { threshold: 0, icon: '🆕', name: 'Newcomer', bg: 'linear-gradient(135deg,#38bdf8,#bfdbfe)', color: '#111827' },
]

export const MILESTONES = [100, 500, 1000, 2000, 5000]

export function getBadge(points) {
  return BADGE_LEVELS.find(b => points >= b.threshold) || BADGE_LEVELS[BADGE_LEVELS.length - 1]
}

export function getNextMilestone(points) {
  return MILESTONES.find(m => points < m) || null
}

export function getPoints(subType) {
  if (subType === 'project') return 200
  if (subType === 'assignment') return 100
  if (typeof subType === 'string' && /^[0-9]+$/.test(subType)) return Number(subType)
  return 100
}

export function getTypeLabel(subType) {
  if (subType === 'project' || subType === '200') return 'Project'
  if (subType === 'assignment' || subType === '100') return 'Assignment'
  if (subType === '50') return 'Small Task'
  if (subType === '20') return 'Micro Task'
  if (subType === 'custom') return 'Manual points'
  if (typeof subType === 'string' && /^[0-9]+$/.test(subType)) return `${subType} pts`
  return 'Assignment'
}

export function getTypeEmoji(subType) {
  if (subType === 'project' || subType === '200') return '🚀'
  if (subType === 'assignment' || subType === '100') return '📝'
  if (subType === '50') return '✨'
  if (subType === '20') return '⚡'
  if (subType === 'custom') return '🔧'
  if (typeof subType === 'string' && /^[0-9]+$/.test(subType)) return '🔢'
  return '📝'
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
