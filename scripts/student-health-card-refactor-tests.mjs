import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  HEALTH_CARD_POINTS,
  attendanceDailyTotals,
  deterministicCourseworkLeaderboard,
  healthCardCourseworkPoints,
  normalizeHealthCourseworkType,
} from '../lib/health-card-domain.js'
import { classifyRosterRows, generateLoginId } from '../lib/roster-import.js'

assert.deepEqual(HEALTH_CARD_POINTS, { assignment: 5, project: 10, attendance: 1 })
assert.equal(normalizeHealthCourseworkType('100'), 'assignment')
assert.equal(normalizeHealthCourseworkType('200'), 'project')
assert.equal(healthCardCourseworkPoints('20'), 0)
assert.equal(healthCardCourseworkPoints('50'), 0)

const attendance = attendanceDailyTotals([
  { student_id: 's1', attendance_date: '2026-10-10', status: 'pending', marked_at: '2026-10-10T09:00:00Z' },
  { student_id: 's1', attendance_date: '2026-10-10', status: 'approved', marked_at: '2026-10-10T10:00:00Z' },
  { student_id: 's1', attendance_date: '2026-10-11', status: 'approved', marked_at: '2026-10-11T10:00:00Z' },
])
assert.equal(attendance.approved, 2, 'multiple sessions/rows on one day award one attendance point')
assert.equal(attendance.points, 2)

const ranked = deterministicCourseworkLeaderboard([
  { studentId: 'b', courseworkPoints: 5, attendancePoints: 20 },
  { studentId: 'a', courseworkPoints: 5, attendancePoints: 0 },
])
assert.deepEqual(ranked.map(row => row.studentId), ['a', 'b'], 'leaderboard ties are deterministic and ignore attendance points')

const roster = classifyRosterRows([
  { rowNumber: 2, name: 'New Student', email: '', phone: '', externalStudentId: '' },
  { rowNumber: 3, name: 'Existing Student', email: '', phone: '', externalStudentId: '' },
  { rowNumber: 4, name: 'Existing Student Jr', email: '', phone: '', externalStudentId: '' },
  { rowNumber: 5, name: '', email: '', phone: '', externalStudentId: '' },
], [{ id: 'existing', name: 'Existing Student', batch: 'Batch A' }])
assert.equal(roster.filter(row => row.status === 'new').length, 1)
assert.equal(roster.filter(row => row.status === 'existing').length, 1)
assert.equal(roster.filter(row => row.status === 'possible_duplicate').length, 1)
assert.equal(roster.filter(row => row.status === 'invalid').length, 1)
const used = new Set()
assert.notEqual(generateLoginId('New Student', used), generateLoginId('New Student', used))

const migration = fs.readFileSync(new URL('../supabase/migrations/20261018230000_student_health_card_product_model.sql', import.meta.url), 'utf8')
const submissionRoute = fs.readFileSync(new URL('../app/api/student-submissions/route.js', import.meta.url), 'utf8')
const rosterRoute = fs.readFileSync(new URL('../app/api/admin-roster/route.js', import.meta.url), 'utf8')
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.batch_coursework_assignments/)
assert.match(migration, /source <> 'legacy_backfill'/)
assert.match(migration, /session_date/)
assert.match(submissionRoute, /coursework_item_id/)
assert.match(submissionRoute, /batch_coursework_assignments/)
assert.match(rosterRoute, /hashStudentPasswordSecure/)
assert.doesNotMatch(rosterRoute, /password:.*insert/)

console.log('Student Health Card product refactor tests passed.')
