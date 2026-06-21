const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export function parseMoatLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, MAX_LIMIT)
}

export function parseMoatPage(value) {
  const parsed = Number.parseInt(value || '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function paginateMoatArray(items, { page = 1, limit = DEFAULT_LIMIT } = {}) {
  const safePage = parseMoatPage(page)
  const safeLimit = parseMoatLimit(limit)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / safeLimit))
  const from = (safePage - 1) * safeLimit
  const rows = items.slice(from, from + safeLimit)

  return {
    rows,
    pagination: {
      page: safePage,
      page_size: safeLimit,
      total,
      total_pages: totalPages,
      has_previous: safePage > 1,
      has_next: safePage < totalPages,
      limited: total > rows.length,
    },
  }
}
