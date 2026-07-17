import { ASSIGNMENTS_BUCKET } from '@/lib/assignment-storage'

const SIGNED_URL_EXPIRES_SECONDS = 60 * 60

export async function withSignedAssignmentUrls(rows, { supabase, expiresIn = SIGNED_URL_EXPIRES_SECONDS } = {}) {
  const list = Array.isArray(rows) ? rows : []
  return Promise.all(list.map(row => withSignedAssignmentUrl(row, { supabase, expiresIn })))
}

export async function withSignedAssignmentUrl(row, { supabase, expiresIn = SIGNED_URL_EXPIRES_SECONDS } = {}) {
  if (!row || !row.file_name || !supabase) return row

  const { data, error } = await supabase.storage
    .from(ASSIGNMENTS_BUCKET)
    .createSignedUrl(row.file_name, expiresIn)

  if (error) {
    console.warn('[assignment-file-access] signed url failed', {
      submissionId: row.id || null,
      fileName: row.file_name,
      error: error.message,
    })
    return { ...row, file_url: null }
  }

  return { ...row, file_url: data?.signedUrl || null }
}
