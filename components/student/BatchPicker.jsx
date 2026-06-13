"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"

export default function BatchPicker({ value, onChange, batches, label = "Batch" }) {
  const pickerRef = useRef(null)
  const triggerRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [panelPosition, setPanelPosition] = useState(null)

  const options = useMemo(
    () => batches.map((batch) => ({ raw: String(batch || ""), searchText: String(batch || "").toLowerCase() })),
    [batches]
  )
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery
      ? options.filter((option) => option.searchText.includes(normalizedQuery))
      : options
  }, [options, query])

  const positionPanel = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    const gap = 8
    const viewportPadding = 16
    const isMobile = window.innerWidth < 640
    const maxHeight = Math.min(450, window.innerHeight - (viewportPadding * 2))
    const openBelow = isMobile || window.innerHeight - rect.bottom >= Math.min(maxHeight, rect.top)
    const availableHeight = openBelow
      ? window.innerHeight - rect.bottom - gap - viewportPadding
      : rect.top - gap - viewportPadding

    setPanelPosition({
      top: openBelow ? `calc(100% + ${gap}px)` : "auto",
      bottom: openBelow ? "auto" : `calc(100% + ${gap}px)`,
      right: 0,
      width: "100%",
      maxHeight: Math.max(220, Math.min(maxHeight, availableHeight)),
      placement: openBelow ? "below" : "above",
    })
  }, [])

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setActiveIndex(Math.max(0, options.findIndex((option) => option.raw === value)))
    positionPanel()
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open, options, positionPanel, value])

  useEffect(() => {
    if (!open) return

    window.addEventListener("resize", positionPanel)
    window.addEventListener("scroll", positionPanel, true)
    return () => {
      window.removeEventListener("resize", positionPanel)
      window.removeEventListener("scroll", positionPanel, true)
    }
  }, [open, positionPanel])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-batch-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function closePicker({ restoreFocus = false } = {}) {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function selectOption(option) {
    onChange(option.raw)
    closePicker({ restoreFocus: true })
  }

  function moveActive(step) {
    if (!filteredOptions.length) return
    setActiveIndex((current) => {
      const next = current + step
      if (next < 0) return filteredOptions.length - 1
      if (next >= filteredOptions.length) return 0
      return next
    })
  }

  function handleSearchKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (filteredOptions[activeIndex]) selectOption(filteredOptions[activeIndex])
    } else if (event.key === "Escape") {
      event.preventDefault()
      closePicker({ restoreFocus: true })
    } else if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(Math.max(0, filteredOptions.length - 1))
    }
  }

  function handleTriggerKeyDown(event) {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault()
      setOpen(true)
    } else if (event.key === "Escape") {
      closePicker()
    }
  }

  return (
    <div className="batch-picker" ref={pickerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`batch-picker-trigger ${open ? "is-open" : ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={value ? "" : "batch-picker-placeholder"}>{value || "Select your batch"}</span>
        <span className="batch-picker-chevron" aria-hidden="true">v</span>
      </button>

      {open && panelPosition && (
        <div
          className={`batch-picker-panel is-${panelPosition.placement}`}
          style={{
            top: panelPosition.top,
            right: panelPosition.right,
            bottom: panelPosition.bottom,
            width: panelPosition.width,
            maxHeight: panelPosition.maxHeight,
          }}
        >
          <div className="batch-picker-search-wrap">
            <input
              ref={searchRef}
              type="search"
              className="batch-picker-search"
              placeholder="Search batch, trainer, date or time..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label="Search batches"
              aria-controls={listboxId}
            />
          </div>

          <div id={listboxId} ref={listRef} className="batch-picker-options" role="listbox" aria-label="Available batches">
            {filteredOptions.length ? filteredOptions.map((option, index) => {
              const isSelected = option.raw === value
              const isActive = index === activeIndex

              return (
                <button
                  type="button"
                  key={option.raw}
                  data-batch-index={index}
                  className={`batch-picker-option ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span className="batch-picker-option-copy">{option.raw}</span>
                  {isSelected && <span className="batch-picker-check" aria-hidden="true">&#10003;</span>}
                </button>
              )
            }) : (
              <div className="batch-picker-empty">No matching batches found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
