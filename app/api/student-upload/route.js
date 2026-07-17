import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import {
  ASSIGNMENTS_BUCKET,
  createOpaqueAssignmentFileName,
  validateAssignmentUpload,
} from '@/lib/assignment-storage'

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
    const body = await request.json().catch(() => ({}))
    const validation = validateAssignmentUpload({
      fileName: body?.fileName,
      fileSize: body?.fileSize,
      mimeType: body?.mimeType,
    })
    if (validation.error) return jsonNoStore({ error: validation.error }, { status: 400 })

    const { extension, originalFileName, mimeType } = validation.value
    const fileName = createOpaqueAssignmentFileName(extension)
    const fileUrl = getSupabaseAdmin().storage.from(ASSIGNMENTS_BUCKET).getPublicUrl(fileName).data.publicUrl

    return jsonNoStore({
      success: true,
      upload: {
        fileName,
        fileUrl,
        mimeType,
        originalFileName,
        storageMimeType: extension === 'docx' ? 'application/octet-stream' : mimeType,
      },
    })
  } catch (err) {
    console.error('[student-upload] prepare failed', err?.message)
    return jsonNoStore({ error: 'Could not prepare assignment upload.' }, { status: 500 })
  }
}
