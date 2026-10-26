import assert from 'node:assert/strict'
import fs from 'node:fs'
import { courseworkIdentity, normalizeCatalogTitle } from '../lib/coursework-identity.js'
import { countStudentCourseworkPhases, selectVisibleStudentCoursework } from '../lib/student-coursework-visibility.js'
import { CANONICAL_ALIASES, CANONICAL_AUTHORITATIVE_OVERRIDES, CANONICAL_CURRICULUM, canonicalCounts, normalizeCanonicalText } from '../lib/canonical-coursework.js'
import { findEquivalentActiveCatalogItems } from '../lib/coursework-activation.js'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const adminRoute = read('app/api/admin-curriculum/route.js')
const teacherRoute = read('app/api/teacher-curriculum/route.js')
const studentRoute = read('app/api/student-coursework/route.js')
const adminPanel = read('components/admin/CurriculumPanel.jsx')
const teacherPanel = read('components/teacher/StudentHealthPanel.jsx')
const migration = read('supabase/migrations/20261025180000_global_coursework_catalog.sql')
const canonicalMigration = read('supabase/migrations/20261025200000_canonical_coursework_reconciliation.sql')
const aliasGuardMigration = read('supabase/migrations/20261025220000_canonical_alias_type_guard.sql')
const authoritativeMigration = read('supabase/migrations/20261025230000_authoritative_overrides.sql')

assert.equal(normalizeCatalogTitle('  Loops   Assignments  '), 'loops assignments')
assert.equal(courseworkIdentity({ phase: 'python', item_type: 'assignment', title: '  Loops   Assignments ' }), 'python|assignment|loops assignments')
assert.equal(courseworkIdentity({ phase: null, item_type: 'assignment', title: 'Ambiguous' }), '')
assert.equal(CANONICAL_CURRICULUM.length, 47)
assert.deepEqual(canonicalCounts(), {
  Python: { assignments: 11, projects: 4 },
  'Data Analytics': { assignments: 14, projects: 1 },
  SQL: { assignments: 16, projects: 1 },
})
assert.equal(new Set(CANONICAL_CURRICULUM.map(item => item.canonicalKey)).size, 47)
assert.equal(normalizeCanonicalText('Pandas-Filtering Assignment'), 'pandas filtering assignment')
assert.equal(CANONICAL_ALIASES.length, 26)
assert.equal(CANONICAL_AUTHORITATIVE_OVERRIDES.length, 20)

