"use client"
import { useState } from "react"
export default function Expander({ title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="expander">
      <button className="expander-header" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <div className="flex items-center gap-2">{badge}<span style={{color:"var(--text-muted)",fontSize:"0.9rem"}}>{open ? "▲" : "▼"}</span></div>
      </button>
      {open && <div className="expander-body">{children}</div>}
    </div>
  )
}