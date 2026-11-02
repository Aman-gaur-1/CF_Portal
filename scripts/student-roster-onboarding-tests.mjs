import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

process.env.NODE_ENV = 'test'
process.env.STUDENT_SESSION_SECRET = 'student-roster-test-secret'

const roster = await import('../lib/roster-import.js')
const studentAuth = await import('../lib/student-auth.js')
const attendance = await import('../lib/attendance-matching.js')

function workbookBuffer(bookType = 'xlsx') {
  const sheet = XLSX.utils.aoa_to_sheet([
    [' student name ', 'EMAIL', 'Phone Number', 'External ID', 'Teams Name'],
    ['Aman Test', 'aman@example.invalid', '9000000000', 'EXT-1', 'Aman T'],
  ])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Roster')
  return XLSX.write(book, { type: 'buffer', bookType })
}

const csvRows = roster.parseRosterBuffer(Buffer.from('Name,Email,Attendance Name\nCSV Student,csv@example.invalid,CSV S\n'), 'roster.csv')
assert.equal(csvRows[0].name, 'CSV Student')
assert.equal(csvRows[0].teamsDisplayName, 'CSV S')
assert.equal(roster.parseRosterBuffer(workbookBuffer('xls'), 'roster.xls')[0].externalStudentId, 'EXT-1')
assert.equal(roster.parseRosterBuffer(workbookBuffer('xlsx'), 'roster.xlsx')[0].teamsDisplayName, 'Aman T')

const template = XLSX.read(roster.createRosterTemplateBuffer(), { type: 'buffer' })
const templateRows = XLSX.utils.sheet_to_json(template.Sheets[template.SheetNames[0]], { header: 1 })
assert.deepEqual(templateRows[0], roster.ROSTER_HEADERS)
assert.ok(templateRows[0].includes('Teams Display Name'))

const existing = [
  { id: 'same', name: 'Existing Same', batch: 'Batch A', email: 'same@example.invalid', external_student_id: 'SAME-1', login_id: 'existing-same-01', status: 'active' },
  { id: 'other', name: 'Existing Other', batch: 'Batch B', email: 'other@example.invalid', external_student_id: 'OTHER-1', login_id: 'existing-other-01', status: 'active' },
  { id: 'same-name-other-batch', name: 'Shared Name', batch: 'Batch B', email: null, external_student_id: null, login_id: 'shared-name-01', status: 'active' },
]
const classified = roster.classifyRosterRows([
  { rowNumber: 2, name: 'New Student', email: 'new@example.invalid', phone: '', externalStudentId: 'NEW-1', teamsDisplayName: 'New S' },
  { rowNumber: 3, name: 'Existing Same', email: 'same@example.invalid', phone: '', externalStudentId: '', teamsDisplayName: '' },
  { rowNumber: 4, name: 'Existing Other', email: '', phone: '', externalStudentId: 'OTHER-1', teamsDisplayName: '' },
  { rowNumber: 5, name: 'New Student', email: 'new@example.invalid', phone: '', externalStudentId: 'NEW-1', teamsDisplayName: '' },
  { rowNumber: 6, name: '', email: 'missing@example.invalid', phone: '', externalStudentId: '', teamsDisplayName: '' },
  { rowNumber: 7, name: 'Shared Name', email: '', phone: '', externalStudentId: '', teamsDisplayName: '' },
], existing, { batch: 'Batch A', aliases: [] })
assert.equal(classified[0].status, 'new')
assert.equal(classified[1].status, 'existing')
assert.equal(classified[2].status, 'existing_different_batch')
assert.equal(classified[3].status, 'possible_duplicate')
assert.equal(classified[4].status, 'invalid')
assert.equal(classified[5].status, 'new', 'names are not treated as globally unique')

const strongEmailDuplicate = roster.classifyRosterRows([{ rowNumber: 2, name: 'Different Name', email: 'other@example.invalid', phone: '', externalStudentId: '', teamsDisplayName: '' }], existing, { batch: 'Batch A' })[0]
assert.equal(strongEmailDuplicate.status, 'existing_different_batch')
const duplicateStrongRows = roster.classifyRosterRows([
  { rowNumber: 2, name: 'First Import Name', email: 'same-file@example.invalid', phone: '', externalStudentId: 'FILE-1', teamsDisplayName: '' },
  { rowNumber: 3, name: 'Second Import Name', email: 'same-file@example.invalid', phone: '', externalStudentId: 'FILE-1', teamsDisplayName: '' },
], [], { batch: 'Batch A' })
assert.equal(duplicateStrongRows[1].status, 'possible_duplicate')
assert.match(duplicateStrongRows[1].reason, /row 2/)
const missingName = roster.classifyRosterRows([{ rowNumber: 2, name: '', email: '', phone: '', externalStudentId: '', teamsDisplayName: '' }], [], { batch: 'Batch A' })[0]
assert.equal(missingName.reason, 'Student Name is required.')

