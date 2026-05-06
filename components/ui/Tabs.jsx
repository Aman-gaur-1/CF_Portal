"use client"
export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tab-list mb-6">
      {tabs.map(tab => (
        <button key={tab.id} className={"tab-item " + (active === tab.id ? "active" : "")} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}