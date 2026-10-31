"use client"

import { calculateLifetimeCoursework, formatCourseworkPoints, getBadge, getNextMilestone } from "@/lib/coursework-scoring"

export default function ScoreSection({ submissions, courseworkSummary }) {
  if (!submissions.length) return null

  const summary = courseworkSummary || calculateLifetimeCoursework(submissions)
  const score = Number(summary.points) || 0
  const badge = getBadge(score)
  const next = getNextMilestone(score)
  const pct = next ? Math.min((score / next) * 100, 100) : 100
  const assignmentCount = Number(summary.assignmentCount) || 0
  const projectCount = Number(summary.projectCount) || 0

  return (
    <div className="mb-6">
      <div className="section-divider">
        <span>🏅</span>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Points & Badges</span>
        <div className="line" />
      </div>

      <div className="score-card">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Coursework Points</p>
        <p className="text-5xl font-black gradient-text mb-2">{formatCourseworkPoints(score)} pts</p>
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          {assignmentCount} assignments · {projectCount} projects
        </p>
        <span className="inline-flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full mb-4" style={{ background: badge.bg, color: badge.color }}>
          {badge.icon} {badge.name}
        </span>
        <div className="progress-bar-wrap mb-1"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{next ? `${formatCourseworkPoints(score)} / ${formatCourseworkPoints(next)} pts to next badge` : "Max badge achieved! 🎉"}</p>
      </div>

      <hr className="my-5" style={{ border: "none", height: "1px", background: "linear-gradient(90deg,transparent,var(--border),var(--divider-color),var(--border),transparent)" }} />
    </div>
  )
}
