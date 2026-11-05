import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

process.env.NODE_ENV = 'test'
process.env.STUDENT_SESSION_SECRET = 'student-roster-test-secret'

const roster = await import('../lib/roster-import.js')
const passwordPattern = await import('../lib/student-password-pattern.js')
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
for (const header of ['Phone', 'Phone Number', 'Phone No', 'Phone No.', 'Mobile', 'Mobile Number', 'Mobile No', 'Mobile No.', 'Contact', 'Contact Number', 'Contact No', 'Contact No.', 'WhatsApp Number', 'Whatsapp Number', 'WhatsApp No', 'Whatsapp No']) {
  const sheet = XLSX.utils.aoa_to_sheet([['Student Name', header], ['Alias Header Student', '9806223653']])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Roster')
  const parsed = roster.parseRosterBufferWithMetadata(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), `${header}.xlsx`)
  assert.equal(parsed.rows[0].phone, '9806223653', `phone alias parsed: ${header}`)
  assert.equal(parsed.phoneColumnDetected, true, `phone column detected: ${header}`)
}
const noPhoneSheet = XLSX.utils.aoa_to_sheet([['Student Name', 'Email'], ['No Phone Column', 'no-phone@example.invalid']])
const noPhoneBook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(noPhoneBook, noPhoneSheet, 'Roster')
const noPhoneParsed = roster.parseRosterBufferWithMetadata(XLSX.write(noPhoneBook, { type: 'buffer', bookType: 'xlsx' }), 'no-phone.xlsx')
assert.equal(noPhoneParsed.rows[0].phone, '')
assert.equal(noPhoneParsed.phoneColumnDetected, false)

const template = XLSX.read(roster.createRosterTemplateBuffer(), { type: 'buffer' })
const templateRows = XLSX.utils.sheet_to_json(template.Sheets[template.SheetNames[0]], { header: 1 })
assert.deepEqual(templateRows[0], roster.ROSTER_HEADERS)
assert.ok(templateRows[0].includes('Teams Display Name'))

const existing = [
  { id: 'same', name: 'Existing Same', batch: 'Batch A', email: 'same@example.invalid', phone: '7000000001', external_student_id: 'SAME-1', login_id: 'existing-same-01', status: 'active' },
  { id: 'other', name: 'Existing Other', batch: 'Batch B', email: 'other@example.invalid', phone: '7000000002', external_student_id: 'OTHER-1', login_id: 'existing-other-01', status: 'active' },
  { id: 'same-name-other-batch', name: 'Shared Name', batch: 'Batch B', email: null, phone: '7000000003', external_student_id: null, login_id: 'shared-name-01', status: 'active' },
]
const classified = roster.classifyRosterRows([
  { rowNumber: 2, name: 'New Student', email: 'new@example.invalid', phone: '+91 (900) 000-0001', externalStudentId: 'NEW-1', teamsDisplayName: 'New S' },
  { rowNumber: 3, name: 'Existing Same', email: 'same@example.invalid', phone: '', externalStudentId: '', teamsDisplayName: '' },
  { rowNumber: 4, name: 'Existing Other', email: '', phone: '', externalStudentId: 'OTHER-1', teamsDisplayName: '' },
  { rowNumber: 5, name: 'New Student', email: 'new@example.invalid', phone: '+91 (900) 000-0001', externalStudentId: 'NEW-1', teamsDisplayName: '' },
  { rowNumber: 6, name: '', email: 'missing@example.invalid', phone: '', externalStudentId: '', teamsDisplayName: '' },
  { rowNumber: 7, name: 'Shared Name', email: '', phone: '7000000004', externalStudentId: '', teamsDisplayName: '' },
  { rowNumber: 8, name: 'Existing Student', email: '', phone: '9000000001', externalStudentId: 'SAME-1', teamsDisplayName: '' },
], existing, { batch: 'Batch A', aliases: [] })
assert.equal(classified[0].status, 'new')
assert.equal(classified[0].passwordReady, true)
assert.equal(classified[0].passwordPattern, 'New@001#')
assert.equal(classified[1].status, 'existing')
assert.equal(classified[1].passwordReady, true, 'existing students with a stored phone can be reset only through explicit apply-pattern')
assert.equal(classified[2].status, 'existing_different_batch')
assert.equal(classified[3].status, 'possible_duplicate')
assert.equal(classified[4].status, 'invalid')
assert.equal(classified[5].status, 'new', 'names are not treated as globally unique')
assert.equal(classified[6].status, 'existing')
assert.equal(classified[6].phoneUpdate, true)
assert.equal(classified[6].passwordReady, true)
assert.equal(classified[6].passwordPattern, 'Existing@001#')
assert.equal(classified[3].passwordCollisionCount, 0)
const collisionRows = roster.classifyRosterRows([
  { rowNumber: 2, name: 'Alice One', email: 'alice@example.invalid', phone: '9000000123', externalStudentId: 'COLLISION-1', teamsDisplayName: '' },
  { rowNumber: 3, name: 'Bob Two', email: 'bob@example.invalid', phone: '9000000123', externalStudentId: 'COLLISION-2', teamsDisplayName: '' },
], [], { batch: 'Batch A', aliases: [] })
assert.equal(collisionRows[0].passwordPattern, 'Alice@123#')
assert.equal(collisionRows[1].passwordPattern, 'Bob@123#')
assert.equal(collisionRows[0].passwordCollisionCount, 1, 'different first names keep pattern passwords distinct')
const sameFirstCollisionRows = roster.classifyRosterRows([
  { rowNumber: 2, name: 'Alice One', email: 'alice1@example.invalid', phone: '9000000123', externalStudentId: 'COLLISION-3', teamsDisplayName: '' },
  { rowNumber: 3, name: 'Alice Two', email: 'alice2@example.invalid', phone: '9000000123', externalStudentId: 'COLLISION-4', teamsDisplayName: '' },
], [], { batch: 'Batch A', aliases: [] })
assert.equal(sameFirstCollisionRows[0].passwordCollisionCount, 2, 'duplicate generated patterns are warned but not blocked')
assert.equal(sameFirstCollisionRows[1].passwordCollisionCount, 2)

