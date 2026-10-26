import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'

function readEnv(filePath) {
  const values = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
}

function firstCredential(value) {
  const parsed = JSON.parse(value || '{}')
  if (Array.isArray(parsed)) return parsed[0] || {}
  const entry = Object.entries(parsed)[0]
  return entry ? { username: entry[0], password: entry[1] } : {}
}

const localEnv = readEnv(path.join(root, '.env.local'))
const stagingEnvPath = process.env.CF_PORTAL_STAGING_ENV_FILE || path.resolve(root, '..', 'CF_Portal', '.env.staging.local')
const stagingEnv = readEnv(stagingEnvPath)
assert.match(stagingEnv.NEXT_PUBLIC_SUPABASE_URL || '', /bgpmsckjvutnqkryxknb\.supabase\.co$/)
assert.ok(!(stagingEnv.NEXT_PUBLIC_SUPABASE_URL || '').includes('hktpncjuflynwdikmbfl'), 'bulk E2E must target staging')
const serviceKey = stagingEnv.SUPABASE_SERVICE_KEY || stagingEnv.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey, 'staging service key is required')
const db = createClient(stagingEnv.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function api(pathname, options = {}, expected = [200]) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  const payload = await response.json().catch(() => ({}))
  assert.ok(expected.includes(response.status), `${options.method || 'GET'} ${pathname} returned ${response.status}: ${payload.error || 'unexpected response'}`)
  return { response, payload }
}

