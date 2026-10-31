const DEFAULT_GAP = 8
const DEFAULT_PADDING = 12
const DEFAULT_MAX_HEIGHT = 450
const USEFUL_HEIGHT = 220

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function calculateBatchPickerPosition(rect, viewport, {
  gap = DEFAULT_GAP,
  padding = DEFAULT_PADDING,
  maxHeight = DEFAULT_MAX_HEIGHT,
} = {}) {
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0)
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0)
  const safeWidth = Math.max(0, viewportWidth - padding * 2)
  const width = Math.min(Math.max(0, Number(rect?.width) || 0), safeWidth)
  const left = clamp(Number(rect?.left) || 0, padding, Math.max(padding, viewportWidth - padding - width))
  const spaceBelow = Math.max(0, viewportHeight - (Number(rect?.bottom) || 0) - gap - padding)
  const spaceAbove = Math.max(0, (Number(rect?.top) || 0) - gap - padding)
  const usefulHeight = Math.min(USEFUL_HEIGHT, Math.max(spaceBelow, spaceAbove))
  const placement = spaceBelow >= usefulHeight || spaceBelow >= spaceAbove ? "below" : "above"
  const availableHeight = placement === "below" ? spaceBelow : spaceAbove
  const boundedMaxHeight = Math.max(0, Math.min(maxHeight, availableHeight))
  const rawTop = placement === "below"
    ? (Number(rect?.bottom) || 0) + gap
    : (Number(rect?.top) || 0) - gap - boundedMaxHeight
  const top = clamp(rawTop, padding, Math.max(padding, viewportHeight - padding - boundedMaxHeight))

  return {
    left,
    top,
    width,
    minWidth: width,
    maxWidth: safeWidth,
    maxHeight: boundedMaxHeight,
    placement,
    spaceAbove,
    spaceBelow,
  }
}