assert.equal(passwordPattern.normalizePhoneDigits('+91 (980) 622-3653'), '919806223653')
assert.equal(passwordPattern.buildStudentPatternPassword({ name: 'aman gaur', phone: '+91 (980) 622-3653' }), 'Aman@653#')
assert.equal(passwordPattern.buildStudentPatternPassword({ name: "  rIYA o'neil  ", phone: '9876543210' }), "Riya@210#")
assert.equal(passwordPattern.getStudentPatternPasswordInfo({ name: 'Phone Missing', phone: '' }).valid, false)
assert.equal(passwordPattern.getStudentPatternPasswordInfo({ name: 'Phone Short', phone: '12' }).reason, passwordPattern.STUDENT_PATTERN_PHONE_ERROR)
assert.equal(passwordPattern.getStudentPatternPasswordInfo({ name: '', phone: '9806223653' }).reason, 'Student first name is required.')
assert.throws(() => passwordPattern.buildStudentPatternPassword({ name: 'Phone Missing', phone: '' }), /Phone number is required/)

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

const aliasConflict = roster.classifyRosterRows([{ rowNumber: 2, name: 'Alias Candidate', email: '', phone: '9000000005', externalStudentId: '', teamsDisplayName: 'Existing Teams Name' }], existing, {
  batch: 'Batch A',
  aliases: [{ id: 'alias-1', student_id: 'same', batch: 'Batch A', alias: 'Existing Teams Name', normalized_alias: 'existing teams name', active: true }],
})[0]
assert.equal(aliasConflict.status, 'possible_duplicate')
const existingWithoutPhone = roster.classifyRosterRows([{ rowNumber: 2, name: 'No Phone Existing', email: '', phone: '', externalStudentId: 'NO-PHONE-1', teamsDisplayName: '' }], [{ id: 'no-phone', name: 'No Phone Existing', batch: 'Batch A', phone: '', external_student_id: 'NO-PHONE-1' }], { batch: 'Batch A', aliases: [] })[0]
assert.equal(existingWithoutPhone.status, 'existing')
assert.equal(existingWithoutPhone.passwordReady, false)
assert.equal(existingWithoutPhone.phoneStatus, 'missing')
assert.match(existingWithoutPhone.reason, /Add a phone number to apply/)
const mixedExisting = roster.classifyRosterRows([
  { rowNumber: 2, name: 'Ready Existing', email: '', phone: '9806223653', externalStudentId: 'READY-1', teamsDisplayName: '' },
  { rowNumber: 3, name: 'Missing Existing', email: '', phone: '', externalStudentId: 'MISSING-1', teamsDisplayName: '' },
], [
  { id: 'ready', name: 'Ready Existing', batch: 'Batch A', phone: '', external_student_id: 'READY-1' },
  { id: 'missing', name: 'Missing Existing', batch: 'Batch A', phone: '', external_student_id: 'MISSING-1' },
], { batch: 'Batch A', aliases: [] })
assert.equal(mixedExisting.filter(row => row.passwordReady).length, 1)
assert.equal(mixedExisting.filter(row => row.status === 'existing' && !row.passwordReady).length, 1)

