import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { runNotificationMaintenance } from '@/lib/notifications'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

function authorized(request) {
  if (request.headers.get('x-vercel-cron') === '1') return true
  const secret = String(process.env.CRON_SECRET || '').trim()
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`)
}

export async function GET(request) {
  noStore()
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await runNotificationMaintenance(getSupabaseAdmin())
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[cron-notifications] failed', error?.message)
    return NextResponse.json({ success: false, error: 'Notification maintenance failed' }, { status: 500 })
  }
}
