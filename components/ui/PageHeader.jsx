export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  className = "",
}) {
  return (
    <header className={`portal-page-header ${className}`.trim()}>
      <div className="portal-page-header-copy">
        {eyebrow && <p className="portal-eyebrow">{eyebrow}</p>}
        <h1 className="portal-page-title">{title}</h1>
        {subtitle && <p className="portal-page-subtitle">{subtitle}</p>}
        {meta && <div className="portal-page-meta">{meta}</div>}
      </div>
      {actions && <div className="portal-page-actions">{actions}</div>}
    </header>
  )
}
