export default function MoatPlaceholder({ eyebrow, title, children }) {
  return (
    <section className="card admin-panel">
      <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{eyebrow}</p>
      <h2 className="text-lg font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{title}</h2>
      <p className="text-sm mt-3" style={{ color: "var(--text-secondary)" }}>
        {children}
      </p>
    </section>
  )
}