const adminCredentials = firstCredential(localEnv.ADMIN_CREDENTIALS)
assert.ok(adminCredentials.username && adminCredentials.password, 'local admin credentials are required')
const adminLogin = await api('/api/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: adminCredentials.username, password: adminCredentials.password }) })
const adminHeaders = { Authorization: `Bearer ${adminLogin.payload.token}` }
assert.ok(adminLogin.payload.token)

const teacherCredentials = firstCredential(localEnv.TEACHER_CREDENTIALS)
let teacherHeaders = null
if (teacherCredentials.username && teacherCredentials.password) {
  const teacherLogin = await api('/api/teacher-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: teacherCredentials.username, password: teacherCredentials.password }) })
  teacherHeaders = { Authorization: `Bearer ${teacherLogin.payload.token}` }
}

const routeSource = fs.readFileSync(path.join(root, 'app/api/admin-curriculum/route.js'), 'utf8')
const panelSource = fs.readFileSync(path.join(root, 'components/admin/CurriculumPanel.jsx'), 'utf8')
const migrationSource = fs.readFileSync(path.join(root, 'supabase/migrations/20261026150000_admin_canonical_bulk_release.sql'), 'utf8')
assert.match(routeSource, /coursework_catalog_extras.*view.*extras/s)
assert.match(routeSource, /BULK_PREVIEW_STALE/)
assert.match(panelSource, /AbortController/)
assert.match(panelSource, /All Current Batches/)
assert.match(migrationSource, /cf_bulk_coursework_release/)

const curriculum = await api('/api/admin-curriculum', { headers: adminHeaders })
const canonical = curriculum.payload.canonicalItems || []
assert.equal(canonical.length, 47)
assert.deepEqual(curriculum.payload.canonicalSummary, {
  Python: { assignments: 11, projects: 4 },
  'Data Analytics': { assignments: 14, projects: 1 },
  SQL: { assignments: 16, projects: 1 },
})
assert.equal(new Set(canonical.map(item => item.id)).size, 47)
assert.ok(canonical.every(item => item.catalog_status === 'canonical' && Number.isInteger(Number(item.sort_order))))
assert.equal((curriculum.payload.extras || []).length, 0, 'normal canonical response must not load Extras')
assert.equal(curriculum.payload.extrasLoaded, false)

const pythonAssignments = canonical.filter(item => item.phase === 'Python' && item.item_type === 'assignment').sort((a, b) => a.sort_order - b.sort_order)
const pythonProjects = canonical.filter(item => item.phase === 'Python' && item.item_type === 'project').sort((a, b) => a.sort_order - b.sort_order)
assert.ok(pythonAssignments.length >= 4 && pythonProjects.length >= 2)

const tag = `ADMIN-BULK-E2E-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
const syntheticBatches = [`${tag}-A`, `${tag}-B`, `${tag}-C`]
const allCreatedAssignmentIds = []
const allCreatedProgressBatches = new Set()
const allProject = canonical.find(item => item.phase === 'SQL' && item.item_type === 'project')
assert.ok(allProject)
const { data: existingAllProjectRows, error: existingProjectError } = await db.from('batch_coursework_assignments').select('id,batch').eq('coursework_item_id', allProject.id)
assert.ifError(existingProjectError)
const existingAllProjectIds = new Set((existingAllProjectRows || []).map(row => row.id))

try {
  const { error: batchError } = await db.from('batches').insert(syntheticBatches.map(name => ({ name, created_by: 'bulk-e2e', created_at: new Date().toISOString() })))
  assert.ifError(batchError)

  const selectedPreview = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', targetMode: 'selected', batchNames: syntheticBatches, releaseMode: 'select-topics', phase: 'Python', itemType: 'assignment', courseworkItemIds: pythonAssignments.slice(0, 2).map(item => item.id) }) })
  assert.equal(selectedPreview.payload.preview.batchCount, 3)
  assert.equal(selectedPreview.payload.preview.newActivations, 6)
  const selectedApply = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-activate', targetMode: 'selected', batchNames: syntheticBatches, releaseMode: 'select-topics', phase: 'Python', itemType: 'assignment', courseworkItemIds: pythonAssignments.slice(0, 2).map(item => item.id), previewToken: selectedPreview.payload.preview.previewToken }) })
  assert.equal(selectedApply.payload.result.newActivations, 6)

  const duplicatePreview = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', targetMode: 'selected', batchNames: syntheticBatches, releaseMode: 'select-topics', phase: 'Python', itemType: 'assignment', courseworkItemIds: pythonAssignments.slice(0, 2).map(item => item.id) }) })
  assert.equal(duplicatePreview.payload.preview.newActivations, 0)
  assert.equal(duplicatePreview.payload.preview.alreadyActive, 6)
  const duplicateApply = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-activate', targetMode: 'selected', batchNames: syntheticBatches, releaseMode: 'select-topics', phase: 'Python', itemType: 'assignment', courseworkItemIds: pythonAssignments.slice(0, 2).map(item => item.id), previewToken: duplicatePreview.payload.preview.previewToken }) })
  assert.equal(duplicateApply.payload.result.newActivations, 0)

  const progressPayload = { targetMode: 'selected', batchNames: syntheticBatches, releaseMode: 'covered-through', phase: 'Python', itemType: 'assignment', coveredThroughCourseworkItemId: pythonAssignments[2].id }
  const progressPreview = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', ...progressPayload }) })
  assert.equal(progressPreview.payload.preview.newActivations, 3)
  const progressApply = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-set-progress', ...progressPayload, previewToken: progressPreview.payload.preview.previewToken }) })
  assert.equal(progressApply.payload.result.newActivations, 3)
  syntheticBatches.forEach(name => allCreatedProgressBatches.add(name))

  const higherPreview = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', ...progressPayload, coveredThroughCourseworkItemId: pythonAssignments[1].id }) })
  assert.ok(higherPreview.payload.preview.batches.every(row => row.status === 'already_beyond'))

  const projectPayload = { targetMode: 'selected', batchNames: syntheticBatches, releaseMode: 'select-topics', phase: 'Python', itemType: 'project', courseworkItemIds: [pythonProjects[0].id] }
  const projectPreview = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', ...projectPayload }) })
  assert.equal(projectPreview.payload.preview.newActivations, 3)
  const projectApply = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-activate', ...projectPayload, previewToken: projectPreview.payload.preview.previewToken }) })
  assert.equal(projectApply.payload.result.newActivations, 3)

  const allPreview = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', targetMode: 'all', releaseMode: 'select-topics', phase: 'SQL', itemType: 'project', courseworkItemIds: [allProject.id] }) })
  assert.ok(allPreview.payload.preview.batchCount > 0)
  const allApply = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-activate', targetMode: 'all', releaseMode: 'select-topics', phase: 'SQL', itemType: 'project', courseworkItemIds: [allProject.id], previewToken: allPreview.payload.preview.previewToken }) })
  assert.ok(Number(allApply.payload.result.newActivations) >= 0)

  const stalePayload = { targetMode: 'selected', batchNames: syntheticBatches, releaseMode: 'select-topics', phase: 'Python', itemType: 'project', courseworkItemIds: [pythonProjects[1].id] }
  const stale = await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', ...stalePayload }) })
  await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-activate', ...stalePayload, previewToken: stale.payload.preview.previewToken }) })
  await api('/api/admin-curriculum', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-activate', ...stalePayload, previewToken: stale.payload.preview.previewToken }) }, [409])
  await api('/api/admin-curriculum', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ action: 'bulk-activate', ...projectPayload }) }, [409])
  await api('/api/admin-curriculum', { headers: {} }, [401])
  if (teacherHeaders) await api('/api/admin-curriculum', { method: 'POST', headers: { ...teacherHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-preview', targetMode: 'all', releaseMode: 'select-topics', phase: 'Python', itemType: 'project', courseworkItemIds: [pythonProjects[0].id] }) }, [401])

  const { data: createdRows, error: createdRowsError } = await db.from('batch_coursework_assignments').select('id').in('batch', syntheticBatches)
  assert.ifError(createdRowsError)
  allCreatedAssignmentIds.push(...(createdRows || []).map(row => row.id))
  console.log(JSON.stringify({ stagingProjectRef: 'bgpmsckjvutnqkryxknb', canonicalLoad: 'PASS', counts: curriculum.payload.canonicalSummary, selectedMultiBatch: 'PASS', allBatchPreview: 'PASS', allBatchApply: 'PASS', coveredThrough: 'PASS', higherProgressProtected: 'PASS', projectBulkRelease: 'PASS', duplicateSafe: 'PASS', stalePreviewRejected: 'PASS', adminOnly: 'PASS' }))
} finally {
  if (allCreatedAssignmentIds.length) await db.from('batch_coursework_assignments').delete().in('id', allCreatedAssignmentIds)
  if (allCreatedProgressBatches.size) await db.from('batch_curriculum_progress').delete().in('batch', [...allCreatedProgressBatches])
  const { data: allProjectRows } = await db.from('batch_coursework_assignments').select('id').eq('coursework_item_id', allProject.id)
  const syntheticAllProjectIds = (allProjectRows || []).map(row => row.id).filter(id => !existingAllProjectIds.has(id))
  if (syntheticAllProjectIds.length) await db.from('batch_coursework_assignments').delete().in('id', syntheticAllProjectIds)
  await db.from('batches').delete().in('name', syntheticBatches)
}
