import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getAutoApprovalConfig, setAutoApprovalConfig } from '@/lib/auto-approval'
import { listAssignmentPhases, resolveDefaultPhase, setDefaultPhase } from '@/lib/assignment-phases'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  executeBulkAiApproval,
  fetchBulkApprovalCandidates,
  previewBulkAiApproval,
} from '@/lib/ai/bulk-approval'

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

function unauthorized() {
  return jsonNoStore({ error: 'Admin authorization required' }, { status: 401 })
}

export async function GET(request) {
  try {
    if (!getAdminFromRequest(request)) return unauthorized()
    const supabase = getSupabaseAdmin()
    const [autoApproval, phases, defaultPhase] = await Promise.all([
      getAutoApprovalConfig({ supabase }),
      listAssignmentPhases({ includeInactive: false, supabase }),
      resolveDefaultPhase({ supabase }),
    ])
    return jsonNoStore({ autoApproval, phases, defaultPhase })
  } catch (err) {
    console.error('[admin-workflow-settings] load failed', err?.message)
    return jsonNoStore({ error: 'Could not load workflow settings' }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    if (!getAdminFromRequest(request)) return unauthorized()
    const body = await request.json().catch(() => ({}))
    const supabase = getSupabaseAdmin()

    const autoApproval = await setAutoApprovalConfig({
      enabled: body?.autoApprovalEnabled,
      delayMinutes: body?.autoApprovalDelay,
      supabase,
    })

    let defaultPhase = await resolveDefaultPhase({ supabase })
    if (body?.defaultPhaseSlug) {
      defaultPhase = await setDefaultPhase(body.defaultPhaseSlug, { supabase })
    }

    return jsonNoStore({ autoApproval, defaultPhase })
  } catch (err) {
    console.error('[admin-workflow-settings] save failed', err?.message)
    return jsonNoStore({ error: err?.message || 'Could not save workflow settings' }, { status: 400 })
  }
}

export async function POST(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return unauthorized()
    const body = await request.json().catch(() => ({}))
    if (!['bulk_approve', 'bulk_approve_preview'].includes(body?.action)) {
      return jsonNoStore({ error: 'Unsupported workflow action' }, { status: 400 })
    }

    const phase = String(body?.phase || '').trim()
    const result = body.action === 'bulk_approve_preview'
      ? await previewAdminFeedback({ phase })
      : await bulkApproveAdminFeedback(admin.name, { phase })
    return jsonNoStore({ success: true, ...result })
  } catch (err) {
    console.error('[admin-workflow-settings] bulk approve failed', err?.message)
    return jsonNoStore({ error: 'Could not approve AI feedback' }, { status: 500 })
  }
}

async function previewAdminFeedback({ phase = '' } = {}) {
  const supabase = getSupabaseAdmin()
  const rows = await fetchBulkApprovalCandidates({ supabase, phase })
  return previewBulkAiApproval(rows)
}

async function bulkApproveAdminFeedback(adminName, { phase = '' } = {}) {
  const supabase = getSupabaseAdmin()
  const rows = await fetchBulkApprovalCandidates({ supabase, phase })
  return executeBulkAiApproval({
    supabase,
    rows,
    actorName: adminName || 'Admin',
    actorRole: 'admin',
    phase,
    audit: { userName: adminName || 'Admin' },
  })
}
