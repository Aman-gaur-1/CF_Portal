"use client"

import { createPortal } from "react-dom"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { filterBatchOptions, sortBatchOptions } from "@/lib/batch-picker"
import { calculateBatchPickerPosition } from "@/lib/batch-picker-position"

function useBatchPickerPosition(triggerRef, open) {
  const [panelPosition, setPanelPosition] = useState(null)

  const positionPanel = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    setPanelPosition(calculateBatchPickerPosition(rect, {
      width: window.innerWidth,
      height: window.innerHeight,
    }))
  }, [triggerRef])

  useEffect(() => {
    if (!open) {
      setPanelPosition(null)
      return
    }
    positionPanel()
    window.addEventListener("resize", positionPanel)
    window.addEventListener("scroll", positionPanel, true)
    return () => {
      window.removeEventListener("resize", positionPanel)
      window.removeEventListener("scroll", positionPanel, true)
    }
  }, [open, positionPanel])

  return panelPosition
}

function useOutsideClose(pickerRef, panelRef, setOpen) {
  useEffect(() => {
    function handleOutsideClick(event) {
      if (!pickerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false)
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [panelRef, pickerRef, setOpen])
}

function PickerOption({ option, index, activeIndex, selected, onMouseEnter, onClick, multi = false }) {
  return (
    <button
      type="button"
      data-batch-index={index}
      className={`batch-picker-option ${selected ? "is-selected" : ""} ${index === activeIndex ? "is-active" : ""}`}
      role="option"
      aria-selected={selected}
      aria-checked={multi ? selected : undefined}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="batch-picker-option-copy">{option.label}</span>
      {selected && <span className="batch-picker-check" aria-hidden="true">✓</span>}
    </button>
  )
}

export default function SearchableBatchSelect({
  batches = [],
  value = "",
  onChange,
  placeholder = "Select batch",
  disabled = false,
  required = false,
  label = "Batch",
  allOption = false,
  allValue = "",
  allLabel = "All batches",
  allowClear = false,
  className = "",
}) {
  const pickerRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const panelPosition = useBatchPickerPosition(triggerRef, open)

  useOutsideClose(pickerRef, panelRef, setOpen)

  const options = useMemo(() => sortBatchOptions(batches), [batches])
  const specialOptions = useMemo(() => {
    const special = []
    if (allOption) special.push({ value: allValue, label: allLabel, special: true })
    else if (placeholder) special.push({ value: "", label: placeholder, special: true })
    if (allowClear && value) special.push({ value: "", label: "Clear selection", special: true })
    return special
  }, [allLabel, allOption, allValue, allowClear, placeholder, value])
  const allOptions = useMemo(() => [...specialOptions, ...options], [options, specialOptions])
  const filteredOptions = useMemo(() => filterBatchOptions(allOptions, query), [allOptions, query])
  const selectedOption = options.find(option => option.value === value)
  const triggerLabel = allOption && value === allValue
    ? allLabel
    : selectedOption?.label || (value || placeholder)

  useEffect(() => {
    if (!open) return
    setQuery("")
    const selectedIndex = allOptions.findIndex(option => option.value === value && !option.special)
    setActiveIndex(Math.max(0, selectedIndex))
  }, [open])

  useEffect(() => {
    if (open && panelPosition) requestAnimationFrame(() => searchRef.current?.focus())
  }, [open, panelPosition])

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
    onChange?.(option.value)
    closePicker({ restoreFocus: true })
  }

  function moveActive(step) {
    if (!filteredOptions.length) return
    setActiveIndex(current => {
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

  const panel = open && panelPosition ? (
    <div
      ref={panelRef}
      className={`batch-picker-panel is-${panelPosition.placement}`}
      style={{
        left: panelPosition.left,
        top: panelPosition.top,
        width: panelPosition.width,
        minWidth: panelPosition.minWidth,
        maxWidth: panelPosition.maxWidth,
        maxHeight: panelPosition.maxHeight,
      }}
    >
      <div className="batch-picker-search-wrap">
        <input
          ref={searchRef}
          type="search"
          className="batch-picker-search"
          placeholder="Search batches..."
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          aria-label={`Search ${label.toLowerCase()}`}
          aria-controls={listboxId}
        />
      </div>
      <div id={listboxId} ref={listRef} className="batch-picker-options" role="listbox" aria-label={`${label} options`}>
        {filteredOptions.length ? filteredOptions.map((option, index) => (
          <PickerOption
            key={`${option.special ? "special" : "batch"}-${option.value}-${option.label}`}
            option={option}
            index={index}
            activeIndex={activeIndex}
            selected={option.special ? allOption && option.value === value : option.value === value}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => selectOption(option)}
          />
        )) : <div className="batch-picker-empty">No batches found</div>}
      </div>
    </div>
  ) : null

  return (
    <div className={`batch-picker ${className}`.trim()} ref={pickerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`batch-picker-trigger ${open ? "is-open" : ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-label={label}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={!value || (allOption && value === allValue) ? "batch-picker-placeholder" : ""}>{triggerLabel}</span>
        <span className="batch-picker-chevron" aria-hidden="true">⌄</span>
      </button>

      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}

export function SearchableBatchMultiSelect({
  batches = [],
  values = [],
  onChange,
  placeholder = "Select batches",
  disabled = false,
  required = false,
  label = "Batches",
  allowClear = true,
  className = "",
}) {
  const pickerRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const panelPosition = useBatchPickerPosition(triggerRef, open)

  useOutsideClose(pickerRef, panelRef, setOpen)

  const options = useMemo(() => sortBatchOptions(batches), [batches])
  const filteredOptions = useMemo(() => filterBatchOptions(options, query), [options, query])
  const selectedSet = useMemo(() => new Set(values.map(value => String(value))), [values])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setActiveIndex(0)
  }, [open])

  useEffect(() => {
    if (open && panelPosition) requestAnimationFrame(() => searchRef.current?.focus())
  }, [open, panelPosition])

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

  function toggleOption(option) {
    const next = selectedSet.has(option.value)
      ? values.filter(value => String(value) !== option.value)
      : [...values, option.value]
    onChange?.(next)
  }

  function moveActive(step) {
    if (!filteredOptions.length) return
    setActiveIndex(current => {
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
      if (filteredOptions[activeIndex]) toggleOption(filteredOptions[activeIndex])
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

  const panel = open && panelPosition ? (
    <div
      ref={panelRef}
      className={`batch-picker-panel is-${panelPosition.placement}`}
      style={{
        left: panelPosition.left,
        top: panelPosition.top,
        width: panelPosition.width,
        minWidth: panelPosition.minWidth,
        maxWidth: panelPosition.maxWidth,
        maxHeight: panelPosition.maxHeight,
      }}
    >
      <div className="batch-picker-search-wrap">
        <input
          ref={searchRef}
          type="search"
          className="batch-picker-search"
          placeholder="Search batches..."
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          aria-label={`Search ${label.toLowerCase()}`}
          aria-controls={listboxId}
        />
        {allowClear && values.length > 0 && <button type="button" className="batch-picker-clear" onClick={() => onChange?.([])}>Clear selection</button>}
      </div>
      <div id={listboxId} ref={listRef} className="batch-picker-options" role="listbox" aria-label={`${label} options`} aria-multiselectable="true">
        {filteredOptions.length ? filteredOptions.map((option, index) => (
          <PickerOption
            key={`batch-${option.value}-${option.label}`}
            option={option}
            index={index}
            activeIndex={activeIndex}
            selected={selectedSet.has(option.value)}
            multi
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => toggleOption(option)}
          />
        )) : <div className="batch-picker-empty">No batches found</div>}
      </div>
    </div>
  ) : null

  return (
    <div className={`batch-picker ${className}`.trim()} ref={pickerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`batch-picker-trigger ${open ? "is-open" : ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-label={label}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={!values.length ? "batch-picker-placeholder" : ""}>{values.length ? `Selected: ${values.length}` : placeholder}</span>
        <span className="batch-picker-chevron" aria-hidden="true">⌄</span>
      </button>

      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
