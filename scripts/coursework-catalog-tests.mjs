import assert from 'node:assert/strict'
import fs from 'node:fs'
import { courseworkIdentity, normalizeCatalogTitle } from '../lib/coursework-identity.js'
import { countStudentCourseworkPhases, selectVisibleStudentCoursework } from '../lib/student-coursework-visibility.js'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const adminRoute = read('app/api/admin-curriculum/route.js')
const teacherRoute = read('app/api/teacher-curriculum/route.js')
const studentRoute = read('app/api/student-coursework/route.js')
const adminPanel = read('components/admin/CurriculumPanel.jsx')
const teacherPanel = read('components/teacher/StudentHealthPanel.jsx')
const migration = read('supabase/migrations/20261025180000_global_coursework_catalog.sql')

assert.equal(normalizeCatalogTitle('  Loops   Assignments  '), 'loops assignments')
assert.equal(courseworkIdentity({ phase: 'python', item_type: 'assignment', title: '  Loops   Assignments ' }), 'python|assignment|loops assignments')
assert.equal(courseworkIdentity({ phase: null, item_type: 'assignment', title: 'Ambiguous' }), '')

assert.match(migration, /create unique index if not exists coursework_items_global_identity_uidx/)
assert.match(migration, /where batch is null and phase is not null/)
assert.match(migration, /where batch is not null/)
assert.doesNotMatch(migration, /delete\s+from/i)
assert.doesNotMatch(migration, /update\s+public\.coursework_items/i)

assert.match(adminRoute, /\.is\('batch', null\)/)
assert.match(adminRoute, /isGlobalCatalogItem\(item\)/)
assert.match(adminRoute, /Already active for this batch\./)
assert.match(adminRoute, /const payload = \{ \.\.\.normalized\.value, batch: null \}/)
assert.match(teacherRoute, /\.is\('batch', null\)/)
assert.match(teacherRoute, /isGlobalCatalogItem\(item\)/)
assert.match(studentRoute, /\.eq\('batch', student\.batch\)/)
assert.match(studentRoute, /\.eq\('active', true\)/)

assert.match(adminPanel, /Global catalog — activate separately for batches\./)
assert.match(adminPanel, /item\.batch == null/)
assert.match(adminPanel, /Search global catalog/)
assert.match(adminPanel, /Active \{active\} · Available \{availableCount\}/)
assert.match(adminPanel, /HEALTH_CARD_PHASES/)
assert.doesNotMatch(adminPanel, /form\.batch/)
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

console.log('Coursework catalog architecture tests passed.')
