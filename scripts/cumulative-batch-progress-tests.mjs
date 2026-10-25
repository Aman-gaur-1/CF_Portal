import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildProgressPreview, normalizeProgressPayload, sortProgressItems } from '../lib/coursework-progress.js'

const migration = fs.readFileSync(new URL('../supabase/migrations/20261025190000_cumulative_batch_progress.sql', import.meta.url), 'utf8')
const adminRoute = fs.readFileSync(new URL('../app/api/admin-curriculum/route.js', import.meta.url), 'utf8')
const teacherRoute = fs.readFileSync(new URL('../app/api/teacher-curriculum/route.js', import.meta.url), 'utf8')
const studentRoute = fs.readFileSync(new URL('../app/api/student-coursework/route.js', import.meta.url), 'utf8')
const progressUi = fs.readFileSync(new URL('../components/coursework/BatchProgressControls.jsx', import.meta.url), 'utf8')

const items = [
  { id: 'p1', phase: 'Python', item_type: 'assignment', title: 'P1', sort_order: 10, active: true, batch: null },
  { id: 'p2', phase: 'Python', item_type: 'assignment', title: 'P2', sort_order: 20, active: true, batch: null },
  { id: 'p3', phase: 'Python', item_type: 'assignment', title: 'P3', sort_order: 30, active: true, batch: null },
  { id: 'p4', phase: 'Python', item_type: 'assignment', title: 'P4', sort_order: 40, active: true, batch: null },
]
assert.deepEqual(sortProgressItems(items).map(item => item.id), ['p1', 'p2', 'p3', 'p4'])
const preview = buildProgressPreview({
  globalItems: items,
  activations: [{ coursework_item_id: 'p1', active: true }],
  currentProgress: { phase: 'Python', item_type: 'assignment', covered_through_sort_order: 10 },
  phase: 'Python', itemType: 'assignment', targetItemId: 'p3', activeStudentCount: 7,
})
assert.equal(preview.newItemCount, 2)
assert.equal(preview.activeStudentCount, 7)
assert.equal(preview.backward, false)
const backward = buildProgressPreview({
  globalItems: items,
  activations: [{ coursework_item_id: 'p1', active: true }, { coursework_item_id: 'p2', active: true }, { coursework_item_id: 'p3', active: true }],
  currentProgress: { phase: 'Python', item_type: 'assignment', covered_through_sort_order: 30 },
  phase: 'Python', itemType: 'assignment', targetItemId: 'p1', activeStudentCount: 7,
})
assert.equal(backward.backward, true)
assert.equal(backward.existingActivationsRetained, true)
assert.equal(normalizeProgressPayload({ batch: 'B', phase: 'python', itemType: 'assignment', coveredThroughCourseworkItemId: 'p3' }).value.phase, 'Python')

assert.match(migration, /ADD COLUMN IF NOT EXISTS sort_order integer/)
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.batch_curriculum_progress/)
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.student_coursework_reconciliations/)
assert.match(migration, /CHECK \(counts_for_points = false\)/)
assert.match(migration, /cf_apply_batch_curriculum_progress/)
assert.match(migration, /existing activations are retained/i)
assert.match(migration, /scored_assignment_count/)
assert.match(migration, /student_coursework_reconciliations r/)
assert.match(adminRoute, /preview-progress/)
assert.match(adminRoute, /cf_apply_batch_curriculum_progress/)
assert.match(teacherRoute, /This batch is not assigned to you\./)
assert.match(teacherRoute, /preview-progress/)
assert.match(studentRoute, /student_coursework_reconciliations/)
assert.match(studentRoute, /historical_reconciliation/)
assert.match(progressUi, /Covered through/)
assert.match(progressUi, /Existing activations are retained/)

console.log('Cumulative batch progress tests passed.')
