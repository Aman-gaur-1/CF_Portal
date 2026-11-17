import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateCourseworkSummary } from '../lib/coursework-scoring.js'

const items = [
  { id: 'a1', title: 'Assignment 1', phase: 'Python', item_type: 'assignment', batch: null, active: true, catalog_status: 'canonical' },
  { id: 'p1', title: 'Project 1', phase: 'Python', item_type: 'project', batch: null, active: true, catalog_status: 'canonical' },
]
const submissions = [
  { id: 's1', student_id: 'student-1', batch: 'Batch A', topic: 'Assignment 1', submission_type: 'assignment', coursework_item_id: 'a1', submitted_at: '2026-10-01T10:00:00Z' },
  { id: 's2', student_id: 'student-1', batch: 'Batch A', topic: 'Assignment 1 retry', submission_type: 'assignment', coursework_item_id: 'a1', submitted_at: '2026-10-01T11:00:00Z' },
  { id: 's3', student_id: 'student-1', batch: 'Batch A', topic: 'Project 1', submission_type: 'project', coursework_item_id: 'p1', submitted_at: '2026-10-01T12:00:00Z' },
  { id: 's4', student_id: 'student-1', batch: 'Batch A', topic: 'Unresolved historical row', submission_type: 'assignment', coursework_item_id: null, submitted_at: '2026-10-01T13:00:00Z' },
]
const summary = calculateCourseworkSummary(submissions, items)
assert.equal(summary.assignmentCount * 5, summary.assignmentPoints)
assert.equal(summary.projectCount * 10, summary.projectPoints)
assert.equal(summary.points, 15)
assert.equal(summary.validSubmissionCount, 2)
assert.equal(summary.awardBySubmissionId.has('s4'), false)

const pointSystem = fs.readFileSync(new URL('../supabase/migrations/20261031082152_unified_coursework_point_system.sql', import.meta.url), 'utf8')
const reconciliation = fs.readFileSync(new URL('../supabase/migrations/20261031085936_authoritative_python_historical_reconciliation.sql', import.meta.url), 'utf8')
const completion = fs.readFileSync(new URL('../supabase/migrations/20261031090119_canonical_historical_reconciliation_completion.sql', import.meta.url), 'utf8')
assert.match(pointSystem, /assignment.*5|5.*assignment/i)
assert.match(pointSystem, /project.*10|10.*project/i)
assert.match(pointSystem, /DISTINCT ON/)
assert.match(reconciliation, /counts_for_points/)
assert.match(completion, /counts_for_points/)
assert.doesNotMatch(reconciliation, /delete from public\.submissions/i)
assert.doesNotMatch(completion, /delete from public\.submissions/i)

console.log('Historical scoring reconciliation tests passed.')

