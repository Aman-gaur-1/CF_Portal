export async function hashPassword(password: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(password.trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export function sanitizeFilename(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, '_')
  return cleaned.replace(/[^\w\-.]/g, '') || 'unknown'
}

export function formatDate(iso: string): string {
  return iso?.slice(0, 10) ?? '—'
}

export const MAX_FILE_MB = 10
export const BROWSER_RENDERABLE = new Set(['pdf', 'html', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'txt', 'py'])

export const TYPE_OPTIONS = ['assignment', 'project'] as const
export const PHASE_OPTIONS = ['Python', 'Data Analytics'] as const
