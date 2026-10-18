import assert from 'node:assert/strict'
import {
  MATCH_TYPES,
  matchParticipantName,
  matchNamesToStudents,
  normalizeParticipantName,
} from '../lib/attendance-matching.js'
import fs from 'node:fs'
import { getAttendanceApprovalConflict, parseSessionInput, validateSessionScopedAttendance } from '../lib/attendance-session.js'

const students = [
  { id: 'student-1', name: 'Ganesh Raut', batch: 'AG' },
  { id: 'student-2', name: 'Ganesha Rout', batch: 'AG' },
  { id: 'student-3', name: 'Maya Shah', batch: 'AG' },
  { id: 'student-4', name: 'Ganesh Raut', batch: 'AG' },
]

assert.equal(normalizeParticipantName(' Ganesh Raut (Unverified) '), 'ganesh raut')
assert.equal(normalizeParticipantName('Ganesh Raut (External)'), 'ganesh raut')
assert.equal(matchParticipantName({ participantName: 'Ganesh Raut', students }).type, MATCH_TYPES.AMBIGUOUS)
assert.equal(matchParticipantName({ participantName: 'Maya Shah', students }).type, MATCH_TYPES.EXACT)
assert.equal(matchParticipantName({ participantName: 'Shah Maya', students: [students[2]] }).type, MATCH_TYPES.HIGH_CONFIDENCE)
assert.equal(matchParticipantName({ participantName: 'Ganesh Raut (External)', students: [students[0]] }).type, MATCH_TYPES.EXACT)
assert.equal(matchParticipantName({
  participantName: 'Ganish Raut',
  students: [students[0]],
}).type, MATCH_TYPES.HIGH_CONFIDENCE)
assert.equal(matchParticipantName({ participantName: 'Completely Unknown', students }).type, MATCH_TYPES.UNMATCHED)
assert.equal(matchParticipantName({
  participantName: 'Ganesh Raut (External)',
  students,
  aliases: [{ student_id: 'student-3', batch: 'AG', alias: 'Ganesh Raut (External)', normalized_alias: 'ganesh raut', active: true }],
}).type, MATCH_TYPES.ALIAS)

const grouped = matchNamesToStudents(['Maya Shah', 'No Student'], [students[2]])
assert.equal(grouped.matched.length, 1)
assert.equal(grouped.unmatched.length, 1)

const session = parseSessionInput({ date: '2026-10-08', title: 'PDA Class', startTime: '20:15', endTime: '21:15' })
assert.equal(session.value.title, 'PDA Class')
assert.equal(session.value.starts_at, '2026-10-08T20:15:00+05:30')
assert.equal(parseSessionInput({ date: '2026-10-08', startTime: '22:00', endTime: '21:00' }).error, 'Session end time must be after the start time.')

const eligibleSession = {
  id: 'session-1',
  batch: 'Batch A',
  session_date: '2026-10-08',
  source: 'teams_report',
}
assert.equal(validateSessionScopedAttendance({ sessionId: 'session-1', session: eligibleSession, batch: 'Batch A', date: '2026-10-08' }).valid, true)
assert.equal(validateSessionScopedAttendance({ sessionId: '', session: eligibleSession, batch: 'Batch A', date: '2026-10-08' }).reason, 'session_required')
assert.equal(validateSessionScopedAttendance({ sessionId: 'session-1', session: null, batch: 'Batch A', date: '2026-10-08' }).reason, 'session_not_eligible')
assert.equal(validateSessionScopedAttendance({ sessionId: 'legacy-1', session: { ...eligibleSession, id: 'legacy-1', source: 'legacy_backfill' }, batch: 'Batch A', date: '2026-10-08' }).reason, 'legacy_session_not_eligible')
assert.equal(validateSessionScopedAttendance({ sessionId: 'session-1', session: eligibleSession, batch: 'Batch B', date: '2026-10-08' }).reason, 'session_batch_mismatch')
assert.equal(validateSessionScopedAttendance({ sessionId: 'session-1', session: eligibleSession, batch: 'Batch A', date: '2026-10-09' }).reason, 'session_date_mismatch')
assert.equal(validateSessionScopedAttendance({ sessionId: 'session-2', session: { ...eligibleSession, id: 'session-2' }, batch: 'Batch A', date: '2026-10-08' }).valid, true, 'two sessions on one date remain independently eligible')
assert.equal(getAttendanceApprovalConflict([{ status: 'pending', session_id: null }], 'approve'), 'Attendance requires a valid class session before approval.')
assert.equal(getAttendanceApprovalConflict([{ status: 'pending', session_id: null }], 'reject'), null)
assert.equal(getAttendanceApprovalConflict([{ status: 'pending', session_id: 'session-1' }], 'approve'), null)
assert.equal(getAttendanceApprovalConflict([{ status: 'approved', session_id: null }], 'approve'), null, 'approved historical rows are not modified by the approval guard')

const sessionMigration = fs.readFileSync(new URL('../supabase/migrations/20261016150000_attendance_matching_imports_sessions.sql', import.meta.url), 'utf8')
assert.match(sessionMigration, /student_attendance_student_session_idx[\s\S]*ON public\.student_attendance \(student_id, session_id\)[\s\S]*WHERE session_id IS NOT NULL/)

const studentAttendanceRoute = fs.readFileSync(new URL('../app/api/student-attendance/route.js', import.meta.url), 'utf8')
const attendanceDomain = fs.readFileSync(new URL('../lib/attendance-domain.js', import.meta.url), 'utf8')
assert.match(studentAttendanceRoute, /!requestedSessionId/)
assert.match(studentAttendanceRoute, /source: queryDate \? 'student_attendance_query' : 'student_self_mark'/)
assert.match(studentAttendanceRoute, /legacy_backfill/)
const healthCardMigration = fs.readFileSync(new URL('../supabase/migrations/20261008120000_student_health_card_foundation.sql', import.meta.url), 'utf8')
assert.match(healthCardMigration, /FILTER \(WHERE ar\.status = 'approved' AND ar\.working_day\)/, 'pending attendance issue rows cannot earn attendance points')
const attendanceUploadRoute = fs.readFileSync(new URL('../app/api/attendance-upload/route.js', import.meta.url), 'utf8')
assert.match(attendanceUploadRoute, /session_id: sessionRow\.id/)
assert.match(attendanceUploadRoute, /source: 'teams_report'/)
assert.match(attendanceDomain, /session_id: session\.id/)

const adminAttendanceRoute = fs.readFileSync(new URL('../app/api/admin-attendance/route.js', import.meta.url), 'utf8')
const teacherAttendanceRoute = fs.readFileSync(new URL('../app/api/teacher-attendance/route.js', import.meta.url), 'utf8')
assert.match(adminAttendanceRoute, /getAttendanceApprovalConflict\(pendingRows, action\)/)
assert.match(teacherAttendanceRoute, /getAttendanceApprovalConflict\(pendingRows, action\)/)
assert.match(adminAttendanceRoute, /source === 'legacy_backfill'/)
assert.match(teacherAttendanceRoute, /source === 'legacy_backfill'/)
assert.match(attendanceDomain, /A valid class session is required before linking attendance/)
assert.doesNotMatch(attendanceDomain, /if \(!row\.session_id\)[\s\S]*ensureAttendanceSession/)

console.log('Attendance matching and session tests passed.')
