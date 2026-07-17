import { getSupabaseAdmin } from '@/lib/supabase-server'
import { getString, setSetting } from '@/lib/system-settings'

export const DEFAULT_PHASE_SETTING_KEY = 'DEFAULT_PHASE'

export function slugifyPhaseName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function sanitizePhasePayload(input = {}) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ')
  const slug = slugifyPhaseName(input.slug || name)
  if (!name) throw new Error('Phase name is required')
  if (!slug) throw new Error('Phase slug is required')

  return {
    name,
    slug,
    description: String(input.description || '').trim(),
    color: String(input.color || '').trim(),
    icon: String(input.icon || '').trim(),
    display_order: Number.isFinite(Number(input.display_order)) ? Number.parseInt(input.display_order, 10) : 0,
    is_active: input.is_active !== false,
  }
}

export async function listAssignmentPhases({ includeInactive = false, supabase = getSupabaseAdmin() } = {}) {
  let query = supabase
    .from('assignment_phases')
    .select('id, name, slug, description, color, icon, display_order, is_active, created_at, updated_at')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

export async function resolveDefaultPhase({ supabase = getSupabaseAdmin() } = {}) {
  const phases = await listAssignmentPhases({ includeInactive: false, supabase })
  const configured = await getString(DEFAULT_PHASE_SETTING_KEY, '', { supabase })
  const configuredPhase = phases.find(phase => phase.slug === configured || phase.name === configured)
  return configuredPhase || phases[0] || null
}

export async function getDefaultPhaseName(options = {}) {
  const phase = await resolveDefaultPhase(options)
  return phase?.name || ''
}

export async function setDefaultPhase(phaseSlug, { supabase = getSupabaseAdmin() } = {}) {
  const slug = String(phaseSlug || '').trim()
  if (!slug) throw new Error('Default phase is required')

  const phases = await listAssignmentPhases({ includeInactive: false, supabase })
  const phase = phases.find(row => row.slug === slug)
  if (!phase) throw new Error('Default phase must be active')

  await setSetting(DEFAULT_PHASE_SETTING_KEY, phase.slug, 'Default assignment phase slug used for new submissions.', { supabase })
  return phase
}

export async function createAssignmentPhase(input, { supabase = getSupabaseAdmin() } = {}) {
  const payload = sanitizePhasePayload(input)
  const { data, error } = await supabase
    .from('assignment_phases')
    .insert(payload)
    .select('id, name, slug, description, color, icon, display_order, is_active, created_at, updated_at')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function updateAssignmentPhase(id, input, { supabase = getSupabaseAdmin() } = {}) {
  const phaseId = String(id || '').trim()
  if (!phaseId) throw new Error('Phase id is required')

  const payload = sanitizePhasePayload(input)
  const { data, error } = await supabase
    .from('assignment_phases')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', phaseId)
    .select('id, name, slug, description, color, icon, display_order, is_active, created_at, updated_at')
    .single()

  if (error) throw new Error(error.message)
  return data
}
