"use client"
import { useState, useEffect } from "react"

const THEMES = [
  { id: "auto",  label: "⚙️ Auto" },
  { id: "dark",  label: "🌙 Dark" },
  { id: "light", label: "☀️ Light" },
]

export default function ThemeToggle() {
  const [theme, setTheme] = useState("auto")

  useEffect(() => {
    const saved = localStorage.getItem("cf_theme") || "auto"
    setTheme(saved)
    applyToDOM(saved)
  }, [])

  function applyToDOM(id) {
    const html = document.documentElement
    if (id === "auto") html.removeAttribute("data-theme")
    else html.setAttribute("data-theme", id)
  }

  function handleChange(id) {
    setTheme(id)
    localStorage.setItem("cf_theme", id)
    applyToDOM(id)
  }

  return (
    <div className="theme-toggle">
      {THEMES.map(t => (
        <button
          key={t.id}
          className={"theme-btn" + (theme === t.id ? " active" : "")}
          onClick={() => handleChange(t.id)}
          title={t.id === "auto" ? "Follow system theme" : t.label}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
