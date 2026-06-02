import { NextResponse } from 'next/server'
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

export async function GET(request) {
  try {
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
      { data: receivedSubmissions, error: receivedSubmissionError },
      { data: reviewedSubmissions, error: reviewedSubmissionError },
    ] = await Promise.all([
      supabase.from('trainers').select('name').order('created_at'),
      supabase.from('batches').select('name, created_by').order('created_at'),
      supabase.from('submissions').select('batch').gte('submitted_at', start),
      supabase.from('submissions').select('batch').not('feedback', 'is', null).gte('feedback_at', start),
    ])

    if (trainerError) throw trainerError
    if (batchError) throw batchError
    if (receivedSubmissionError) throw receivedSubmissionError
    if (reviewedSubmissionError) throw reviewedSubmissionError

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

    for (const submission of receivedSubmissions || []) {
      const teacher = teachers.get(teacherByBatch.get(submission.batch))
      if (!teacher) continue
      teacher.received += 1
    }

    for (const submission of reviewedSubmissions || []) {
      const teacher = teachers.get(teacherByBatch.get(submission.batch))
      if (!teacher) continue
      teacher.reviewed += 1
    }

    const progress = [...teachers.values()].map(teacher => {
      const pending = Math.max(teacher.received - teacher.reviewed, 0)
      return {
        ...teacher,
        pending,
        progress: teacher.received ? Math.min(Math.round((teacher.reviewed / teacher.received) * 100), 100) : 0,
      }
    })

    return jsonNoStore({ success: true, period, start, teachers: progress })
  } catch (err) {
    console.error('[admin-review-progress] failed', err?.message)
    return jsonNoStore({ error: 'Could not load review progress' }, { status: 500 })
  }
}