const used = new Set(['aman-test-01', 'aman-test-02'])
assert.equal(roster.generateLoginId('Aman Test', used), 'aman-test-03')
const patternPassword = passwordPattern.buildStudentPatternPassword({ name: 'Aman Gaur', phone: '9806223653' })
const secureHash = await studentAuth.hashStudentPasswordSecure(patternPassword)
assert.notEqual(secureHash, patternPassword)
assert.ok(secureHash.startsWith('$2'))
assert.equal((await studentAuth.verifyStudentPassword(patternPassword, secureHash)).ok, true)

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
const toast = fs.readFileSync(new URL('../components/ui/Toast.jsx', import.meta.url), 'utf8')
const page = fs.readFileSync(new URL('../app/page.jsx', import.meta.url), 'utf8')
const overviewSource = panel.slice(panel.indexOf('const loadOverview'), panel.indexOf('useEffect(() => { loadOverview'))
assert.match(route, /getAdminFromRequest\(request\)/)
assert.match(route, /if \(!admin\) return jsonNoStore\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/, 'Admin roster GET returns JSON auth errors')
assert.doesNotMatch(route, /\.select\('id,batch,[^']*row_results/, 'compact overview does not load row_results')
assert.match(route, /loadAllExisting\(supabase\)/, 'strong identity checks load students globally')
assert.match(route, /student_batch_memberships/, 'new account membership is verified')
assert.match(route, /source: 'roster_import'/, 'Teams names use the trusted alias architecture')
assert.match(route, /reconcileWaitingAttendanceSafely/, 'registered identities are reconciled with attendance')
assert.match(route, /parseRosterBufferWithMetadata/, 'preview exposes phone-column metadata')
assert.match(route, /applyPattern && row\.passwordReady/, 'conversion only updates ready rows')
assert.match(route, /row_results: rowResults/, 'audit outcomes are recorded')
assert.doesNotMatch(route, /row_results:\s*credentials/, 'plaintext credentials never enter import audit history')
assert.match(route, /existing_different_batch/)
assert.match(route, /export async function PATCH/, 'different-batch transfer requires an explicit Admin action')
assert.match(credentialRoute, /must_change_password: false/)
assert.match(credentialRoute, /student_pattern_password_reset/)
assert.match(credentialRoute, /Add the student's phone number before resetting their password/)
assert.doesNotMatch(credentialRoute, /currentPassword|current_password/)
assert.match(passwordRoute, /must_change_password: false/)
assert.match(passwordRoute, /hashStudentPasswordSecure\(password\)/)
assert.match(sessionRoute, /login_id,must_change_password/)
assert.match(page, /student\.must_change_password/)
assert.match(panel, /Preview Students/)
assert.match(panel, /Download Student Credentials/)
assert.match(panel, /Passwords are shown once/)
assert.match(panel, /Apply Password Pattern/)
assert.match(panel, /Passwords follow FirstName@last3#/)
assert.match(panel, /PASSWORD READY/)
assert.match(panel, /Phone column not detected/)
assert.match(panel, /Roster coverage/)
assert.match(panel, /patternReadyCount > 0/)
assert.doesNotMatch(panel, /Temporary Password|temporaryPassword|Temporary passwords/)
assert.match(panel, /Copy All Credentials/)
assert.match(panel, /Search student or Login ID/)
assert.match(panel, /Teams Display Name/)
assert.match(toast, /const success = useCallback\(message => show\(message, "success"\), \[show\]\)/, 'success toast callback is stable')
assert.match(toast, /const error = useCallback\(message => show\(message, "error"\), \[show\]\)/, 'error toast callback is stable')
assert.match(panel, /new AbortController\(\)/, 'overview request can be cancelled')
assert.match(panel, /OVERVIEW_TIMEOUT_MS = 12000/, 'overview request has a bounded timeout')
assert.match(panel, /overviewRequestRef\.current\.controller\?\.abort\(\)/, 'previous overview request is cancelled')
assert.match(panel, /overviewRequestRef\.current\.sequence === sequence/, 'stale overview responses are ignored')
assert.match(panel, /return fetchOverview\(1\)/, 'overview allows one retry attempt')
assert.match(panel, /res\.status === 401 \? "auth"/, 'HTTP 401 is classified without retry')
assert.match(panel, /res\.status >= 500 \? "server"/, 'HTTP 500 is classified without retry')
assert.match(panel, /navigator\.onLine === false/, 'offline state skips retry')
assert.match(panel, /Couldn’t load batch students\./, 'overview has an inline error state')
assert.match(panel, /onClick=\{\(\) => loadOverview\(batch\)\}/, 'overview has manual retry and refresh actions')
assert.doesNotMatch(panel, /setInterval\(/, 'overview does not introduce polling')
assert.doesNotMatch(overviewSource, /showError\(error\.message\)/, 'raw overview errors are not shown to Admin')

console.log('Student roster onboarding tests passed')
