import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { buildStudentLoginIdBase, generateStudentLoginId } from '../lib/student-login-id.js'
import { buildStudentPatternPassword } from '../lib/student-password-pattern.js'
import { classifyRosterRows, parseRosterBufferWithMetadata } from '../lib/roster-import.js'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const sheet = XLSX.utils.aoa_to_sheet([
  ['Student Name', 'Email', 'Phone', 'External Student ID', 'Teams Display Name', 'Join Date'],
  ['Aman Test', 'aman@example.invalid', '9806223653', 'EXT-1', 'Aman T', '2026-11-02'],
])
const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, sheet, 'Roster')
const parsed = parseRosterBufferWithMetadata(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'students.xlsx')
assert.equal(parsed.rows.length, 1)
assert.equal(parsed.rows[0].phone, '9806223653')
assert.equal(parsed.rows[0].joinDate, '2026-11-02')

const newRow = classifyRosterRows(parsed.rows, [], { batch: 'Batch A', aliases: [] })[0]
assert.equal(newRow.status, 'new')
assert.equal(newRow.passwordReady, true)
assert.equal(buildStudentLoginIdBase({ name: newRow.name, phone: newRow.phone }), 'aman53')
assert.equal(generateStudentLoginId({ name: newRow.name, phone: newRow.phone }, new Set(['aman53'])), 'aman53-2')
assert.equal(buildStudentPatternPassword({ name: newRow.name, phone: newRow.phone }), 'Aman@653#')

const existing = [{ id: 'student-1', name: 'Aman Test', batch: 'Batch A', email: 'aman@example.invalid', phone: '9806223653', external_student_id: 'EXT-1', login_id: 'aman53', status: 'active' }]
const repeat = classifyRosterRows(parsed.rows, existing, { batch: 'Batch A', aliases: [] })[0]
assert.equal(repeat.status, 'existing', 're-uploading the same roster is idempotent')

const adminRoute = read('app/api/admin-student-onboarding/route.js')
const teacherRoute = read('app/api/teacher-student-onboarding/route.js')
const trainerRoster = read('app/api/teacher-roster/route.js')
const shared = read('lib/student-onboarding.js')
const panel = read('components/admin/BatchSetupPanel.jsx')
const teacherStudents = read('components/teacher/StudentsTab.jsx')
assert.match(shared, /hashStudentPasswordSecure/)
assert.match(shared, /ensureMembership/)
assert.match(shared, /rejectDuplicate = true/)
assert.match(adminRoute, /getAdminFromRequest\(request\)/)
assert.match(teacherRoute, /getTeacherScope/)
assert.match(teacherRoute, /scope\.batchNames\.includes\(input\.batch\)/)
assert.match(trainerRoster, /parseRosterBufferWithMetadata/)
assert.match(trainerRoster, /classifyRosterRows/)
assert.match(trainerRoster, /action === 'preview'/)
assert.match(trainerRoster, /uploaded_by_role: 'teacher'/)
assert.match(trainerRoster, /!\['preview', 'commit-new'\]\.includes\(upload\.action\)/)
assert.match(panel, /teacher-roster/)
assert.match(panel, /canManageExisting = role === "admin"/)
assert.match(panel, /canManageExisting && preview && \(patternReadyCount > 0/) 
assert.match(teacherStudents, /StudentOnboardingForm/)
assert.match(teacherStudents, /BatchSetupPanel/)

console.log('Student onboarding release tests passed.')

