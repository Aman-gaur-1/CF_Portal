"use client"

export default function PaginationControls({ page, totalPages, total, pageSize, onPageChange }) {
  if (!total) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="pagination-row">
      <p>Showing {from}-{to} of {total}</p>
      <div className="flex items-center gap-2">
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </div>
  )
}
