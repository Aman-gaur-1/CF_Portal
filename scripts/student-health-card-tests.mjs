import assert from 'node:assert/strict'
import {
  HEALTH_CARD_EPOCH,
  getIndiaDateString,
  isUniqueViolation,
  normalizeHealthActivityType,
} from '../lib/student-health-card.js'
import {
  calculateLifetimeCoursework,
  getBadge,
  getNextMilestone,
} from '../lib/coursework-scoring.js'
import {
  buildCourseworkCatalogPreview,
  buildCourseworkMergeSuggestions,
  hasProjectLikeTitle,
  isCatalogEpochEligible,
  normalizeCatalogTitle,
  normalizeProjectDetectionTitle,
  normalizeCatalogType,
  parseCourseworkCandidateKey,
} from '../lib/coursework-catalog.js'

assert.equal(HEALTH_CARD_EPOCH, '2026-10-01')
assert.equal(getIndiaDateString(new Date('2026-09-30T18:29:59.000Z')), '2026-09-30')
assert.equal(getIndiaDateString(new Date('2026-09-30T18:30:00.000Z')), '2026-10-01')
assert.equal(normalizeHealthActivityType('project'), 'project')
assert.equal(normalizeHealthActivityType('200'), 'project')
assert.equal(normalizeHealthActivityType('100'), 'assignment')
assert.equal(normalizeHealthActivityType('50'), '')
assert.equal(isUniqueViolation({ code: '23505' }), true)
assert.equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint' }), true)

const representativeAssignments = Array.from({ length: 16 }, (_, index) => ({
  id: `assignment-${index}`,
  student_id: 'student-1',
  batch: 'Batch A',
  topic: `Assignment ${index}`,
  submission_type: 'assignment',
  submitted_at: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
}))
representativeAssignments.push({
  id: 'assignment-resubmission',
  student_id: 'student-1',
  batch: 'Batch A',
  topic: 'Assignment 0',
  submission_type: 'assignment',
  submitted_at: '2026-09-30T10:00:00.000Z',
})
const representativeScore = calculateLifetimeCoursework(representativeAssignments)
assert.equal(representativeScore.assignmentCount, 16, 'resubmissions must not farm lifetime points')
assert.equal(representativeScore.projectCount, 0)
assert.equal(representativeScore.points, 80, '16 assignments must normalize to 80 points')
assert.equal(getBadge(80).name, 'Dedicated', 'normalized badge should preserve the old 1600-point status')
assert.equal(getNextMilestone(80), 100, '80 points should be 80 / 100 to the next badge')

assert.equal(normalizeCatalogTitle('  SQL   Basics  '), 'sql basics')
assert.equal(normalizeProjectDetectionTitle('Python_Projects'), 'python projects')
for (const title of [
  'project',
  'projects',
  'PROJECT',
  'PROJECTS',
  'project_',
  'projects_',
  'project-',
  'projects:',
  'Python Projects',
  'Python_Projects',
  'Python-Projects',
  'ATM project',
  'ATM Projects',
  'Guess the Word Game - Project',
  'weather data project assignment',
]) assert.equal(hasProjectLikeTitle(title), true, `project-like title should be flagged: ${title}`)
assert.equal(hasProjectLikeTitle('projector'), false)
assert.equal(normalizeCatalogType('100'), 'assignment')
assert.equal(normalizeCatalogType('200'), 'project')
assert.equal(isCatalogEpochEligible('2026-09-30T18:29:59.000Z', { asOfDate: '2026-10-16' }), false)
assert.equal(isCatalogEpochEligible('2026-09-30T18:30:00.000Z', { asOfDate: '2026-10-16' }), true)
const mergeSuggestions = buildCourseworkMergeSuggestions([
  { key: 'one', batch: 'Batch A', type: 'assignment', proposedTitle: 'Data Type & Variables', affectedSubmissions: 2 },
  { key: 'two', batch: 'Batch A', type: 'assignment', proposedTitle: 'data type/variables', affectedSubmissions: 1 },
])
assert.equal(mergeSuggestions.length, 1, 'punctuation variants should be review-only merge suggestions')
assert.equal(mergeSuggestions[0].reason, 'punctuation or spacing variant')
assert.deepEqual(parseCourseworkCandidateKey('Batch%20%7C%20A|assignment|sql%20basics'), {
  batch: 'Batch | A',
  type: 'assignment',
  normalizedTitle: 'sql basics',
})

