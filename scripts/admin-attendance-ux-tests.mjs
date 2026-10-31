import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { buildUploadPreview, parseTeamsReport } from '../lib/attendance-upload.js'

function teamsWorkbookBuffer(bookType) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet([
    { Name: 'Exact Student' },
    { Name: 'A Student (External)' },
    { Name: 'Unknown Participant' },
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance')
  return XLSX.write(workbook, { type: 'buffer', bookType })
}

function teamsMetadataWorkbookBuffer(bookType) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Meeting title', 'Python | 05 Oct'],
    ['Attended participants', '3'],
    ['Start time', '8:15 PM'],
    ['End time', '9:15 PM'],
    ['Meeting duration', '60m'],
    ['Average attendance time', '52m'],
    ['2. Participants', ''],
    ['Name', 'Email', 'Role'],
    ['Student One', 'one@example.invalid', 'Attendee'],
    ['Student Two', 'two@example.invalid', 'Attendee'],
    ['Student Three', 'three@example.invalid', 'Attendee'],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance')
  return XLSX.write(workbook, { type: 'buffer', bookType })
}

for (const [extension, buffer] of [
  ['xlsx', teamsWorkbookBuffer('xlsx')],
  ['xls', teamsWorkbookBuffer('xls')],
  ['csv', Buffer.from('Name\nExact Student\nA Student (External)\nUnknown Participant\n', 'utf8')],
]) {
  const parsed = parseTeamsReport(buffer, `teams-smoke.${extension}`)
  assert.deepEqual(parsed.names, ['Exact Student', 'A Student (External)', 'Unknown Participant'], `${extension} Teams parsing`)
}

for (const [extension, buffer] of [
  ['xlsx', teamsMetadataWorkbookBuffer('xlsx')],
  ['xls', teamsMetadataWorkbookBuffer('xls')],
  ['csv', Buffer.from([
    'Meeting title,Python | 05 Oct',
    'Attended participants,3',
    'Start time,8:15 PM',
    'End time,9:15 PM',
    'Meeting duration,60m',
    'Average attendance time,52m',
    '2. Participants,',
    'Name,Email,Role',
    'Student One,one@example.invalid,Attendee',
    'Student Two,two@example.invalid,Attendee',
    'Student Three,three@example.invalid,Attendee',
  ].join('\n'), 'utf8')],
]) {
  const parsed = parseTeamsReport(buffer, `teams-metadata.${extension}`)
  assert.deepEqual(parsed.names, ['Student One', 'Student Two', 'Student Three'], `${extension} metadata-section parsing`)
  assert.equal(parsed.meta.participantSection, true, `${extension} detects the participant section`)
  for (const metadataName of ['Meeting title', 'Attended participants', 'Start time', 'End time', 'Meeting duration', 'Average attendance time', '2. Participants', 'Name']) {
    assert.equal(parsed.names.includes(metadataName), false, `${extension} excludes ${metadataName} from participant names`)
  }
}

const unsafeReport = Buffer.from('Meeting title,Python | 05 Oct\nAttended participants,3\nStart time,8:15 PM\nEnd time,9:15 PM\nMeeting duration,60m\nAverage attendance time,52m\n', 'utf8')
const unsafeParsed = parseTeamsReport(unsafeReport, 'teams-unsafe.csv')
assert.deepEqual(unsafeParsed.names, [], 'unsafe Teams structure is rejected without guessing people')
assert.equal(unsafeParsed.meta.error, "We couldn't safely detect the participant list in this file.")