const aliasConflict = roster.classifyRosterRows([{ rowNumber: 2, name: 'Alias Candidate', email: '', phone: '', externalStudentId: '', teamsDisplayName: 'Existing Teams Name' }], existing, {
  batch: 'Batch A',
  aliases: [{ id: 'alias-1', student_id: 'same', batch: 'Batch A', alias: 'Existing Teams Name', normalized_alias: 'existing teams name', active: true }],
})[0]
assert.equal(aliasConflict.status, 'possible_duplicate')

const used = new Set(['aman-test-01', 'aman-test-02'])
assert.equal(roster.generateLoginId('Aman Test', used), 'aman-test-03')
const firstTemporary = roster.generateTemporaryPassword()
const secondTemporary = roster.generateTemporaryPassword()
assert.notEqual(firstTemporary, secondTemporary)
assert.match(firstTemporary, /^CF-[A-Za-z0-9_-]{12}$/)
const secureHash = await studentAuth.hashStudentPasswordSecure(firstTemporary)
assert.notEqual(secureHash, firstTemporary)
assert.ok(secureHash.startsWith('$2'))
assert.equal((await studentAuth.verifyStudentPassword(firstTemporary, secureHash)).ok, true)

const flagged = { id: 'student-1', name: 'Temporary Student', batch: 'Batch A', must_change_password: true }
const flaggedToken = studentAuth.createStudentToken(flagged)
const flaggedRequest = { headers: new Headers({ Authorization: `Bearer ${flaggedToken}` }) }
assert.equal(studentAuth.getStudentFromRequest(flaggedRequest), null, 'temporary-password sessions cannot access normal student APIs')
assert.equal(studentAuth.getStudentFromRequest(flaggedRequest, { allowPasswordChangeRequired: true }).must_change_password, true)

const students = [{ id: 'student-new', name: 'Aman Test', batch: 'Batch A' }]
const aliases = [{ id: 'alias-new', student_id: 'student-new', batch: 'Batch A', alias: 'Aman T', normalized_alias: 'aman t', active: true }]
assert.equal(attendance.matchParticipantName({ participantName: 'Aman Test', students, aliases }).type, 'exact')
assert.equal(attendance.matchParticipantName({ participantName: 'Aman T', students, aliases }).type, 'alias')
assert.equal(attendance.matchParticipantName({ participantName: 'Unknown Test Person', students, aliases }).type, 'unmatched')

const route = fs.readFileSync(new URL('../app/api/admin-roster/route.js', import.meta.url), 'utf8')
const credentialRoute = fs.readFileSync(new URL('../app/api/admin-student-credentials/route.js', import.meta.url), 'utf8')
const passwordRoute = fs.readFileSync(new URL('../app/api/student-password/route.js', import.meta.url), 'utf8')
const sessionRoute = fs.readFileSync(new URL('../app/api/student-session/route.js', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../components/admin/BatchSetupPanel.jsx', import.meta.url), 'utf8')
const page = fs.readFileSync(new URL('../app/page.jsx', import.meta.url), 'utf8')
assert.match(route, /getAdminFromRequest\(request\)/)
assert.match(route, /loadAllExisting\(supabase\)/, 'strong identity checks load students globally')
assert.match(route, /student_batch_memberships/, 'new account membership is verified')
assert.match(route, /source: 'roster_import'/, 'Teams names use the trusted alias architecture')
assert.match(route, /reconcileWaitingAttendanceSafely/, 'registered identities are reconciled with attendance')
assert.match(route, /row_results: rowResults/, 'audit outcomes are recorded')
assert.doesNotMatch(route, /row_results:\s*credentials/, 'plaintext credentials never enter import audit history')
assert.match(route, /existing_different_batch/)
assert.match(route, /export async function PATCH/, 'different-batch transfer requires an explicit Admin action')
assert.match(credentialRoute, /must_change_password: true/)
assert.match(credentialRoute, /student_temporary_password_reset/)
assert.doesNotMatch(credentialRoute, /currentPassword|current_password/)
assert.match(passwordRoute, /must_change_password: false/)
assert.match(passwordRoute, /hashStudentPasswordSecure\(password\)/)
assert.match(sessionRoute, /login_id,must_change_password/)
assert.match(page, /student\.must_change_password/)
assert.match(panel, /Preview Students/)
assert.match(panel, /Download Student Credentials/)
assert.match(panel, /Temporary passwords are shown once/)
assert.match(panel, /Copy All Credentials/)
assert.match(panel, /Search student or Login ID/)
assert.match(panel, /Teams Display Name/)

console.log('Student roster onboarding tests passed')
