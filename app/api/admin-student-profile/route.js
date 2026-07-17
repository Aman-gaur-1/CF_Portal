import { NextResponse } from 'next/server'
import { getAdminFromRequest } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { hashStudentPasswordSecure, normalizeStudentName } from '@/lib/student-auth'

function jsonNoStore(body, init) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(init?.headers || {}),
    },
  })
}

export async function PATCH(request) {
  try {
    const admin = getAdminFromRequest(request)
    if (!admin) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const studentId = String(body?.studentId || '').trim()
    const name = normalizeStudentName(body?.name)
    const batch = String(body?.batch || '').trim()
    const password = String(body?.password || '').trim()

    if (!studentId) return jsonNoStore({ error: 'studentId is required' }, { status: 400 })
    if (!name) return jsonNoStore({ error: 'Student name is required.' }, { status: 400 })
    if (name.length > 120 || batch.length > 120) return jsonNoStore({ error: 'Student details are too long.' }, { status: 400 })
    if (password && password.length < 8) return jsonNoStore({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    if (password.length > 200) return jsonNoStore({ error: 'Password is too long.' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    if (batch) {
      const { data: validBatch, error: batchError } = await supabase
        .from('batches')
        .select('name')
        .eq('name', batch)
        .limit(1)
        .maybeSingle()
      if (batchError) throw new Error(batchError.message)
      if (!validBatch) return jsonNoStore({ error: 'Select a valid batch.' }, { status: 400 })
    }

    const update = { name, batch }
    if (password) update.password_hash = await hashStudentPasswordSecure(password)

    const { data, error } = await supabase
      .from('students')
      .update(update)
      .eq('id', studentId)
      .select('id,name,batch,created_at')
      .maybeSingle()

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return jsonNoStore({ error: 'A student with this name already exists in the selected batch.' }, { status: 409 })
      }
      throw new Error(error.message)
    }
    if (!data) return jsonNoStore({ error: 'Student not found.' }, { status: 404 })

    return jsonNoStore({ success: true, student: data })
  } catch (err) {
    console.error('[admin-student-profile] failed', err?.message)
    return jsonNoStore({ error: 'Could not update student profile.' }, { status: 500 })
  }
}
