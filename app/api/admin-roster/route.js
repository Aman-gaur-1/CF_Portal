import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { hashStudentPasswordSecure } from '@/lib/student-auth'
import { classifyRosterRows, generateLoginId, generateTemporaryPassword, hashRosterFile, loadUsedLoginIds, parseRosterBuffer } from '@/lib/roster-import'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

async function readRoster(request) {
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  const batch = String(formData?.get('batch') || '').trim()
  const action = String(formData?.get('action') || 'preview').trim().toLowerCase()
  if (!formData || !file || typeof file === 'string') return { error: 'A roster file is required.' }
  if (!batch) return { error: 'Batch is required.' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Roster file exceeds the 5 MB limit.' }
  const buffer = Buffer.from(await file.arrayBuffer())
  return { formData, file, batch, action, buffer, fileHash: hashRosterFile(buffer) }
}

async function loadExisting(supabase, batch) {
  const { data, error } = await supabase
    .from('students')
    .select('id,name,batch,email,phone,external_student_id,login_id')
    .eq('batch', batch)
    .order('name')
    .limit(5000)
  if (error) throw error
  return data || []
}

export async function GET(request) {
  const admin = getAdminFromRequest(request)
  if (!admin) return new NextResponse('Unauthorized', { status: 401 })
  return new NextResponse('Student Name,Email,Phone,External Student ID\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="consoleflare-student-roster-template.csv"',
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const upload = await readRoster(request)
    if (upload.error) return jsonNoStore({ error: upload.error }, { status: 400 })
    const supabase = getSupabaseAdmin()
    const { data: batchRow, error: batchError } = await supabase.from('batches').select('name').eq('name', upload.batch).maybeSingle()
    if (batchError) throw batchError
    if (!batchRow) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })

    const rows = parseRosterBuffer(upload.buffer, upload.file.name)
    if (!rows.length) return jsonNoStore({ error: 'No roster rows found. Student Name is required.' }, { status: 400 })
    const existing = await loadExisting(supabase, upload.batch)
    const classified = classifyRosterRows(rows, existing)
    const summary = {
      total: classified.length,
      new: classified.filter(row => row.status === 'new').length,
      existing: classified.filter(row => row.status === 'existing').length,
      possibleDuplicates: classified.filter(row => row.status === 'possible_duplicate').length,
      invalid: classified.filter(row => row.status === 'invalid').length,
    }
    if (upload.action !== 'commit') return jsonNoStore({ success: true, batch: upload.batch, summary, rows: classified })

    const usedLoginIds = await loadUsedLoginIds(supabase)
    const credentials = []
    const createdRows = []
    for (const row of classified.filter(candidate => candidate.status === 'new')) {
      const loginId = generateLoginId(row.name, usedLoginIds)
      const temporaryPassword = generateTemporaryPassword()
      const { data: student, error } = await supabase.from('students').insert({
        name: row.name.trim().replace(/\s+/g, ' '),
        batch: upload.batch,
        email: row.email || null,
        phone: row.phone || null,
        external_student_id: row.externalStudentId || null,
        login_id: loginId,
        password_hash: await hashStudentPasswordSecure(temporaryPassword),
        must_change_password: true,
      }).select('id,name,batch,login_id,must_change_password').single()
      if (error) throw error
      createdRows.push({ rowNumber: row.rowNumber, name: student.name, studentId: student.id, loginId: student.login_id, status: 'created' })
      credentials.push({ name: student.name, batch: student.batch, loginId: student.login_id, temporaryPassword })
    }

    const { error: auditError } = await supabase.from('student_roster_imports').insert({
      batch: upload.batch,
      original_filename: upload.file.name,
      file_hash: upload.fileHash,
      uploaded_by_role: 'admin',
      uploaded_by_name: admin.name,
      total_rows: classified.length,
      new_count: summary.new,
      existing_count: summary.existing,
      possible_duplicate_count: summary.possibleDuplicates,
      invalid_count: summary.invalid,
      status: 'completed',
      row_results: createdRows,
      completed_at: new Date().toISOString(),
    })
    if (auditError) throw auditError
    return jsonNoStore({ success: true, batch: upload.batch, summary: { ...summary, created: credentials.length }, createdRows, credentials })
  } catch (error) {
    console.error('[admin-roster] failed', error?.message)
    if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Roster import schema is not configured yet.' }, { status: 503 })
    return jsonNoStore({ error: 'Could not process the student roster.' }, { status: 500 })
  }
}
