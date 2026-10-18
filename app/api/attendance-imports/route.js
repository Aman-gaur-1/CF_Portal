import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

async function resolveAuth(request, supabase) {
  const admin = getAdminFromRequest(request)
  if (admin) return { role: 'admin', name: admin.name, batchNames: null }
  const teacher = getTeacherFromRequest(request)
  if (!teacher) return null
  const scope = await getTeacherScope(supabase, teacher.name)
  return { role: 'teacher', name: scope.teacherName || teacher.name, batchNames: scope.batchNames }
}

export async function GET(request) {
  try {
    const supabase = getSupabaseAdmin()
    const auth = await resolveAuth(request, supabase)
    if (!auth) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
    if (auth.role === 'teacher' && !auth.batchNames.length) return jsonNoStore({ success: true, imports: [], count: 0 })

    const params = request.nextUrl.searchParams
    const batch = String(params.get('batch') || '').trim()
    const date = String(params.get('date') || '').trim()
    const search = String(params.get('search') || '').trim()
    if (auth.batchNames && batch && !auth.batchNames.includes(batch)) return jsonNoStore({ error: 'Batch is outside this teacher scope.' }, { status: 403 })

    let query = supabase
      .from('attendance_imports')
      .select('id,batch,attendance_date,session_id,source,original_filename,file_size,uploaded_by_role,uploaded_by_name,total_participants,matched_count,needs_matching_count,already_marked_count,dismissed_count,status,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (batch) query = query.eq('batch', batch)
    else if (auth.batchNames) query = query.in('batch', auth.batchNames)
    if (date) query = query.eq('attendance_date', date)
    if (search) query = query.ilike('original_filename', `%${search.replace(/[%_]/g, '')}%`)
    const { data, error } = await query
    if (error) throw error
    const sessionIds = [...new Set((data || []).map(row => row.session_id).filter(Boolean))]
    const { data: sessions, error: sessionError } = sessionIds.length
      ? await supabase.from('attendance_sessions').select('id,title,starts_at,ends_at').in('id', sessionIds)
      : { data: [], error: null }
    if (sessionError) throw sessionError
    const sessionById = new Map((sessions || []).map(session => [String(session.id), session]))
    return jsonNoStore({ success: true, imports: (data || []).map(row => ({ ...row, session: sessionById.get(String(row.session_id)) || null })), count: data?.length || 0 })
  } catch (error) {
    console.error('[attendance-imports] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load attendance import history.' }, { status: 500 })
  }
}
