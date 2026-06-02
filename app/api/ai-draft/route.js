import { NextResponse } from 'next/server'

/**
 * Retired legacy route. Teacher draft edits use /api/teacher-ai-draft, which
 * verifies the signed teacher token and resolves current batch scope.
 */
export async function PATCH() {
  return NextResponse.json(
    { error: 'Legacy route disabled. Use /api/teacher-ai-draft.' },
    { status: 410 }
  )
}
