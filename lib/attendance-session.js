export const DEFAULT_SESSION_TITLE = 'Attendance report'
export const ATTENDANCE_APPROVAL_SESSION_ERROR = 'Attendance requires a valid class session before approval.'

export function getAttendanceApprovalConflict(rows = [], action = '') {
  if (action !== 'approve') return null
  if ((rows || []).some(row => row?.status === 'pending' && !String(row?.session_id || '').trim())) {
    return ATTENDANCE_APPROVAL_SESSION_ERROR
  }
  return null
}

export function normalizeSessionTitle(value) {
  const title = String(value || '').trim()
  return title.slice(0, 180) || DEFAULT_SESSION_TITLE
}

export function normalizeSessionTimestamp({ date, time, fallback = null }) {
  const raw = String(time || '').trim()
  if (!raw) return fallback
  if (!/^\d{2}:\d{2}$/.test(raw)) return ''
  const [hours, minutes] = raw.split(':').map(Number)
  if (hours > 23 || minutes > 59) return ''
  return `${date}T${raw}:00+05:30`
}

export function parseSessionInput({ date, title, startTime, endTime }) {
  const startsAt = normalizeSessionTimestamp({ date, time: startTime })
  const endsAt = normalizeSessionTimestamp({ date, time: endTime })
  if (startsAt === '' || endsAt === '') return { error: 'Session time must use HH:MM.' }
  if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) return { error: 'Session end time must be after the start time.' }
  return {
    value: {
      title: normalizeSessionTitle(title),
      starts_at: startsAt,
      ends_at: endsAt,
    },
  }
}

export function validateSessionScopedAttendance({ sessionId, session, batch, date } = {}) {
  const requestedSessionId = String(sessionId || '').trim()
  if (!requestedSessionId) return { valid: false, reason: 'session_required' }
  if (!session || String(session.id || '') !== requestedSessionId) {
    return { valid: false, reason: 'session_not_eligible' }
  }
  if (session.source === 'legacy_backfill') {
    return { valid: false, reason: 'legacy_session_not_eligible' }
  }
  if (batch && String(session.batch || '') !== String(batch)) {
    return { valid: false, reason: 'session_batch_mismatch' }
  }
  const sessionDate = session.session_date || session.sessionDate
  if (date && String(sessionDate || '') !== String(date)) {
    return { valid: false, reason: 'session_date_mismatch' }
  }
  return { valid: true, reason: '' }
}
