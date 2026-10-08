import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function json(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function DELETE(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const batchId = String(body?.batchId || '').trim()
    if (!batchId) return json({ error: 'batchId is required' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data: batch, error: batchError } = await supabase.from('batches').select('id, name').eq('id', batchId).maybeSingle()
    if (batchError) throw batchError
    if (!batch) return json({ error: 'Batch not found.' }, { status: 404 })

    const [{ count: studentCount, error: studentError }, { count: submissionCount, error: submissionError }] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('batch', batch.name),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('batch', batch.name),
    ])
    if (studentError) throw studentError
    if (submissionError) throw submissionError

    if ((studentCount || 0) > 0 || (submissionCount || 0) > 0) {
      return json({
        error: `Cannot delete “${batch.name}”. It has ${studentCount || 0} student(s) and ${submissionCount || 0} submission(s). Reassign students first.`,
        studentCount: studentCount || 0,
        submissionCount: submissionCount || 0,
      }, { status: 409 })
    }

    const { error: deleteError } = await supabase.from('batches').delete().eq('id', batch.id)
    if (deleteError) throw deleteError
    return json({ success: true, batch: { id: batch.id, name: batch.name } })
  } catch (error) {
    console.error('[admin-batch] delete failed', error?.message)
    return json({ error: 'Could not delete batch.' }, { status: 500 })
  }
}
