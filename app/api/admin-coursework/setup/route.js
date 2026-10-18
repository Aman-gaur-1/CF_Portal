import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { appendActivity } from '@/lib/activity-log'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getIndiaDateString, isMissingHealthCardSchema } from '@/lib/student-health-card'
import { isUniqueViolation, normalizeCourseworkPayload } from '@/lib/health-card-admin'
import {
  COURSEWORK_CATALOG_EPOCH,
  buildCourseworkCatalogPreview,
  isCatalogEpochEligible,
  normalizeCatalogTitle,
  normalizeCatalogType,
  parseCourseworkCandidateKey,
  serializeCourseworkCandidate,
} from '@/lib/coursework-catalog'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 1000
const MAX_PAGES = 50

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}
async function readAll(makeQuery) {
  const rows = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const pageRows = data || []
    rows.push(...pageRows)
    if (pageRows.length < PAGE_SIZE) return rows
  }
  throw new Error('Coursework setup preview exceeded the safe read limit.')
}

async function loadSetupData(supabase) {
  const [students, submissions, courseworkItems] = await Promise.all([
    readAll(() => supabase
      .from('students')
      .select('id,batch')
      .order('id', { ascending: true })),
    readAll(() => supabase
      .from('submissions')
      .select('id,student_id,batch,topic,submission_type,submitted_at,coursework_item_id')
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: true })
      .order('id', { ascending: true })),
    readAll(() => supabase
      .from('coursework_items')
      .select('id,item_type,title,phase,batch,due_at,active,created_at,updated_at')
      .order('id', { ascending: true })),
  ])
  return { students, submissions, courseworkItems }
}

function previewResponse(preview) {
  return {
    success: true,
    dryRun: true,
    ...preview,
    candidates: preview.candidates.map(serializeCourseworkCandidate),
    mergeSuggestions: preview.mergeSuggestions || [],
  }
}