const students = [
  { id: 'exact-id', name: 'Exact Student', batch: 'Synthetic Batch', status: 'active' },
  { id: 'alias-id', name: 'Alias Student', batch: 'Synthetic Batch', status: 'active' },
]
const aliases = [{ id: 'alias-row', student_id: 'alias-id', batch: 'Synthetic Batch', alias: 'A Student', normalized_alias: 'a student', active: true }]
const freshPreview = buildUploadPreview({
  fileNames: ['Exact Student', 'A Student (External)', 'Unknown Participant'],
  students,
  aliases,
  existingAttendance: [],
  date: '2026-10-08',
  batch: 'Synthetic Batch',
})
assert.equal(freshPreview.matched.length, 2, 'exact and alias matches are ready')
assert.equal(freshPreview.matched.find(row => row.studentId === 'alias-id')?.confidence, 'alias')
assert.equal(freshPreview.unmatched.length, 1, 'unmatched participant is preserved for Needs Attention')
assert.equal(freshPreview.summary.willCreate, 2)

const duplicatePreview = buildUploadPreview({
  fileNames: ['Exact Student', 'A Student (External)'],
  students,
  aliases,
  existingAttendance: [{ id: 'attendance-1', student_id: 'exact-id', status: 'approved' }],
  date: '2026-10-08',
  batch: 'Synthetic Batch',
})
assert.equal(duplicatePreview.alreadyMarked.length, 1, 'already marked attendance is skipped')
assert.equal(duplicatePreview.matched.length, 1)

const route = fs.readFileSync(new URL('../app/api/attendance-upload/route.js', import.meta.url), 'utf8')
const adminRoute = fs.readFileSync(new URL('../app/api/admin-attendance/route.js', import.meta.url), 'utf8')
const adminPanel = fs.readFileSync(new URL('../components/admin/AdminAttendancePanel.jsx', import.meta.url), 'utf8')
const uploadUi = fs.readFileSync(new URL('../components/ui/AttendanceUpload.jsx', import.meta.url), 'utf8')
const historyUi = fs.readFileSync(new URL('../components/ui/AttendanceImportHistory.jsx', import.meta.url), 'utf8')
const healthUi = fs.readFileSync(new URL('../components/student/StudentHealthCard.jsx', import.meta.url), 'utf8')

assert.match(route, /getAdminFromRequest/)
assert.match(route, /date < HEALTH_CARD_EPOCH/)
assert.match(route, /if \(action === 'preview'\) return handlePreview/)
assert.match(route, /This attendance report was already imported/)
assert.match(route, /status: 409/)
assert.match(route, /session_id: sessionRow\.id/)
assert.match(route, /import_id: importRow\.id/)
assert.match(route, /status: 'approved'/)
assert.match(route, /unlinked_attendance/)
assert.match(route, /We couldn't safely detect the participant list in this file|parsed\.meta\?\.error/)
assert(route.indexOf("if (action === 'preview') return handlePreview") < route.indexOf(".from('student_attendance').insert"), 'preview path must not create attendance')
assert.match(adminRoute, /overview.*=== '1'/)
assert.match(adminRoute, /action === 'mark_present'/)
assert.match(adminRoute, /notRecorded/)
assert.match(adminRoute, /Choose a valid class session/)

assert.match(adminPanel, /Class attendance/)
assert.match(adminPanel, /Upload Attendance/)
assert.match(adminPanel, /Action Required/)
assert.match(adminPanel, /Pending Requests/)
assert.match(adminPanel, /Not Recorded/)
assert.match(adminPanel, /Mark Present/)
assert.match(adminPanel, /setRosterFilter\("present"\)/)
assert.match(adminPanel, /Session required/)
assert.match(adminPanel, /Accept Match/)
assert.match(uploadUi, /Drop Microsoft Teams attendance file here/)
assert.match(uploadUi, /\+ Session details/)
assert.match(uploadUi, /READY/)
assert.match(uploadUi, /CHECK/)
assert.match(uploadUi, /ALREADY PRESENT/)
assert.match(uploadUi, /Confirm \$\{totalToCreate\} Attendance/)
assert.match(historyUi, /needs attention/)
assert.match(historyUi, /already existing/)
assert.match(healthUi, /Attendance is separate and does not affect rank/)

console.log('Admin Attendance UX and import regression tests passed.')
