import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chooseSafeStudentMapping, normalizeCourseworkMappingText } from '../lib/coursework-mapping.js'
import { calculateCourseworkSummary } from '../lib/coursework-scoring.js'

const canonical = [
  { id: 'assignment-1', title: 'Loops Assignment', phase: 'Python', item_type: 'assignment', batch: null, active: true, catalog_status: 'canonical' },
  { id: 'project-1', title: 'ATM Project', phase: 'Python', item_type: 'project', batch: null, active: true, catalog_status: 'canonical' },
]
assert.equal(normalizeCourseworkMappingText(' Loops — Assignment '), 'loops assignment')
assert.equal(chooseSafeStudentMapping({ sourceTopic: 'Loops Assignment', sourceType: 'assignment', sourcePhase: 'Python', canonicalItems: canonical, aliases: [] }).mode, 'auto_applied')
assert.equal(chooseSafeStudentMapping({ sourceTopic: 'Unknown Legacy Topic', sourceType: 'assignment', sourcePhase: 'Python', canonicalItems: canonical, aliases: [] }).mode, 'pending_review')
assert.equal(chooseSafeStudentMapping({ sourceTopic: 'Loops Assignment', sourceType: 'project', sourcePhase: 'Python', canonicalItems: canonical, aliases: [] }).mode, 'pending_review')
assert.equal(chooseSafeStudentMapping({ sourceTopic: 'ATM Build', sourceType: 'project', sourcePhase: 'Python', canonicalItems: canonical, aliases: [{ normalized_alias: 'atm build', source_phase: 'Python', source_item_type: 'project', canonical_coursework_item_id: 'project-1', confidence: 'HIGH_CONFIDENCE', mapping_status: 'mapped' }] }).item.id, 'project-1')

const submissions = [
  { id: '1', student_id: 'student', batch: 'Batch A', topic: 'Loops Assignment', submission_type: 'assignment', coursework_item_id: 'assignment-1', submitted_at: '2026-11-01T10:00:00Z' },
  { id: '2', student_id: 'student', batch: 'Batch A', topic: 'Loops Assignment retry', submission_type: 'assignment', coursework_item_id: 'assignment-1', submitted_at: '2026-11-01T11:00:00Z' },
  { id: '3', student_id: 'student', batch: 'Batch A', topic: 'ATM Project', submission_type: 'project', coursework_item_id: 'project-1', submitted_at: '2026-11-01T12:00:00Z' },
]
const score = calculateCourseworkSummary(submissions, canonical)
assert.equal(score.assignmentCount, 1)
assert.equal(score.projectCount, 1)
assert.equal(score.points, 15)
assert.equal(score.awardBySubmissionId.get('2'), undefined, 'duplicate target does not award a second point')

const migration = fs.readFileSync(new URL('../supabase/migrations/20261117120000_student_coursework_mapping_review.sql', import.meta.url), 'utf8')
const studentRoute = fs.readFileSync(new URL('../app/api/student-coursework-mapping/route.js', import.meta.url), 'utf8')
const trainerRoute = fs.readFileSync(new URL('../app/api/teacher-coursework-mapping-review/route.js', import.meta.url), 'utf8')
const studentView = fs.readFileSync(new URL('../components/student/StudentView.jsx', import.meta.url), 'utf8')
assert.match(migration, /status in \('pending_review', 'auto_applied', 'approved', 'rejected'\)/)
assert.match(migration, /coursework_mapping_requests_pending_submission_idx/)
assert.match(migration, /enable row level security/)
assert.match(studentRoute, /requireStudent/)
assert.match(studentRoute, /autoApply/)
assert.match(studentRoute, /duplicateTarget/)
assert.match(trainerRoute, /getTeacherScope/)
assert.match(trainerRoute, /eq\('status', 'pending_review'\)/)
assert.match(studentView, /Mapping Required/)
assert.match(studentView, /Map Assignment/)
assert.match(studentView, /loadSubmissions\(\{ silent: true \}\)/)

console.log('Student coursework mapping tests passed.')

