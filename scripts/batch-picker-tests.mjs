import assert from 'node:assert/strict'
import fs from 'node:fs'
import { filterBatchOptions, sortBatchNames, sortBatchOptions } from '../lib/batch-picker.js'

const batches = [
  'SQL | 12 Jun | 07:00 PM',
  'AG | Py | DS | 08 Jun | 09:15 PM',
  'AG | SQL | 12 Jun | 07:00 PM',
  'DS | 04 May | 08:00 PM',
  'SK | 8 APRIL | 08:00 AM',
  'ag | Py | DS | 08 Jun | 09:15 PM',
  'Batch 10',
  'Batch 2',
]

assert.deepEqual(sortBatchNames(batches), [
  'AG | Py | DS | 08 Jun | 09:15 PM',
  'ag | Py | DS | 08 Jun | 09:15 PM',
  'AG | SQL | 12 Jun | 07:00 PM',
  'Batch 2',
  'Batch 10',
  'DS | 04 May | 08:00 PM',
  'SK | 8 APRIL | 08:00 AM',
  'SQL | 12 Jun | 07:00 PM',
], 'case-insensitive natural sort preserves exact duplicate-case values')

assert.deepEqual(sortBatchOptions([
  { id: 'first', name: 'Batch 10' },
  { id: 'second', name: 'Batch 2' },
]), [
  { value: 'Batch 2', label: 'Batch 2' },
  { value: 'Batch 10', label: 'Batch 10' },
], 'object batch options use names as exact values')

const sorted = sortBatchOptions(['B', 'A', 'B', '', null, 'C'])
assert.deepEqual(sorted.map(option => option.value), ['A', 'B', 'C'], 'empty and exact duplicate options are removed')
assert.deepEqual(filterBatchOptions(sorted, '  b  '), [{ value: 'B', label: 'B' }], 'search is case-insensitive and whitespace-tolerant')
const searchableNames = sortBatchOptions(batches)
assert.equal(filterBatchOptions(searchableNames, 'SQL').length, 2, 'search supports prefix and middle text')
assert.equal(filterBatchOptions(searchableNames, '08 Jun').length, 2, 'search supports date fragments')

const searchableBatchSelect = fs.readFileSync(new URL('../components/ui/SearchableBatchSelect.jsx', import.meta.url), 'utf8')
const curriculumPanel = fs.readFileSync(new URL('../components/admin/CurriculumPanel.jsx', import.meta.url), 'utf8')
assert.match(searchableBatchSelect, /Search batches\.\.\./, 'shared search placeholder is present')
assert.match(searchableBatchSelect, /No batches found/, 'empty search state is present')
assert.match(searchableBatchSelect, /role="combobox"/, 'picker exposes a combobox role')
assert.match(searchableBatchSelect, /ArrowDown.*moveActive/s, 'keyboard navigation supports ArrowDown')
assert.match(searchableBatchSelect, /onChange\?\.\(option\.value\)/, 'single selection returns the exact option value')
assert.match(searchableBatchSelect, /aria-multiselectable="true"/, 'multi-select exposes its selected state')
assert.match(searchableBatchSelect, /\[\.\.\.specialOptions, \.\.\.options\]/, 'special options are pinned before sorted batches')
assert.match(searchableBatchSelect, /values\.length \? `Selected: \$\{values\.length\}`/, 'multi-select keeps selected count visible')
assert.match(curriculumPanel, /SearchableBatchMultiSelect/, 'curriculum uses the shared multi-select')
assert.doesNotMatch(curriculumPanel, /batchSearch|visibleBatches|toggleBatch/, 'curriculum does not duplicate batch search logic')

const convertedLocations = [
  'components/ui/AttendanceUpload.jsx',
  'components/ui/AttendanceImportHistory.jsx',
  'components/admin/AdminAttendancePanel.jsx',
  'components/admin/AdminCalendarPanel.jsx',
  'components/admin/AdminCourseworkPanel.jsx',
  'components/admin/AdminDashboard.jsx',
  'components/admin/AdminQueriesPanel.jsx',
  'components/admin/BatchSetupPanel.jsx',
  'components/admin/CurriculumPanel.jsx',
  'components/admin/AdminCourseworkSetupPanel.jsx',
  'components/teacher/AttendanceTab.jsx',
  'components/teacher/StudentsTab.jsx',
  'components/teacher/StudentHealthPanel.jsx',
  'components/teacher/SubmissionsTab.jsx',
  'components/student/StudentAuth.jsx',
]
for (const location of convertedLocations) {
  const source = fs.readFileSync(new URL(`../${location}`, import.meta.url), 'utf8')
  assert.match(source, /SearchableBatchSelect|SearchableBatchMultiSelect/, `${location} uses the shared batch picker`)
}

const teacherAttendance = fs.readFileSync(new URL('../components/teacher/AttendanceTab.jsx', import.meta.url), 'utf8')
const teacherStudents = fs.readFileSync(new URL('../components/teacher/StudentsTab.jsx', import.meta.url), 'utf8')
assert.match(teacherAttendance, /setBatches\(data\.batches \|\| \[\]\)/, 'teacher attendance keeps the server-provided scope')
assert.match(teacherStudents, /setBatches\(data\.batches \|\| \[\]\)/, 'teacher student management keeps the server-provided scope')

console.log(`batch-picker tests passed (${convertedLocations.length} converted locations)`)
