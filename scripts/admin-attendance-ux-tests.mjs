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

for (const [extension, buffer] of [
  ['xlsx', teamsWorkbookBuffer('xlsx')],
  ['xls', teamsWorkbookBuffer('xls')],
  ['csv', Buffer.from('Name\nExact Student\nA Student (External)\nUnknown Participant\n', 'utf8')],
]) {
  const parsed = parseTeamsReport(buffer, `teams-smoke.${extension}`)
  assert.deepEqual(parsed.names, ['Exact Student', 'A Student (External)', 'Unknown Participant'], `${extension} Teams parsing`)
}

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
assert(route.indexOf("if (action === 'preview') return handlePreview") < route.indexOf(".from('student_attendance').insert"), 'preview path must not create attendance')

assert.match(adminPanel, /useState\("upload"\)/)
assert.match(adminPanel, /Upload Attendance/)
assert.match(adminPanel, /Pending Approvals/)
assert.match(adminPanel, /Needs Attention/)
assert.match(adminPanel, />History</)
assert.match(adminPanel, /Session required/)
assert.match(adminPanel, /Accept Suggested Match/)
assert.match(uploadUi, /\+ Add session details/)
assert.match(uploadUi, /Ready to mark/)
assert.match(uploadUi, /Not matched/)
assert.match(uploadUi, /Confirm \$\{totalToCreate\} Attendance Record/)
assert.match(historyUi, /needs attention/)
assert.match(historyUi, /already existing/)
assert.match(healthUi, /Attendance is separate and does not affect rank/)

console.log('Admin Attendance UX and import regression tests passed.')
