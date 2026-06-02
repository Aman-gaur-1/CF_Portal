import crypto from 'crypto'

export const ASSIGNMENTS_BUCKET = 'assignments'
export const MAX_ASSIGNMENT_FILE_BYTES = 10 * 1024 * 1024

export const ALLOWED_ASSIGNMENT_EXTENSIONS = new Set([
  'py',
  'txt',
  'md',
  'json',
  'html',
  'ipynb',
  'js',
  'ts',
  'jsx',
  'tsx',
  'csv',
  'pdf',
])

export const ALLOWED_ASSIGNMENT_MIME_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/octet-stream',
  'application/pdf',
  'application/typescript',
  'application/x-ipynb+json',
  'application/x-python-code',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/plain',
  'text/typescript',
  'text/x-python',
])

export function assignmentFileExtension(fileName) {
  const match = String(fileName || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] || ''
}

export function sanitizeOriginalFileName(fileName) {
  return String(fileName || '')
    .trim()
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 240)
}

export function validateAssignmentUpload({ fileName, fileSize, mimeType }) {
  const originalFileName = sanitizeOriginalFileName(fileName)
  const extension = assignmentFileExtension(originalFileName)
  const size = Number(fileSize)
  const type = String(mimeType || 'application/octet-stream').trim().toLowerCase()

  if (!originalFileName || !extension) return { error: 'A valid file name is required.' }
  if (!ALLOWED_ASSIGNMENT_EXTENSIONS.has(extension)) return { error: `File type .${extension} is not allowed.` }
  if (!Number.isFinite(size) || size <= 0) return { error: 'File is empty or invalid.' }
  if (size > MAX_ASSIGNMENT_FILE_BYTES) return { error: 'File size exceeds 10MB limit.' }
  if (!ALLOWED_ASSIGNMENT_MIME_TYPES.has(type)) return { error: 'File MIME type is not allowed.' }

  return { value: { extension, originalFileName, mimeType: type, fileSize: size } }
}

export function createOpaqueAssignmentFileName(extension) {
  return `submission_${crypto.randomUUID()}.${extension}`
}
