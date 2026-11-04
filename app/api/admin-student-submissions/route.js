import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

export async function GET(request) {
  try {
    noStore()
    if (!getAdminFromRequest(request)) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    const studentId = String(request.nextUrl.searchParams.get('studentId') || '').trim()
    if (!studentId) return jsonNoStore({ error: 'studentId is required' }, { status: 400 })
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 50, 1), 100)
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('submissions')
      .select('id,student_id,batch,topic,submitted_at,feedback,feedback_at,ai_status,phase,submission_type,coursework_item_id')
      .eq('student_id', studentId)
      .order('submitted_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return jsonNoStore({ success: true, submissions: data || [], hasMore: (data || []).length === limit })
  } catch (error) {
    console.error('[admin-student-submissions] failed', error?.message)
    return jsonNoStore({ error: 'Could not load student submissions' }, { status: 500 })
  }
}
