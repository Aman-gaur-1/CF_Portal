export default function SectionHeading({ title, detail, action, className = "" }) {
  return (
    <div className={`section-heading ${className}`.trim()}>
      <div className="section-heading-copy">
        <h2 className="section-heading-title">{title}</h2>
        {detail && <p className="section-heading-detail">{detail}</p>}
      </div>
      {action && <div className="section-heading-action">{action}</div>}
    </div>
  )
}