async function validateBatch(supabase, batch) {
  const { data, error } = await supabase.from('batches').select('name').eq('name', batch).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

function candidateFor(preview, key) {
  return preview.candidates.find(candidate => candidate.key === key) || null
}

function exactSubmissionRows({ submissions, students, candidate }) {
  const studentBatches = new Map((students || []).map(student => [String(student.id), String(student.batch || '')]))
  return (submissions || []).filter(row => (
    String(row.batch) === String(candidate.batch) &&
    studentBatches.get(String(row.student_id)) === String(candidate.batch) &&
    isCatalogEpochEligible(row.submitted_at, { epoch: COURSEWORK_CATALOG_EPOCH, asOfDate: getIndiaDateString() }) &&
    normalizeCatalogType(row.submission_type) === candidate.type &&
    normalizeCatalogTitle(row.topic) === candidate.normalizedTitle
  ))
}

async function findActiveMatches(supabase, candidate) {
  const { data, error } = await supabase
    .from('coursework_items')
    .select('id,item_type,title,phase,batch,due_at,active,created_at,updated_at')
    .eq('active', true)
    .in('item_type', [candidate.type])
    .limit(500)
  if (error) throw error
  return (data || []).filter(item => (
    (!item.batch || String(item.batch) === String(candidate.batch)) &&
    normalizeCatalogType(item.item_type) === candidate.type &&
    normalizeCatalogTitle(item.title) === candidate.normalizedTitle
  ))
}

async function linkCandidate({ supabase, candidate, item, students }) {
  const studentBatches = new Map((students || []).map(student => [String(student.id), String(student.batch || '')]))
  const { data: rows, error: loadError } = await supabase
    .from('submissions')
    .select('id,student_id,batch,topic,submission_type,submitted_at,coursework_item_id')
    .in('id', candidate.submissionIds)
  if (loadError) throw loadError

  const eligibleIds = (rows || [])
    .filter(row => (
      !row.coursework_item_id &&
      isCatalogEpochEligible(row.submitted_at, { epoch: COURSEWORK_CATALOG_EPOCH, asOfDate: getIndiaDateString() }) &&
      String(row.batch) === String(candidate.batch) &&
      studentBatches.get(String(row.student_id)) === String(candidate.batch) &&
      normalizeCatalogType(row.submission_type) === candidate.type &&
      normalizeCatalogTitle(row.topic) === candidate.normalizedTitle
    ))
    .map(row => row.id)

  if (!eligibleIds.length) return { linkedCount: 0 }

  const { data: linked, error } = await supabase
    .from('submissions')
    .update({ coursework_item_id: item.id })
    .in('id', eligibleIds)
    .is('coursework_item_id', null)
    .select('id')
  if (error) throw error
  return { linkedCount: linked?.length || 0 }
}

export async function GET(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const supabase = getSupabaseAdmin()
    const { students, submissions, courseworkItems } = await loadSetupData(supabase)
    const preview = buildCourseworkCatalogPreview({
      students,
      submissions,
      courseworkItems,
      epoch: COURSEWORK_CATALOG_EPOCH,
      asOfDate: getIndiaDateString(),
    })
    return jsonNoStore(previewResponse(preview))
  } catch (error) {
    console.error('[admin-coursework-setup] preview failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not build the coursework setup preview.' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const mode = String(body.mode || 'dry-run').trim().toLowerCase()
    const supabase = getSupabaseAdmin()
    const { students, submissions, courseworkItems } = await loadSetupData(supabase)
    const preview = buildCourseworkCatalogPreview({
      students,
      submissions,
      courseworkItems,
      epoch: COURSEWORK_CATALOG_EPOCH,
      asOfDate: getIndiaDateString(),
    })

    if (mode === 'dry-run') {
      const selectedKeys = new Set(Array.isArray(body.candidateKeys) ? body.candidateKeys.map(String) : [])
      const selected = preview.candidates.filter(candidate => selectedKeys.has(candidate.key) && candidate.canLink && candidate.confidence !== 'ambiguous')
      return jsonNoStore({
        ...previewResponse(preview),
        selected: {
          candidates: selected.map(serializeCourseworkCandidate),
          courseworkItemsWouldBeCreated: selected.filter(candidate => candidate.catalogStatus === 'new').length,
          submissionsWouldBeLinked: selected.reduce((sum, candidate) => sum + candidate.affectedSubmissions, 0),
        },
      })
    }

    if (mode !== 'apply') return jsonNoStore({ error: 'Mode must be dry-run or apply.' }, { status: 400 })
    if (body.confirm !== true) return jsonNoStore({ error: 'Explicit confirmation is required before creating or linking coursework.' }, { status: 400 })

    const key = String(body.candidateKey || '').trim()
    const candidate = candidateFor(preview, key)
    if (!candidate) {
      const parsed = parseCourseworkCandidateKey(key)
      const requestedTitle = String(body.title || parsed?.normalizedTitle || '').trim()
      if (parsed && normalizeCatalogTitle(requestedTitle) === parsed.normalizedTitle) {
        const candidateLike = { ...parsed, canLink: true, confidence: 'exact' }
        const activeMatches = await findActiveMatches(supabase, candidateLike)
        const matchingRows = exactSubmissionRows({ submissions, students, candidate: candidateLike })
        const alreadyLinked = activeMatches.length === 1 && matchingRows.length > 0 && matchingRows.every(row => String(row.coursework_item_id) === String(activeMatches[0].id))
        if (alreadyLinked) return jsonNoStore({ success: true, dryRun: false, created: false, idempotent: true, coursework: activeMatches[0], linkedCount: 0 })
      }
      return jsonNoStore({ error: 'Candidate is no longer available. Refresh the preview.' }, { status: 409 })
    }
    if (!candidate.canLink || candidate.confidence === 'ambiguous') return jsonNoStore({ error: 'Ambiguous candidates cannot be created or linked automatically.' }, { status: 409 })

    const requestedTitle = String(body.title || candidate.proposedTitle || '').trim()
    if (normalizeCatalogTitle(requestedTitle) !== candidate.normalizedTitle) {
      return jsonNoStore({ error: 'Edited title must preserve the normalized submission title for safe linking.' }, { status: 400 })
    }
    const normalized = normalizeCourseworkPayload({
      title: requestedTitle,
      itemType: candidate.type,
      batch: candidate.batch,
      phase: null,
      dueAt: null,
      active: true,
    })
    if (normalized.error) return jsonNoStore({ error: normalized.error }, { status: 400 })
    if (!(await validateBatch(supabase, candidate.batch))) return jsonNoStore({ error: 'The candidate batch no longer exists.' }, { status: 409 })

    let item = null
    let created = false
    const activeMatches = await findActiveMatches(supabase, candidate)
    if (activeMatches.length > 1) return jsonNoStore({ error: 'Multiple active coursework items now compete for this candidate. Refresh and review it.' }, { status: 409 })
    if (activeMatches.length === 1) {
      item = activeMatches[0]
    } else {
      const { data, error } = await supabase
        .from('coursework_items')
        .insert(normalized.value)
        .select('id,item_type,title,phase,batch,due_at,active,created_at,updated_at')
        .single()
      if (error) {
        if (isUniqueViolation(error)) return jsonNoStore({ error: 'Coursework already exists. Refresh the preview.' }, { status: 409 })
        throw error
      }
      item = data
      created = true
    }

    const { linkedCount } = await linkCandidate({ supabase, candidate, item, students })
    await appendActivity({
      eventType: created ? 'health_coursework_setup_created' : 'health_coursework_setup_linked',
      description: `${created ? 'created and linked' : 'linked'} ${item.item_type} coursework: ${item.title}`,
      actorName: admin.name,
      actorRole: 'admin',
      action: created ? 'create' : 'link',
      metadata: {
        coursework_item_id: item.id,
        batch: item.batch,
        item_type: item.item_type,
        linked_submission_count: linkedCount,
        due_at: null,
      },
      supabase,
    })

    return jsonNoStore({ success: true, dryRun: false, created, coursework: item, linkedCount })
  } catch (error) {
    console.error('[admin-coursework-setup] apply failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not apply the coursework setup action.' }, { status: 500 })
  }
}
