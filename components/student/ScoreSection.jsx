"use client"
import { getBadge, getNextMilestone, calcPhaseScores, getPhasesInOrder } from "@/lib/utils"

export default function ScoreSection({ submissions }) {
  if (!submissions.length) return null
  const phaseScores = calcPhaseScores(submissions)
  const phases = getPhasesInOrder(submissions)
  if (!phases.length) return null

  const current = phases[phases.length - 1]
  const score = phaseScores[current] || 0
  const badge = getBadge(score)
  const next = getNextMilestone(score)
  const pct = next ? Math.min((score / next) * 100, 100) : 100
  const archived = phases.slice(0, -1)

  return (
    <div className="mb-6">
      <div className="section-divider">
        <span>🏅</span>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>My Score & Badges</span>
        <div className="line" />
      </div>

      <div className="score-card">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Current Phase: {current}</p>
        <p className="text-5xl font-black gradient-text mb-2">{score}</p>
        <span className="inline-flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full mb-4" style={{ background: badge.bg, color: badge.color }}>
          {badge.icon} {badge.name}
        </span>
        <div className="progress-bar-wrap mb-1"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{next ? `${score} / ${next} pts to next badge` : "Max badge achieved! 🎉"}</p>
      </div>

      {archived.length > 0 && (
        <>
          <p className="text-xs uppercase tracking-widest mb-2 mt-4" style={{ color: "var(--text-muted)" }}>Completed Phases</p>
          {archived.map(p => {
            const s = phaseScores[p] || 0
            const b = getBadge(s)
            return (
              <div key={p} className="flex items-center gap-3 rounded-xl p-3 mb-2" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(124,58,237,0.18)" }}>
                <span className="text-2xl">{b.icon}</span>
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-widest" style={{ color: "var(--accent-light)" }}>{p}</p>
                  <p className="text-sm font-bold">{b.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s} pts earned</p>
                </div>
                <span className="text-xs font-semibold px-2 py-1 rounded" style={{ background: b.bg, color: b.color }}>✅ Done</span>
              </div>
            )
          })}
        </>
      )}
      <hr className="my-5" style={{ border: "none", height: "1px", background: "linear-gradient(90deg,transparent,var(--border),var(--primary-dark),var(--border),transparent)" }} />
    </div>
  )
}