import { NextResponse } from 'next/server'
import { consumeLoginAttempt } from '@/lib/login-rate-limit'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  hashStudentPasswordSecure,
  normalizeStudentName,
  validateStudentRegistrationInput,
} from '@/lib/student-auth'

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

export async function POST(request) {
  try {
    const rateLimit = await consumeLoginAttempt(request, 'student-registration')
    if (!rateLimit.allowed) {
      return jsonNoStore(
        { success: false, error: 'Too many registration attempts. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      )
    }

    const input = validateStudentRegistrationInput(await request.json())
    if (input.error) return jsonNoStore({ success: false, error: input.error }, { status: 400 })

    const { name, batch, password } = input.value
    const supabase = getSupabaseAdmin()
    const { data: existing, error: existingError } = await supabase
      .from('students')
      .select('id')
      .ilike('name', normalizeStudentName(name))
      .eq('batch', batch)
      .limit(1)

    if (existingError) throw new Error(existingError.message)
    if (existing?.length) {
      return jsonNoStore({ success: false, error: 'Account already exists. Please login.' }, { status: 409 })
    }

    const { data: validBatch, error: batchError } = await supabase
      .from('batches')
      .select('name')
      .eq('name', batch)
      .limit(1)
      .maybeSingle()

    if (batchError) throw new Error(batchError.message)
    if (!validBatch) return jsonNoStore({ success: false, error: 'Select a valid batch.' }, { status: 400 })

    const { error } = await supabase.from('students').insert({
      name: normalizeStudentName(name),
      batch,
      password_hash: await hashStudentPasswordSecure(password),
      created_at: new Date().toISOString(),
    })

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return jsonNoStore({ success: false, error: 'Account already exists. Please login.' }, { status: 409 })
      }
      throw new Error(error.message)
    }

    return jsonNoStore({ success: true })
  } catch (err) {
    console.error('[student-register] failed', err?.message)
    return jsonNoStore({ success: false, error: 'Registration is unavailable. Please try again.' }, { status: 500 })
  }
}
