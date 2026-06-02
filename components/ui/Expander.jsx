"use client"
import { useState } from "react"

export default function Expander({ title, header, badge, children, defaultOpen = false, open: controlledOpen, onToggle }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const open = controlledOpen ?? localOpen

  function toggle() {
    if (onToggle) onToggle(!open)
    else setLocalOpen(!open)
  }

  return (
    <div className="expander">
      <button className="expander-header" onClick={toggle}>
        {header || <span>{title}</span>}
        <div className="flex items-center gap-2">{badge}<span style={{color:"var(--text-muted)",fontSize:"0.9rem"}}>{open ? "▲" : "▼"}</span></div>
      </button>
      {open && <div className="expander-body">{children}</div>}
    </div>
  )
}
