"use client"
import { useEffect, useRef } from "react"

export default function SmartSearchInput({ value, onChange, placeholder = "Search student, topic, batch, trainer..." }) {
  const inputRef = useRef(null)

  useEffect(() => {
    function focusSearch(event) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return
      if (
        event.target instanceof HTMLElement &&
        event.target !== inputRef.current &&
        (event.target.matches("input, textarea, select") || event.target.isContentEditable)
      ) return
      event.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="input pr-16"
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold"
          style={{ color: "var(--text-muted)" }}
          onClick={() => {
            onChange("")
            inputRef.current?.focus()
          }}
          aria-label="Clear search"
        >
          Clear
        </button>
      )}
    </div>
  )
}
