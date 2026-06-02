export const PAGE_SIZE = 50

export function parsePage(value) {
  const page = Number.parseInt(value, 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

export function pageRange(page, pageSize = PAGE_SIZE) {
  const from = (parsePage(page) - 1) * pageSize
  return { from, to: from + pageSize - 1 }
}

export function paginationMeta(page, total, pageSize = PAGE_SIZE) {
  const currentPage = parsePage(page)
  const totalRows = Math.max(Number(total) || 0, 0)
  const totalPages = Math.max(Math.ceil(totalRows / pageSize), 1)
  return {
    page: Math.min(currentPage, totalPages),
    pageSize,
    total: totalRows,
    totalPages,
  }
}
