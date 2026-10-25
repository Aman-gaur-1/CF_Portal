export const STUDENT_STATUS_ACTIVE = 'active'
export const STUDENT_STATUS_INACTIVE = 'inactive'
export const STUDENT_STATUSES = Object.freeze([STUDENT_STATUS_ACTIVE, STUDENT_STATUS_INACTIVE])

export function normalizeStudentStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  return STUDENT_STATUSES.includes(status) ? status : ''
}

export function isActiveStudent(student) {
  return normalizeStudentStatus(student?.status || STUDENT_STATUS_ACTIVE) === STUDENT_STATUS_ACTIVE
}
