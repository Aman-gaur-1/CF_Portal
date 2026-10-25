import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getTeacherFromRequest } from '@/lib/teacher-auth'
import { getTeacherScope } from '@/lib/teacher-scope'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) } })
}

export async function GET(request) {
  try {
    const supabase = getSupabaseAdmin()
    const admin = getAdminFromRequest(request)
    const teacher = getTeacherFromRequest(request)
    if (!admin && !teacher) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const params = request.nextUrl.searchParams
    const batch = String(params.get('batch') || '').trim()
    const search = String(params.get('search') || '').trim()
    if (!batch) return jsonNoStore({ error: 'Batch is required.' }, { status: 400 })

    if (teacher) {
      const scope = await getTeacherScope(supabase, teacher.name)
      if (!scope.batchNames.includes(batch)) return jsonNoStore({ error: 'Batch is outside this teacher scope.' }, { status: 403 })
    }

    let query = supabase.from('students').select('id,name,batch').eq('batch', batch).eq('status', 'active').order('name').limit(100)
    if (search) query = query.ilike('name', `%${search.replace(/[%_]/g, '')}%`)
    const { data, error } = await query
    if (error) throw error
    return jsonNoStore({ success: true, students: data || [] })
  } catch (error) {
    console.error('[attendance-students] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load students for attendance resolution.' }, { status: 500 })
  }
}