const catalogPreview = buildCourseworkCatalogPreview({
  students: [
    { id: 'student-1', batch: 'Batch A' },
    { id: 'student-2', batch: 'Batch A' },
    { id: 'student-3', batch: 'Batch A' },
  ],
  submissions: [
    { id: 's-1', student_id: 'student-1', batch: 'Batch A', topic: 'SQL Basics', submission_type: '100', submitted_at: '2026-10-02T10:00:00.000Z', coursework_item_id: null },
    { id: 's-2', student_id: 'student-2', batch: 'Batch A', topic: ' sql   basics ', submission_type: 'assignment', submitted_at: '2026-10-03T10:00:00.000Z', coursework_item_id: null },
    { id: 's-3', student_id: 'student-3', batch: 'Batch A', topic: 'SQL Basics', submission_type: 'project', submitted_at: '2026-10-04T10:00:00.000Z', coursework_item_id: null },
    { id: 's-4', student_id: 'student-1', batch: 'Batch A', topic: 'Old Work', submission_type: 'assignment', submitted_at: '2026-09-30T10:00:00.000Z', coursework_item_id: null },
    { id: 's-5', student_id: 'student-1', batch: 'Batch A', topic: 'Existing Work', submission_type: 'assignment', submitted_at: '2026-10-05T10:00:00.000Z', coursework_item_id: 'already-linked' },
  ],
  courseworkItems: [],
  asOfDate: '2026-10-16',
})
assert.equal(catalogPreview.totals.totalSubmissionsExamined, 4, 'pre-epoch rows must be excluded from setup')
assert.equal(catalogPreview.totals.linkedSubmissions, 1, 'existing links are counted but never re-linked')
assert.equal(catalogPreview.totals.unlinkedSubmissions, 3)
assert.equal(catalogPreview.totals.ambiguousMatches, 3, 'mixed assignment/project title must remain ambiguous')
assert.equal(catalogPreview.candidates.length, 1)
assert.equal(catalogPreview.candidates[0].confidence, 'ambiguous')
assert.equal(catalogPreview.candidates[0].canLink, false)

const safeCatalogPreview = buildCourseworkCatalogPreview({
  students: [{ id: 'student-1', batch: 'Batch B' }],
  submissions: [{
    id: 'safe-1',
    student_id: 'student-1',
    batch: 'Batch B',
    topic: 'Python Basics',
    submission_type: 'assignment',
    submitted_at: '2026-10-02T10:00:00.000Z',
    coursework_item_id: null,
  }],
  courseworkItems: [],
  asOfDate: '2026-10-16',
})
assert.equal(safeCatalogPreview.candidates[0].confidence, 'exact')
assert.equal(safeCatalogPreview.totals.exactMatches, 1)
assert.equal(safeCatalogPreview.totals.courseworkItemsWouldBeCreated, 1)
assert.equal(safeCatalogPreview.totals.submissionsWouldBeLinked, 1)

const linkedDuplicateLifetime = calculateLifetimeCoursework([
  { id: 'legacy-functions', student_id: 'student-1', batch: 'Batch A', topic: 'Functions', submission_type: 'assignment', submitted_at: '2026-09-30T10:00:00.000Z' },
  { id: 'linked-functions', student_id: 'student-1', batch: 'Batch A', topic: 'Functions', submission_type: 'assignment', submitted_at: '2026-10-02T10:00:00.000Z', coursework_item_id: 'item-functions' },
], [
  { id: 'item-functions', item_type: 'assignment', title: 'Functions', batch: 'Batch A', active: true },
])
assert.equal(linkedDuplicateLifetime.assignmentCount, 1, 'linking must not add a duplicate lifetime award for the same student/type/topic')
assert.equal(linkedDuplicateLifetime.points, 5)

console.log('Student Health Card domain tests passed.')

