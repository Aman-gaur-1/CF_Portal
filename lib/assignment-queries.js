import { getBoolean } from '@/lib/system-settings'

export const QUERY_STATUS = {
  OPEN: 'open',
  RESOLVED: 'resolved',
}

const VALID_QUERY_STATUSES = new Set(Object.values(QUERY_STATUS))
const MAX_QUERY_TEXT_LENGTH = 2000
const MAX_RESPONSE_TEXT_LENGTH = 4000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function isStudentQueryEnabled(options = {}) {
  return getBoolean('STUDENT_QUERY_ENABLED', false, options)
}

export function normalizeQueryStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  return VALID_QUERY_STATUSES.has(status) ? status : QUERY_STATUS.OPEN
}

export function sanitizeQueryText(value) {
  return String(value || '').trim().replace(/\s+\n/g, '\n').slice(0, MAX_QUERY_TEXT_LENGTH)
}

export function sanitizeQueryResponse(value) {
  return String(value || '').trim().replace(/\s+\n/g, '\n').slice(0, MAX_RESPONSE_TEXT_LENGTH)
}

export function isValidQueryId(value) {
  return UUID_RE.test(String(value || '').trim())
}

export function normalizeStudentIdentity(value = {}) {
  return {
    id: String(value.id || value.studentId || '').trim(),
    name: String(value.name || value.studentName || '').trim(),
    batch: String(value.batch || value.studentBatch || '').trim(),
  }
}

export function isPublishedSubmission(submission) {
  return Boolean(String(submission?.feedback || '').trim() || submission?.feedback_at)
}

export function serializeAssignmentQuery(row) {
  if (!row) return null
  const submission = row.submission || row.submissions || null
  const student = row.student || row.students || null
  return {
    id: row.id,
    submission_id: row.submission_id,
    student_id: row.student_id,
    query_text: row.query_text,
    status: normalizeQueryStatus(row.status),
    trainer_response: row.trainer_response || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by || '',
    updated_by: row.updated_by || '',
    resolved_at: row.resolved_at || null,
    resolved_by: row.resolved_by || '',
    student: student ? {
      id: student.id,
      name: student.name || '',
      email: student.email || student.student_email || '',
      phone: student.phone || student.mobile || student.contact || student.contact_number || '',
    } : null,
    submission: submission ? {
      id: submission.id,
      student_name: submission.student_name || '',
      batch: submission.batch || '',
      topic: submission.topic || '',
      phase: submission.phase || '',
      feedback: submission.feedback || '',
      submitted_at: submission.submitted_at || null,
      ai_feedback_at: submission.ai_feedback_at || null,
      feedback_at: submission.feedback_at || null,
      feedback_by: submission.feedback_by || '',
      trainer_name: submission.trainer_name || '',
    } : null,
  }
}

export function serializeAssignmentQueries(rows = []) {
  return rows.map(serializeAssignmentQuery).filter(Boolean)
}
