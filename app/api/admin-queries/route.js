import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import {
  isStudentQueryEnabled,
  normalizeQueryStatus,
  QUERY_STATUS,
  serializeAssignmentQueries,
} from '@/lib/assignment-queries'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function GET(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const enabled = await isStudentQueryEnabled({ supabase })
    const statusParam = request.nextUrl.searchParams.get('status')
    if (!enabled) {
      return jsonNoStore({ enabled: false, queries: [], counts: { total: 0, open: 0, resolved: 0 } })
    }

    let query = supabase
      .from('assignment_queries')
      .select(`
        *,
        submissions:submission_id (
          id,
          student_name,
          batch,
          topic,
          phase,
          feedback,
          submitted_at,
          ai_feedback_at,
          feedback_at,
          feedback_by
        )
      `)
      .order('created_at', { ascending: false })
      .limit(500)

    if (statusParam && statusParam !== 'all') query = query.eq('status', normalizeQueryStatus(statusParam))

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const batchNames = [...new Set((data || []).map(row => row.submissions?.batch).filter(Boolean))]
    let trainerByBatch = new Map()
    if (batchNames.length) {
      const { data: batches, error: batchError } = await supabase
        .from('batches')
        .select('name, created_by')
        .in('name', batchNames)
      if (batchError) throw new Error(batchError.message)
      trainerByBatch = new Map((batches || []).map(batch => [batch.name, batch.created_by || '']))
    }

    const studentIds = [...new Set((data || []).map(row => row.student_id).filter(Boolean))]
    let studentById = new Map()
    if (studentIds.length) {
      const { data: students, error: studentError } = await supabase
        .from('students')
        .select('*')
        .in('id', studentIds)
      if (studentError) throw new Error(studentError.message)
      studentById = new Map((students || []).map(student => [student.id, student]))
    }

    const rows = (data || []).map(row => ({
      ...row,
      student: studentById.get(row.student_id) || null,
      submissions: row.submissions ? {
        ...row.submissions,
        trainer_name: trainerByBatch.get(row.submissions.batch) || '',
      } : row.submissions,
    }))

    const queries = serializeAssignmentQueries(rows)
    const counts = {
      total: queries.length,
      open: queries.filter(item => item.status === QUERY_STATUS.OPEN).length,
      resolved: queries.filter(item => item.status === QUERY_STATUS.RESOLVED).length,
    }

    return jsonNoStore({ enabled, queries, counts })
  } catch (err) {
    console.error('[admin-queries] list failed', err?.message)
    return jsonNoStore({ error: 'Could not load student queries' }, { status: 500 })
  }
}
