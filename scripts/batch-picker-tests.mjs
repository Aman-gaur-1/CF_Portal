import assert from 'node:assert/strict'
import fs from 'node:fs'
import { filterBatchOptions, sortBatchNames, sortBatchOptions } from '../lib/batch-picker.js'
import { calculateBatchPickerPosition } from '../lib/batch-picker-position.js'

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

const belowPosition = calculateBatchPickerPosition(
  { left: 100, top: 100, bottom: 150, width: 280 },
  { width: 900, height: 800 },
)
assert.equal(belowPosition.placement, 'below', 'picker opens below when there is useful space below')
assert.equal(belowPosition.top, 158, 'below placement uses trigger bottom plus the configured gap')
assert.equal(belowPosition.maxHeight, 450, 'below placement uses the capped available height')

const abovePosition = calculateBatchPickerPosition(
  { left: 700, top: 680, bottom: 730, width: 280 },
  { width: 900, height: 800 },
)
assert.equal(abovePosition.placement, 'above', 'picker opens above when the lower viewport is constrained')
assert.equal(abovePosition.top, 222, 'above placement is anchored to the trigger and calculated panel height')

const constrainedPosition = calculateBatchPickerPosition(
  { left: 0, top: 140, bottom: 190, width: 300 },
  { width: 360, height: 240 },
)
assert.equal(constrainedPosition.placement, 'above', 'constrained mobile viewport chooses the roomier side')
assert.equal(constrainedPosition.maxHeight, 120, 'mobile max-height uses the actual available viewport space')
assert.equal(constrainedPosition.left, 12, 'mobile panel is clamped to the viewport padding')
assert.equal(constrainedPosition.width, 300, 'mobile panel keeps trigger width when it fits the safe viewport')
assert.ok(constrainedPosition.left + constrainedPosition.width <= 348, 'mobile panel stays inside the viewport')

const narrowPosition = calculateBatchPickerPosition(
  { left: 0, top: 80, bottom: 120, width: 300 },
  { width: 200, height: 600 },
)
assert.equal(narrowPosition.width, 176, 'very narrow viewports still clamp panel width')
assert.equal(narrowPosition.left, 12, 'very narrow viewports clamp panel left edge')

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
assert.match(searchableBatchSelect, /createPortal\(panel, document\.body\)/, 'picker panels render in document.body')
assert.match(searchableBatchSelect, /const panelRef = useRef\(null\)/g, 'single and multi pickers keep portal panel refs')
assert.match(searchableBatchSelect, /panelRef\.current\?\.contains\(event\.target\)/, 'outside-click handling includes the portaled panel')
assert.match(searchableBatchSelect, /window\.addEventListener\("scroll", positionPanel, true\)/, 'nested scroll repositions the panel')
assert.match(searchableBatchSelect, /scrollIntoView\(\{ block: "nearest" \}\)/, 'keyboard navigation keeps the active option visible')
assert.doesNotMatch(searchableBatchSelect, /top: `calc|bottom: `calc/, 'panel positioning does not depend on parent-relative offsets')
const globalCss = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
assert.match(globalCss, /\.batch-picker-panel \{ position: fixed;/, 'portal panel uses fixed viewport positioning')
assert.match(globalCss, /\.batch-picker-panel \{[^}]*z-index: 65;/s, 'panel layer stays above normal content and below critical modals')
assert.match(globalCss, /\.batch-picker-options \{[^}]*overflow-y: auto;/s, 'options area owns internal scrolling')
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
