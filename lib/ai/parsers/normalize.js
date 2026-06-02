import { MAX_SUBMISSION_CHARS } from '../constants'

export function normalizeExtractedText(text, { maxChars = MAX_SUBMISSION_CHARS } = {}) {
  if (!text || typeof text !== 'string') return ''

  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}\n\n[truncated for evaluation]`
}

export function joinSections(sections) {
  return sections
    .map(section => String(section || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

export function toSourceString(source) {
  if (Array.isArray(source)) return source.join('')
  if (typeof source === 'string') return source
  return ''
}

