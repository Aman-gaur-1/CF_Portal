import assert from 'node:assert/strict'
import fs from 'node:fs'
import { courseworkIdentity, normalizeCatalogTitle } from '../lib/coursework-identity.js'

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
assert.doesNotMatch(adminPanel, /form\.batch/)
assert.match(teacherPanel, /item\.batch == null/)
assert.match(teacherPanel, /Search global catalog/)

console.log('Coursework catalog architecture tests passed.')
