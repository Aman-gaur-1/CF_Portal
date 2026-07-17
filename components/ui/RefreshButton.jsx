"use client"
import Spinner from "@/components/ui/Spinner"

export default function RefreshButton({
  onClick,
  refreshing = false,
  disabled = false,
  label = "Refresh",
  updatedLabel = "",
  size = "sm",
  className = "",
}) {
  const buttonSize = size === "xs" ? "btn-xs" : "btn-sm"
  return (
    <div className="refresh-action">
      <button
        type="button"
        className={`btn btn-secondary ${buttonSize} refresh-button ${className}`}
        onClick={onClick}
        disabled={disabled || refreshing}
      >
        {refreshing ? <Spinner size="sm" /> : <span className="refresh-icon" aria-hidden>↻</span>}
        <span>{refreshing ? "Refreshing..." : label}</span>
      </button>
      {updatedLabel && <span className="refresh-updated">{updatedLabel}</span>}
    </div>
  )
}
