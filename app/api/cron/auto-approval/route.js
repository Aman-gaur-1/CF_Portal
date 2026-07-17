import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import {
  publishDueAutoApprovals,
  releaseAutoApprovalLock,
  tryAcquireAutoApprovalLock,
} from '@/lib/auto-approval'
import { getSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

function isCronAuthorized(request) {
  if (request.headers.get('x-vercel-cron') === '1') return true
  const secret = String(process.env.CRON_SECRET || '').trim()
  const authorization = request.headers.get('authorization') || ''
  return Boolean(secret && authorization === `Bearer ${secret}`)
}

function emptyResult(startedAt, locked = false) {
  return {
    success: true,
    locked,
    scanned: 0,
    published: 0,
    skipped: 0,
    failed: 0,
    execution_time_ms: Date.now() - startedAt,
  }
}

export async function GET(request) {
  noStore()
  const startedAt = Date.now()
  const lockOwner = `auto-approval-${startedAt}-${Math.random().toString(36).slice(2)}`
  if (!isCronAuthorized(request)) {
    return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  let lockAcquired = false
  try {
    lockAcquired = await tryAcquireAutoApprovalLock({ owner: lockOwner, supabase })
    if (!lockAcquired) return jsonNoStore(emptyResult(startedAt, true), { status: 202 })

    const limit = new URL(request.url).searchParams.get('limit')
    const result = await publishDueAutoApprovals({ limit, supabase })
    return jsonNoStore({
      success: true,
      ...result,
      execution_time_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[cron-auto-approval] failed', err?.message)
    return jsonNoStore({
      success: false,
      error: 'Auto approval cron failed',
      scanned: 0,
      published: 0,
      skipped: 0,
      failed: 1,
      execution_time_ms: Date.now() - startedAt,
    }, { status: 500 })
  } finally {
    if (lockAcquired) {
      await releaseAutoApprovalLock({ owner: lockOwner, supabase }).catch(err => {
        console.warn('[cron-auto-approval] lock release failed', err?.message)
      })
    }
  }
}
