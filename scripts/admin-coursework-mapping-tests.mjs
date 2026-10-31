import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calculateCourseworkSummary } from '../lib/coursework-scoring.js'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261031092056_admin_coursework_mapping_correction.sql')
const safetyMigration = read('supabase/migrations/20261031092502_admin_coursework_mapping_correction_safety.sql')
const compatibilityMigration = read('supabase/migrations/20261031092936_admin_coursework_mapping_submission_id_compatibility.sql')
const privilegeMigration = read('supabase/migrations/20261031093026_admin_coursework_mapping_correction_privileges.sql')
const route = read('app/api/admin-submission-mapping/route.js')
const modal = read('components/admin/CorrectCourseworkMappingModal.jsx')
const dashboard = read('components/admin/AdminDashboard.jsx')

const items = [
  { id: 'loops', title: 'Loops Assignments', phase: 'Python', item_type: 'assignment', batch: null, active: true, catalog_status: 'canonical' },
  { id: 'atm', title: 'ATM Functionalities', phase: 'Python', item_type: 'project', batch: null, active: true, catalog_status: 'canonical' },
  { id: 'data-types', title: 'Data Type & Variables', phase: 'Python', item_type: 'assignment', batch: null, active: true, catalog_status: 'canonical' },
  { id: 'youtube', title: 'YouTube Comment Analysis Project', phase: 'Python', item_type: 'project', batch: null, active: true, catalog_status: 'canonical' },
]
const submissions = [
  { id: 'a', student_id: 'student', batch: 'Batch', topic: 'Loop assignment A', submission_type: 'assignment', coursework_item_id: 'loops', submitted_at: '2026-10-01T10:00:00Z' },
  { id: 'b', student_id: 'student', batch: 'Batch', topic: 'Loop assignment B', submission_type: 'assignment', coursework_item_id: 'loops', submitted_at: '2026-10-01T11:00:00Z' },
  { id: 'c', student_id: 'student', batch: 'Batch', topic: 'YouTube project', submission_type: 'project', coursework_item_id: 'youtube', submitted_at: '2026-10-01T12:00:00Z' },
  { id: 'd', student_id: 'student', batch: 'Batch', topic: 'Historical unlinked', submission_type: 'assignment', coursework_item_id: null, submitted_at: '2026-10-01T13:00:00Z' },
  { id: 'e', student_id: 'student', batch: 'Batch', topic: 'Loop assignment E', submission_type: 'assignment', coursework_item_id: 'loops', submitted_at: '2026-10-01T14:00:00Z' },
]

const before = calculateCourseworkSummary(submissions, items)
assert.equal(before.assignmentCount, 1)
assert.equal(before.projectCount, 1)
assert.equal(before.points, 15)

const assignmentToProject = [{ submission_id: 'a', student_id: 'student', batch: 'Batch', new_canonical_coursework_item_id: 'atm', corrected_at: '2026-10-02T10:00:00Z' }]
const afterAssignmentToProject = calculateCourseworkSummary(submissions, items, [], assignmentToProject)
assert.equal(afterAssignmentToProject.assignmentCount, 1)
assert.equal(afterAssignmentToProject.projectCount, 2)
assert.equal(afterAssignmentToProject.points, 25)
assert.equal(afterAssignmentToProject.awards.find(row => row.id === 'a')?.canonical_type, 'project')

const duplicateTarget = [...assignmentToProject, { submission_id: 'b', student_id: 'student', batch: 'Batch', new_canonical_coursework_item_id: 'atm', corrected_at: '2026-10-02T11:00:00Z' }]
const afterDuplicate = calculateCourseworkSummary(submissions, items, [], duplicateTarget)
assert.equal(afterDuplicate.points, 25)
assert.equal(afterDuplicate.projectCount, 2)

const projectToAssignment = [...duplicateTarget, { submission_id: 'c', student_id: 'student', batch: 'Batch', new_canonical_coursework_item_id: 'data-types', corrected_at: '2026-10-02T12:00:00Z' }]
const afterProjectToAssignment = calculateCourseworkSummary(submissions, items, [], projectToAssignment)
assert.equal(afterProjectToAssignment.assignmentCount, 2)
assert.equal(afterProjectToAssignment.projectCount, 1)
assert.equal(afterProjectToAssignment.points, 20)

const repeatCorrection = [...projectToAssignment, { submission_id: 'c', student_id: 'student', batch: 'Batch', new_canonical_coursework_item_id: 'atm', corrected_at: '2026-10-02T13:00:00Z' }]
const afterRepeat = calculateCourseworkSummary(submissions, items, [], repeatCorrection)
assert.equal(afterRepeat.points, 15)
assert.equal(afterRepeat.assignmentCount, 1)
assert.equal(afterRepeat.projectCount, 1)

const historicalCorrection = [...repeatCorrection, { submission_id: 'd', student_id: 'student', batch: 'Batch', new_canonical_coursework_item_id: 'loops', corrected_at: '2026-10-02T14:00:00Z' }]
const afterHistoricalDuplicate = calculateCourseworkSummary(submissions, items, [], historicalCorrection)
assert.equal(afterHistoricalDuplicate.points, 15)
assert.equal(afterHistoricalDuplicate.assignmentCount, 1)

assert.match(migration, /coursework_mapping_corrections/)
assert.match(migration, /cf_correct_coursework_mapping/)
assert.match(migration, /new_item_type/)
assert.match(migration, /counts_for_points = false/)
assert.doesNotMatch(migration, /new_points|new_score|p_points|p_score/i)
assert.match(safetyMigration, /status = 'rejected'/)
assert.doesNotMatch(safetyMigration, /status = 'superseded'/)
assert.match(compatibilityMigration, /submission_id TYPE text/)
assert.match(compatibilityMigration, /p_submission_id text/)
assert.match(privilegeMigration, /REVOKE ALL ON TABLE public\.coursework_mapping_corrections FROM service_role/)
assert.match(route, /getAdminFromRequest\(request\)/)
assert.match(route, /targetCanonicalCourseworkItemId/)
assert.match(route, /newPoints.*points.*score.*submission_type.*phase/i)
assert.match(route, /cf_correct_coursework_mapping/)
assert.match(modal, /Correct Coursework Mapping/)
assert.match(modal, /Confirm Correction/)
assert.match(modal, /Only active global canonical curriculum items are selectable/)
assert.doesNotMatch(modal, /name="(points|score|submission_type|item_type)"/)
assert.match(dashboard, /CorrectCourseworkMappingModal/)
assert.match(dashboard, /Correct Mapping/)

console.log('Admin coursework mapping correction tests passed.')
