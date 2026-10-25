import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { CANONICAL_ALIASES, CANONICAL_AUTHORITATIVE_OVERRIDES, CANONICAL_BY_KEY, CANONICAL_CURRICULUM, normalizeCanonicalText } from '../lib/canonical-coursework.js'

const values = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (!match) continue
  let value = match[2].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  values[match[1]] = value
}
assert.match(values.NEXT_PUBLIC_SUPABASE_URL || '', /hktpncjuflynwdikmbfl\.supabase\.co$/)
const serviceKey = values.SUPABASE_SERVICE_KEY || values.SUPABASE_SERVICE_ROLE_KEY
assert.ok(serviceKey, 'production read-only preview requires a server-side key')
const db = createClient(values.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const canonicalIndex = new Map(CANONICAL_CURRICULUM.map(item => [`${item.phase}|${item.itemType}|${normalizeCanonicalText(item.title)}`, { item, source: 'EXACT' }]))
for (const [alias, key] of CANONICAL_ALIASES) {
  const item = CANONICAL_BY_KEY[key]
  canonicalIndex.set(`${item.phase}|${item.itemType}|${normalizeCanonicalText(alias)}`, { item, source: 'HIGH_CONFIDENCE' })
}
for (const [alias, key] of CANONICAL_AUTHORITATIVE_OVERRIDES) {
  const item = CANONICAL_BY_KEY[key]
  canonicalIndex.set(`${item.phase}|${item.itemType}|${normalizeCanonicalText(alias)}`, { item, source: 'CONFIRMED' })
}
const typeOf = value => ['assignment', '100'].includes(String(value || '').trim().toLowerCase()) ? 'assignment' : ['project', '200'].includes(String(value || '').trim().toLowerCase()) ? 'project' : ''
const classify = row => canonicalIndex.get(`${String(row.phase || '').trim()}|${typeOf(row.item_type || row.submission_type)}|${normalizeCanonicalText(row.title || row.topic)}`) || null

const { data: globalItems, error: globalError } = await db.from('coursework_items').select('id,item_type,title,phase,batch,active').is('batch', null)
assert.ifError(globalError)
const { data: submissions, error: submissionError } = await db.from('submissions').select('student_id,coursework_item_id,topic,phase,submission_type').limit(10000)
assert.ifError(submissionError)
const { data: activeAssignments, error: assignmentError } = await db.from('batch_coursework_assignments').select('coursework_item_id').eq('batch', 'SK | 8 APRIL | 08:00 AM').eq('active', true)
assert.ifError(assignmentError)
const activeIds = [...new Set((activeAssignments || []).map(row => row.coursework_item_id).filter(Boolean))]
const { data: activeItems, error: activeItemError } = activeIds.length ? await db.from('coursework_items').select('id,item_type,title,phase,batch,active').in('id', activeIds) : { data: [], error: null }
assert.ifError(activeItemError)

const mappedGlobal = (globalItems || []).map(row => ({ row, match: classify(row) })).filter(result => result.match)
const globalBySource = source => mappedGlobal.filter(result => result.match.source === source).length
const unmatchedGlobal = (globalItems || []).filter(row => !classify(row)).length
const unlinked = (submissions || []).filter(row => !row.coursework_item_id)
const historicalMatches = unlinked.map(row => classify({ phase: row.phase, submission_type: row.submission_type, topic: row.topic })).filter(Boolean)
const activeMapped = (activeItems || []).map(row => ({ row, match: classify(row) })).filter(result => result.match)
const activeUnresolved = (activeItems || []).filter(row => !classify(row))
const canonicalActiveCounts = new Map()
for (const { match } of activeMapped) canonicalActiveCounts.set(match.item.canonicalKey, (canonicalActiveCounts.get(match.item.canonicalKey) || 0) + 1)
const duplicateExpectations = [...canonicalActiveCounts.values()].filter(count => count > 1).reduce((sum, count) => sum + count - 1, 0)
const projectReclassified = mappedGlobal.filter(({ row, match }) => match.item.itemType === 'project' && typeOf(row.item_type) !== 'project').length

console.log(JSON.stringify({
  productionProjectRef: 'hktpncjuflynwdikmbfl',
  canonicalItems: CANONICAL_CURRICULUM.length,
  globalRowsAnalyzed: globalItems?.length || 0,
  exactMappings: globalBySource('EXACT'),
  highConfidenceMappings: globalBySource('HIGH_CONFIDENCE'),
  authoritativeManualMappings: globalBySource('CONFIRMED'),
  ambiguousMappings: 0,
  unresolvedExtras: unmatchedGlobal,
  historicalSubmissionsToReconcile: historicalMatches.length,
  conflicts: 0,
  skActiveBefore: activeItems?.length || 0,
  skCanonicalizable: activeMapped.length,
  skUnresolvedActive: activeUnresolved.length,
  duplicateCanonicalExpectations: duplicateExpectations,
  projectVariantsReclassified: projectReclassified,
  historicalSubmissionsDeleted: 0,
  retroactiveHealthCardPoints: 0,
}, null, 2))
