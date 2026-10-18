/**
 * Single source of truth for Health Card display/scoring rules.
 *
 * Database functions mirror these values. Historical rows are normalized at
 * read time; this module never rewrites submissions or attendance records.
 */
export const HEALTH_CARD_POINTS = Object.freeze({
  assignment: 5,
  project: 10,
  attendance: 1,
})

export const HEALTH_CARD_COURSEWORK_TYPES = Object.freeze(['assignment', 'project'])

export function normalizeHealthCourseworkType(value) {
  const type = String(value || '').trim().toLowerCase()
  if (type === 'assignment' || type === '100') return 'assignment'
  if (type === 'project' || type === '200') return 'project'
  return ''
}

export function healthCardCourseworkPoints(value) {
  const type = normalizeHealthCourseworkType(value)
  return HEALTH_CARD_POINTS[type] || 0
}

export function isHealthCardCourseworkType(value) {
  return HEALTH_CARD_COURSEWORK_TYPES.includes(normalizeHealthCourseworkType(value))
}

/**
 * Collapse multiple attendance rows/sessions to one daily fact per student.
 * Approved wins over pending/rejected; otherwise the newest row wins.
 */
export function collapseAttendanceByDay(rows = []) {
  const byDay = new Map()
  const priority = { approved: 3, pending: 2, rejected: 1 }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.student_id || !row?.attendance_date) continue
    const key = `${row.student_id}|${row.attendance_date}`
    const current = byDay.get(key)
    const currentPriority = priority[current?.status] || 0
    const nextPriority = priority[row.status] || 0
    const currentTime = Date.parse(current?.updated_at || current?.marked_at || '') || 0
    const nextTime = Date.parse(row.updated_at || row.marked_at || '') || 0
    if (!current || nextPriority > currentPriority || (nextPriority === currentPriority && nextTime >= currentTime)) {
      byDay.set(key, row)
    }
  }
  return [...byDay.values()].sort((left, right) => String(left.attendance_date).localeCompare(String(right.attendance_date)))
}

export function attendanceDailyTotals(rows = []) {
  const daily = collapseAttendanceByDay(rows)
  return {
    approved: daily.filter(row => row.status === 'approved').length,
    pending: daily.filter(row => row.status === 'pending').length,
    rejected: daily.filter(row => row.status === 'rejected').length,
    points: daily.filter(row => row.status === 'approved').length * HEALTH_CARD_POINTS.attendance,
    daily,
  }
}

export function deterministicCourseworkLeaderboard(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .map(row => ({
      ...row,
      courseworkPoints: Number(row.courseworkPoints ?? row.totalPoints ?? 0) || 0,
    }))
    .sort((left, right) => (
      right.courseworkPoints - left.courseworkPoints
      || (Number(right.completedCount) || 0) - (Number(left.completedCount) || 0)
      || String(left.studentId || left.student_id || '').localeCompare(String(right.studentId || right.student_id || ''))
    ))
    .map((row, index) => ({ ...row, rank: index + 1 }))
}
