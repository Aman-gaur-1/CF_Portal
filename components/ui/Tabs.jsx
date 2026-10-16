"use client"
export default function Tabs({ tabs, active, onChange, className = "" }) {
  return (
    <div className={`tab-list mb-6 ${className}`.trim()} role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={"tab-item " + (active === tab.id ? "active" : "")}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
