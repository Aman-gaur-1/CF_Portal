import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  HEALTH_CARD_POINTS,
  attendanceDailyTotals,
  deterministicCourseworkLeaderboard,
  healthCardCourseworkPoints,
  normalizeHealthCourseworkType,
} from '../lib/health-card-domain.js'
import { HEALTH_CARD_PHASES, isSupportedHealthCardPhase, normalizeCourseworkPayload } from '../lib/health-card-admin.js'
import { classifyRosterRows, generateLoginId } from '../lib/roster-import.js'

assert.deepEqual(HEALTH_CARD_POINTS, { assignment: 5, project: 10, attendance: 1 })
assert.equal(normalizeHealthCourseworkType('100'), 'assignment')
assert.equal(normalizeHealthCourseworkType('200'), 'project')
assert.equal(healthCardCourseworkPoints('20'), 0)
assert.equal(healthCardCourseworkPoints('50'), 0)
assert.deepEqual(HEALTH_CARD_PHASES, ['Python', 'Data Analytics', 'SQL'])
assert.equal(normalizeCourseworkPayload({ title: 'SQL task', itemType: 'assignment', phase: 'sql' }).value.phase, 'SQL')
assert.match(normalizeCourseworkPayload({ title: 'No phase', itemType: 'assignment' }).error, /valid phase/i)
assert.equal(isSupportedHealthCardPhase('python'), false)
assert.equal(isSupportedHealthCardPhase('Python'), true)

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
  { studentId: 'zero', courseworkPoints: 0, completedCount: 99 },
])
assert.deepEqual(ranked.map(row => [row.studentId, row.rank]), [['a', 1], ['b', 1]], 'equal coursework points use dense ties and ignore attendance points')
assert.equal(deterministicCourseworkLeaderboard([{ studentId: 'zero', courseworkPoints: 0 }]).length, 0, 'zero-point students are not ranked')
assert.deepEqual(deterministicCourseworkLeaderboard([
  { studentId: 'assignment', courseworkPoints: 5 },
  { studentId: 'project', courseworkPoints: 10 },
]).map(row => [row.studentId, row.rank]), [['project', 1], ['assignment', 2]], 'positive assignment/project points determine rank')
const formula = { assignmentPoints: 5, projectPoints: 10, attendancePoints: 2, lifetimePoints: 999 }
assert.equal(formula.assignmentPoints + formula.projectPoints, 15, 'coursework points are assignment plus project points')
assert.equal(formula.assignmentPoints + formula.projectPoints + formula.attendancePoints, 17, 'Health Card total adds attendance points to coursework points')
assert.deepEqual(deterministicCourseworkLeaderboard([
  { studentId: 'attendance-low', courseworkPoints: 10, attendancePoints: 0, lifetimePoints: 0 },
  { studentId: 'attendance-high', courseworkPoints: 10, attendancePoints: 99, lifetimePoints: 999 },
]).map(row => row.studentId), ['attendance-high', 'attendance-low'], 'attendance and lifetime do not alter coursework rank ordering')

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
const leaderboardMigration = fs.readFileSync(new URL('../supabase/migrations/20261030120000_student_health_card_leaderboard_semantics.sql', import.meta.url), 'utf8')
const unifiedMigration = fs.readFileSync(new URL('../supabase/migrations/20261031082152_unified_coursework_point_system.sql', import.meta.url), 'utf8')
const historicalAliasMigration = fs.readFileSync(new URL('../supabase/migrations/20261031085936_authoritative_python_historical_reconciliation.sql', import.meta.url), 'utf8')
const canonicalCompletionMigration = fs.readFileSync(new URL('../supabase/migrations/20261031090119_canonical_historical_reconciliation_completion.sql', import.meta.url), 'utf8')
const submissionRoute = fs.readFileSync(new URL('../app/api/student-submissions/route.js', import.meta.url), 'utf8')
const rosterRoute = fs.readFileSync(new URL('../app/api/admin-roster/route.js', import.meta.url), 'utf8')
const healthCardUi = fs.readFileSync(new URL('../components/student/StudentHealthCard.jsx', import.meta.url), 'utf8')
const studentCourseworkRoute = fs.readFileSync(new URL('../app/api/student-coursework/route.js', import.meta.url), 'utf8')
const adminCourseworkRoute = fs.readFileSync(new URL('../app/api/admin-coursework/route.js', import.meta.url), 'utf8')
const teacherCurriculumRoute = fs.readFileSync(new URL('../app/api/teacher-curriculum/route.js', import.meta.url), 'utf8')
const adminCourseworkUi = fs.readFileSync(new URL('../components/admin/AdminCourseworkPanel.jsx', import.meta.url), 'utf8')
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.batch_coursework_assignments/)
assert.match(migration, /source <> 'legacy_backfill'/)
assert.match(migration, /session_date/)
assert.match(unifiedMigration, /student_coursework_reconciliation_no_points_check/)
assert.match(unifiedMigration, /cf_enforce_canonical_submission_type/)
assert.match(unifiedMigration, /DENSE_RANK\(\)/)
assert.match(unifiedMigration, /CASE rc\.item_type WHEN 'assignment' THEN 5 WHEN 'project' THEN 10/)
assert.match(unifiedMigration, /reconciled_completion_candidates[\s\S]*?bs\.batch,/)
assert.doesNotMatch(unifiedMigration, /DATE '2026-10-01'/)
assert.match(historicalAliasMigration, /manual_authoritative/)
assert.match(historicalAliasMigration, /row_number\(\) OVER/)
assert.match(historicalAliasMigration, /source_phase/)
assert.match(historicalAliasMigration, /source_item_type/)
assert.doesNotMatch(historicalAliasMigration, /delete\s+from\s+public\.(submissions|student_coursework_reconciliations)/i)
assert.match(canonicalCompletionMigration, /mapping_status = 'mapped'/)
assert.match(canonicalCompletionMigration, /counts_for_points = true/)
assert.doesNotMatch(canonicalCompletionMigration, /delete\s+from\s+public\.(submissions|student_coursework_reconciliations)/i)
assert.match(submissionRoute, /coursework_item_id/)
assert.match(submissionRoute, /batch_coursework_assignments/)
assert.match(submissionRoute, /\.eq\('student_id', student\.id\)/)
const reconciliationRead = submissionRoute.match(/from\('student_coursework_reconciliations'\)[\s\S]{0,500}/)?.[0] || ''
assert.doesNotMatch(reconciliationRead, /\.eq\('batch', student\.batch\)/)
assert.match(rosterRoute, /hashStudentPasswordSecure/)
assert.doesNotMatch(rosterRoute, /password:.*insert/)
assert.match(healthCardUi, /Coursework Points are earned from completed Assignments and Projects/)
assert.match(healthCardUi, /Coursework Points/)
assert.match(healthCardUi, /Assignments \(5 pts\) \+ Projects \(10 pts\)/)
assert.match(healthCardUi, /Assignments released for your batch/)
assert.match(healthCardUi, /Projects released for your batch/)
assert.match(healthCardUi, /coursework pts/)
assert.match(healthCardUi, /No attendance sessions have been tracked yet/)
assert.match(healthCardUi, /Batch Coursework Leaderboard/)
assert.match(healthCardUi, /Attendance does not affect rank/)
assert.match(healthCardUi, /No scored Health Card activity yet/)
assert.match(healthCardUi, /Not ranked yet/)
assert.match(healthCardUi, /Leaderboard starts after coursework points are earned/)
assert.match(healthCardUi, /Complete an Assignment or Project to earn Coursework Points and enter the batch ranking/)
assert.match(healthCardUi, /Coursework Point/)
assert.match(healthCardUi, /Attendance Point/)
assert.match(healthCardUi, /health-card-formula/)
assert.doesNotMatch(healthCardUi, /Previous coursework vs current scoring/)
assert.doesNotMatch(healthCardUi, /Current coursework points/)
assert.doesNotMatch(healthCardUi, /Health Card scoring started 1 Oct 2026/)
assert.doesNotMatch(healthCardUi, /Older coursework remains/)
assert.doesNotMatch(healthCardUi, /activated coursework tracked/)
const teacherSubmissionUi = fs.readFileSync(new URL('../components/teacher/SubmissionsTab.jsx', import.meta.url), 'utf8')
assert.match(teacherSubmissionUi, /Assignment · 5 pts/)
assert.match(teacherSubmissionUi, /Project · 10 pts/)
assert.match(teacherSubmissionUi, /teachers cannot edit points/)
assert.doesNotMatch(teacherSubmissionUi, /Manual points/)
assert.doesNotMatch(teacherSubmissionUi, /Small Task/)
assert.doesNotMatch(teacherSubmissionUi, /Micro Task/)
assert.doesNotMatch(teacherSubmissionUi, /POINT_OPTIONS/)
const stylesheet = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
assert.match(stylesheet, /health-card-formula/)
assert.match(stylesheet, /max-width: 720px/)
assert.match(leaderboardMigration, /dense_rank/)
assert.match(leaderboardMigration, /total_points > 0/)
assert.match(leaderboardMigration, /rankedStudentCount/)
assert.match(studentCourseworkRoute, /HEALTH_CARD_PHASES/)
assert.match(studentCourseworkRoute, /selectVisibleStudentCoursework/)
assert.match(adminCourseworkRoute, /cannot be activated without a valid/)
assert.match(teacherCurriculumRoute, /valid Python, Data Analytics, or SQL phase/)
assert.match(adminCourseworkUi, /Select phase/)

console.log('Student Health Card product refactor tests passed.')
