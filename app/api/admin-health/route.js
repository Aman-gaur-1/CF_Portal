import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { isMissingHealthCardSchema } from '@/lib/student-health-card'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', ...(init?.headers || {}) },
  })
}

export async function GET(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const [rulesResult, itemsResult, calendarResult, workingCalendarResult, pendingResult, approvedResult, needsMatchingResult] = await Promise.all([
      supabase.from('point_rules').select('id,activity_type,points,effective_from,effective_to,active').order('activity_type').order('effective_from', { ascending: false }),
      supabase.from('coursework_items').select('id,item_type,title,phase,batch,due_at,active,updated_at').order('active', { ascending: false }).order('updated_at', { ascending: false }).limit(500),
      supabase.from('batch_calendar_days').select('id', { count: 'exact', head: true }),
      supabase.from('batch_calendar_days').select('id', { count: 'exact', head: true }).eq('is_working_day', true),
      supabase.from('student_attendance').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('student_attendance').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('unlinked_attendance').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
    ])

    const error = rulesResult.error || itemsResult.error || calendarResult.error || workingCalendarResult.error || pendingResult.error || approvedResult.error || needsMatchingResult.error
    if (error) {
      if (isMissingHealthCardSchema(error)) return jsonNoStore({ error: 'Student Health Card is not configured yet.' }, { status: 503 })
      throw error
    }

    return jsonNoStore({
      success: true,
      epochStart: '2026-10-01',
      timezone: 'Asia/Kolkata',
      pointRules: rulesResult.data || [],
      courseworkItems: itemsResult.data || [],
      counts: {
        courseworkItems: itemsResult.data?.length || 0,
        activeCourseworkItems: itemsResult.data?.filter(item => item.active).length || 0,
        activeAssignments: itemsResult.data?.filter(item => item.active && item.item_type === 'assignment').length || 0,
        activeProjects: itemsResult.data?.filter(item => item.active && item.item_type === 'project').length || 0,
        calendarDays: calendarResult.count || 0,
        workingCalendarDays: workingCalendarResult.count || 0,
        pendingAttendance: pendingResult.count || 0,
        approvedAttendance: approvedResult.count || 0,
        needsMatching: needsMatchingResult.count || 0,
        activePointRules: (rulesResult.data || []).filter(rule => rule.active).length,
      },
    })
  } catch (error) {
    console.error('[admin-health] load failed', error?.message)
    return jsonNoStore({ error: 'Could not load Health Card configuration.' }, { status: 500 })
  }
}