assert.match(migration, /create unique index if not exists coursework_items_global_identity_uidx/)
assert.match(migration, /where batch is null and phase is not null/)
assert.match(migration, /where batch is not null/)
assert.doesNotMatch(migration, /delete\s+from/i)
assert.doesNotMatch(migration, /update\s+public\.coursework_items/i)
assert.match(canonicalMigration, /coursework_aliases/)
assert.match(canonicalMigration, /coursework_catalog_extras/)
assert.match(canonicalMigration, /cf_map_coursework_alias/)
assert.match(canonicalMigration, /counts_for_points,/)
assert.match(canonicalMigration, /source_item_type = '' OR lower\(btrim\(COALESCE\(s\.submission_type/)
assert.match(canonicalMigration, /WHEN 'assignment' THEN 'assignment' WHEN 'project' THEN 'project'/)
assert.match(canonicalMigration, /ELSE ''/)
assert.match(canonicalMigration, /manual_authoritative/)
assert.match(canonicalMigration, /ON CONFLICT \(batch, coursework_item_id\)/)
assert.match(canonicalMigration, /active = false/)
assert.match(aliasGuardMigration, /UPDATE public\.coursework_aliases AS flexible/)
assert.match(aliasGuardMigration, /mapping_status = 'ignored'/)
assert.doesNotMatch(aliasGuardMigration, /DELETE FROM public\.coursework_aliases/)
assert.match(authoritativeMigration, /source = 'manual_authoritative'/)
assert.match(authoritativeMigration, /confidence = 'CONFIRMED'/)
assert.doesNotMatch(canonicalMigration, /delete\s+from\s+public\.submissions/i)

assert.match(adminRoute, /\.is\('batch', null\)/)
assert.match(adminRoute, /isGlobalCatalogItem\(item\)/)
assert.match(adminRoute, /Already active for this batch\./)
assert.match(adminRoute, /canonical curriculum is release-managed/)
assert.match(adminRoute, /map-extra/)
assert.match(adminRoute, /coursework_catalog_extras/)
assert.match(teacherRoute, /\.is\('batch', null\)/)
assert.match(teacherRoute, /isGlobalCatalogItem\(item\)/)
assert.match(studentRoute, /\.eq\('batch', student\.batch\)/)
assert.match(studentRoute, /\.eq\('active', true\)/)

assert.match(adminPanel, /Canonical Curriculum/)
assert.match(adminPanel, /item\.batch == null/)
assert.match(adminPanel, /Search canonical topics/)
assert.match(adminPanel, /Extras · Needs Review/)
assert.match(adminPanel, /Map to Canonical/)
assert.match(adminPanel, /All Current Batches/)
assert.match(adminPanel, /Preview Release/)
assert.match(adminPanel, /AbortController/)
assert.match(teacherPanel, /item\.batch == null/)
assert.match(teacherPanel, /Search global catalog/)
assert.match(teacherPanel, /Active \{active\} · Available \{availableCount\}/)
assert.match(teacherPanel, /HEALTH_CARD_PHASES/)

assert.match(read('components/student/StudentView.jsx'), /activeMs: 15000/)

const mixedBatch = 'SK | 8 APRIL | 08:00 AM'
const mixedItems = [
  ...Array.from({ length: 11 }, (_, index) => ({ id: `python-${index + 1}`, title: `Python ${index + 1}`, phase: 'Python', item_type: 'assignment', batch: null, active: true })),
  ...Array.from({ length: 9 }, (_, index) => ({ id: `sql-${index + 1}`, title: `SQL ${index + 1}`, phase: 'SQL', item_type: 'assignment', batch: mixedBatch, active: true })),
  { id: 'inactive-global', title: 'Inactive global', phase: 'Python', item_type: 'assignment', batch: null, active: false },
  { id: 'wrong-batch', title: 'Wrong batch', phase: 'Python', item_type: 'assignment', batch: 'OTHER', active: true },
  { id: 'unsupported-phase', title: 'Unsupported phase', phase: null, item_type: 'assignment', batch: null, active: true },
]
const mixedAssignments = [
  ...mixedItems.filter(item => item.id.startsWith('python-') || item.id.startsWith('sql-')).map((item, index) => ({ id: `activation-${index}`, batch: mixedBatch, coursework_item_id: item.id, active: true })),
  { id: 'inactive-activation', batch: mixedBatch, coursework_item_id: 'inactive-global', active: true },
  { id: 'wrong-batch-activation', batch: mixedBatch, coursework_item_id: 'wrong-batch', active: true },
  { id: 'unsupported-phase-activation', batch: mixedBatch, coursework_item_id: 'unsupported-phase', active: true },
  { id: 'wrong-batch-mapping', batch: 'OTHER', coursework_item_id: 'python-1', active: true },
]
const mixedVisible = selectVisibleStudentCoursework({ assignments: mixedAssignments, items: mixedItems, batch: mixedBatch })
assert.equal(mixedVisible.length, 20)
assert.deepEqual(countStudentCourseworkPhases(mixedVisible), { Python: 11, SQL: 9 })
assert.ok(!mixedVisible.some(item => ['inactive-global', 'wrong-batch', 'unsupported-phase'].includes(item.id)))
assert.ok(mixedVisible.every(item => item.batch === null || item.batch === mixedBatch))

const canonicalItems = [
  { id: 'canonical-1', title: 'List Assignments', phase: 'Python', item_type: 'assignment', batch: null, active: true, catalog_status: 'canonical' },
  { id: 'legacy-1', title: 'Legacy List Assignment', original_title: 'Legacy List Assignment', phase: 'Python', item_type: 'assignment', batch: null, active: true, catalog_status: 'legacy', canonical_coursework_item_id: 'canonical-1' },
  { id: 'extra-1', title: 'Unmapped Extra', phase: 'Python', item_type: 'assignment', batch: null, active: true, catalog_status: 'extra' },
]
const canonicalVisible = selectVisibleStudentCoursework({
  assignments: [
    { id: 'canonical-activation', batch: mixedBatch, coursework_item_id: 'canonical-1', active: true },
    { id: 'legacy-activation', batch: mixedBatch, coursework_item_id: 'legacy-1', active: true },
    { id: 'extra-activation', batch: mixedBatch, coursework_item_id: 'extra-1', active: true },
  ],
  items: canonicalItems,
  batch: mixedBatch,
})
assert.equal(canonicalVisible.length, 2)
assert.ok(canonicalVisible.every(item => item.id === 'canonical-1'))
assert.ok(canonicalVisible.some(item => item.sourceCourseworkItemId === 'legacy-1'))
assert.equal(findEquivalentActiveCatalogItems(
  [{ id: 'canonical-1', phase: 'Python', item_type: 'assignment', title: 'List Assignments' }],
  [{ id: 'legacy-1', phase: 'Python', item_type: 'assignment', title: 'Legacy List Assignment', canonical_coursework_item_id: 'canonical-1' }],
).length, 1)

console.log('Coursework catalog architecture tests passed.')
