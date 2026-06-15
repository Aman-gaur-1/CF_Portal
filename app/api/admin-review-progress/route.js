import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
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

function normalizeName(name) {
  return String(name || '').trim().toLowerCase()
}

function getPeriodStart(period, timezoneOffsetMinutes) {
  const now = new Date()
  const offsetMs = timezoneOffsetMinutes * 60 * 1000
  const localNow = new Date(now.getTime() - offsetMs)
  const localStart = new Date(localNow)
  localStart.setUTCHours(0, 0, 0, 0)
  if (period === '7d') localStart.setUTCDate(localStart.getUTCDate() - 6)
  return new Date(localStart.getTime() + offsetMs)
}

function parseTimezoneOffset(value) {
  const offset = Number(value)
  return Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0
}

function reviewedFilter(query) {
  return query.or('feedback.not.is.null,feedback_at.not.is.null')
}

async function countRows(query) {
  const { count, error } = await query
  if (error) throw error
  return count || 0
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function GET(request) {
  try {
    noStore()
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') === '7d' ? '7d' : 'today'
    const timezoneOffsetMinutes = parseTimezoneOffset(searchParams.get('timezoneOffset'))
    const start = getPeriodStart(period, timezoneOffsetMinutes).toISOString()
    const supabase = getSupabaseAdmin()

    const [
      { data: trainers, error: trainerError },
      { data: batches, error: batchError },
    ] = await Promise.all([
      supabase.from('trainers').select('name').order('created_at'),
      supabase.from('batches').select('name, created_by').order('created_at'),
    ])

    if (trainerError) throw trainerError
    if (batchError) throw batchError

    const teachers = new Map()
    for (const name of [
      ...(trainers || []).map(trainer => trainer.name),
      ...(batches || []).map(batch => batch.created_by),
    ]) {
      const key = normalizeName(name)
      if (key && !teachers.has(key)) teachers.set(key, { name: String(name).trim(), received: 0, reviewed: 0 })
    }

    const teacherByBatch = new Map()
    for (const batch of batches || []) {
      const key = normalizeName(batch.created_by)
      if (key) teacherByBatch.set(batch.name, key)
    }

    const teacherRows = [...teachers.entries()].map(([key, teacher]) => ({
      ...teacher,
      batches: [...teacherByBatch.entries()]
        .filter(([, teacherKey]) => teacherKey === key)
        .map(([batch]) => batch),
    }))

    const progress = await mapLimit(teacherRows, 6, async (teacher) => {
      if (!teacher.batches.length) {
        return { ...teacher, pending: 0, progress: 0 }
      }

      const [received, reviewed] = await Promise.all([
        countRows(
          supabase
            .from('submissions')
            .select('id', { count: 'exact', head: true })
            .in('batch', teacher.batches)
            .gte('submitted_at', start)
        ),
        countRows(
          reviewedFilter(
            supabase
              .from('submissions')
              .select('id', { count: 'exact', head: true })
              .in('batch', teacher.batches)
              .gte('feedback_at', start)
          )
        ),
      ])

      const pending = Math.max(received - reviewed, 0)
      return {
        name: teacher.name,
        received,
        reviewed,
        pending,
        progress: received ? Math.min(Math.round((reviewed / received) * 100), 100) : 0,
      }
    })

    return jsonNoStore({ success: true, period, start, teachers: progress })
  } catch (err) {
    console.error('[admin-review-progress] failed', err?.message)
    return jsonNoStore({ error: 'Could not load review progress' }, { status: 500 })
  }
}
