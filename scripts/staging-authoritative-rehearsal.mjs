import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { CANONICAL_AUTHORITATIVE_OVERRIDES, CANONICAL_BY_KEY, normalizeCanonicalText } from '../lib/canonical-coursework.js'

const baseUrl = process.env.CF_PORTAL_REVIEW_URL || 'http://localhost:3100'
function readEnv(path) {
  const values = {}
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
}
const localEnv = readEnv('.env.local')
const stagingEnvPath = process.env.CF_PORTAL_STAGING_ENV_FILE || '../CF_Portal/.env.staging.local'
const stagingEnv = readEnv(stagingEnvPath)
assert.match(stagingEnv.NEXT_PUBLIC_SUPABASE_URL || '', /bgpmsckjvutnqkryxknb\.supabase\.co$/)
const serviceKey = stagingEnv.SUPABASE_SERVICE_KEY || stagingEnv.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey)
const db = createClient(stagingEnv.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function api(pathname, options = {}, statuses = [200]) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  const payload = await response.json().catch(() => ({}))
  assert.ok(statuses.includes(response.status), `${options.method || 'GET'} ${pathname} returned ${response.status}: ${payload.error || response.status}`)
  return { response, payload }
}

const credentials = JSON.parse(localEnv.ADMIN_CREDENTIALS || '{}')
const [username, password] = Object.entries(credentials)[0] || []
assert.ok(username && password)
const login = await api('/api/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
const adminHeaders = { Authorization: `Bearer ${login.payload.token}` }
const tag = `AUTHORITATIVE-REHEARSAL-${Date.now()}`
const batch = `${tag}-SK`
let studentId = null
let legacyIds = []
let canonicalIds = []

try {
  const { data: batchRow, error: batchError } = await db.from('batches').insert({ name: batch, created_by: 'staging-rehearsal', created_at: new Date().toISOString() }).select('id').single()
  assert.ifError(batchError)

  const roster = `Student Name,Email,Phone,External Student ID\nAuthoritative Rehearsal Student,authoritative-rehearsal@example.invalid,,${tag}-STUDENT`
  const form = new FormData()
  form.append('batch', batch)
  form.append('action', 'commit')
  form.append('file', new Blob([roster], { type: 'text/csv' }), `${tag}.csv`)
  const rosterResult = await api('/api/admin-roster', { method: 'POST', headers: adminHeaders, body: form })
  assert.equal(rosterResult.payload.summary.created, 1)
  const credential = rosterResult.payload.credentials[0]
  const { data: student, error: studentError } = await db.from('students').select('id,name').eq('login_id', credential.loginId).single()
  assert.ifError(studentError)
  studentId = student.id

  const curriculum = await api(`/api/admin-curriculum?batch=${encodeURIComponent(batch)}`, { headers: adminHeaders })
  const canonicalByKey = new Map(curriculum.payload.canonicalItems.map(item => [item.canonical_key, item]))
  const directCanonical = ['python_assignment_03', 'python_assignment_05']
  const legacyOverrides = CANONICAL_AUTHORITATIVE_OVERRIDES.filter(([, key]) => !directCanonical.includes(key))
  assert.equal(legacyOverrides.length, 18)
  const legacyRows = legacyOverrides.map(([alias, key], index) => {
    const canonical = CANONICAL_BY_KEY[key]
    return {
      item_type: canonical.itemType,
      title: alias,
      original_title: alias,
      phase: canonical.phase,
      batch: null,
      active: true,
      catalog_status: 'legacy',
      sort_order: null,
      created_at: new Date(Date.now() - (legacyOverrides.length - index) * 1000).toISOString(),
    }
  })
  const { data: legacyRowsInserted, error: legacyInsertError } = await db.from('coursework_items').insert(legacyRows).select('id,title,phase,item_type')
  assert.ifError(legacyInsertError)
  legacyIds = legacyRowsInserted.map(row => row.id)
  const directIds = directCanonical.map(key => canonicalByKey.get(key).id)
  canonicalIds = [...directIds]
  const aliasRows = await db.from('coursework_aliases').select('id,normalized_alias,original_alias,canonical_coursework_item_id').eq('source', 'manual_authoritative')
  assert.ifError(aliasRows.error)
  for (const [alias] of legacyOverrides) {
    const normalizedResult = await db.rpc('normalize_coursework_alias', { value: alias })
    assert.ifError(normalizedResult.error)
    const aliasRow = aliasRows.data.find(row => row.normalized_alias === normalizedResult.data)
    assert.ok(aliasRow, `missing authoritative alias: ${alias}`)
    const legacyId = legacyRowsInserted.find(row => row.title === alias)?.id
    assert.ok(legacyId, `missing inserted legacy item: ${alias}`)
    const { error: mapError } = await db.from('coursework_items').update({
      canonical_coursework_item_id: aliasRow.canonical_coursework_item_id,
      catalog_status: 'legacy',
      updated_at: new Date().toISOString(),
    }).eq('id', legacyId)
    assert.ifError(mapError)
  }

  const { data: mappedItems, error: mappedError } = await db.from('coursework_items').select('id,canonical_coursework_item_id').in('id', legacyIds)
  assert.ifError(mappedError)
  assert.equal(mappedItems.filter(item => item.canonical_coursework_item_id).length, 18)
  canonicalIds.push(...mappedItems.map(item => item.canonical_coursework_item_id))
  canonicalIds = [...new Set(canonicalIds)]
  assert.equal(canonicalIds.length, 20)

  const activationRows = [
    ...directIds.map(coursework_item_id => ({ batch, coursework_item_id, activated_at: new Date().toISOString(), activated_by_role: 'admin', activated_by_name: 'staging-rehearsal', active: true })),
    ...legacyIds.map(coursework_item_id => ({ batch, coursework_item_id, activated_at: new Date().toISOString(), activated_by_role: 'admin', activated_by_name: 'staging-rehearsal', active: true })),
  ]
  const { error: activationError } = await db.from('batch_coursework_assignments').insert(activationRows)
  assert.ifError(activationError)
  const { data: historical, error: historicalError } = await db.from('submissions').insert({
    student_id: studentId, student_name: student.name, batch, topic: 'Loop assigment', submission_type: 'assignment', phase: 'Python',
    coursework_item_id: legacyIds.find((id, index) => legacyRowsInserted[index].title === 'Loop assigment'), submitted_at: '2026-09-15T10:00:00+05:30',
    workflow_status: 'submitted', ai_workflow_state: 'pending', phase_detection_warning: false,
  }).select('id').single()
  assert.ifError(historicalError)
  const loopItem = mappedItems.find(item => item.id === legacyIds.find((id, index) => legacyRowsInserted[index].title === 'Loop assigment'))
  const { error: reconciliationError } = await db.from('student_coursework_reconciliations').insert({
    student_id: studentId, batch, coursework_item_id: loopItem.canonical_coursework_item_id, source_submission_id: String(historical.id), source_topic: 'Loop assigment',
    phase: 'Python', item_type: 'assignment', confidence: 'high_confidence', status: 'confirmed', counts_for_progress: true, counts_for_points: false,
    confirmed_by: 'staging-authoritative-rehearsal', confirmed_at: new Date().toISOString(),
  })
  assert.ifError(reconciliationError)

  const { data: activeLegacy, error: activeLegacyError } = await db.from('batch_coursework_assignments').select('id,coursework_item_id').eq('batch', batch).eq('active', true).in('coursework_item_id', legacyIds)
  assert.ifError(activeLegacyError)
  assert.equal(activeLegacy.length, 18)
  for (const row of activeLegacy) {
    const source = mappedItems.find(item => item.id === row.coursework_item_id)
    const { error: canonicalActivationError } = await db.from('batch_coursework_assignments').upsert({ batch, coursework_item_id: source.canonical_coursework_item_id, activated_at: new Date().toISOString(), activated_by_role: 'admin', activated_by_name: 'staging-rehearsal', active: true }, { onConflict: 'batch,coursework_item_id' })
    assert.ifError(canonicalActivationError)
    const { error: pauseError } = await db.from('batch_coursework_assignments').update({ active: false, updated_at: new Date().toISOString() }).eq('id', row.id)
    assert.ifError(pauseError)
  }

  const studentLogin = await api('/api/student-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: credential.loginId, password: credential.temporaryPassword }) })
  const studentCoursework = await api('/api/student-coursework', { headers: { Authorization: `Bearer ${studentLogin.payload.student.token}` } })
  const visible = studentCoursework.payload.coursework
  assert.equal(visible.length, 20)
  assert.equal(new Set(visible.map(item => item.id)).size, 20)
  assert.ok(visible.every(item => item.catalog_status === 'canonical'))
  assert.ok(visible.every(item => !item.sourceCourseworkItemId))
  assert.deepEqual([...new Set(visible.map(item => item.phase))].sort(), ['Python', 'SQL'])
  assert.ok(!visible.some(item => item.phase === 'Data Analytics'))
  assert.equal(visible.find(item => item.title === 'Loops Assignments').status, 'completed')
  const health = await api('/api/student-health', { headers: { Authorization: `Bearer ${studentLogin.payload.student.token}` } })
  const metrics = health.payload.healthCard?.metrics || health.payload.metrics || {}
  assert.equal(Number(metrics.assignmentPoints), 0)
  assert.equal(Number(metrics.projectPoints), 0)

  const { data: remaining, error: remainingError } = await db.from('batch_coursework_assignments').select('coursework_item_id').eq('batch', batch).eq('active', true)
  assert.ifError(remainingError)
  assert.equal(remaining.length, 20)
  assert.equal(new Set(remaining.map(row => row.coursework_item_id)).size, 20)
  console.log(JSON.stringify({ stagingProjectRef: 'bgpmsckjvutnqkryxknb', legacyActiveBefore: 18, directCanonicalBefore: 2, canonicalActiveAfter: 20, legacyActiveAfter: 0, duplicateExpectations: 0, studentCanonicalTitlesOnly: true, preOctPoints: 0 }, null, 2))
} finally {
  if (studentId) {
    await db.from('student_coursework_reconciliations').delete().eq('student_id', studentId).eq('batch', batch)
    await db.from('submissions').delete().eq('student_id', studentId).eq('batch', batch)
    await db.from('student_batch_memberships').delete().eq('student_id', studentId).eq('batch', batch)
    await db.from('students').delete().eq('id', studentId)
  }
  await db.from('batch_coursework_assignments').delete().eq('batch', batch)
  if (legacyIds.length) await db.from('coursework_items').delete().in('id', legacyIds)
  await db.from('student_roster_imports').delete().eq('batch', batch)
  await db.from('batches').delete().eq('name', batch)
}
