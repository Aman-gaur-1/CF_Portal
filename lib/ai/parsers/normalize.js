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

export function decodeBinaryToText(raw) {
  if (typeof raw === 'string') return raw

  try {
    if (raw instanceof ArrayBuffer) {
      return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(raw))
    }

    if (ArrayBuffer.isView(raw)) {
      return new TextDecoder('utf-8', { fatal: false }).decode(raw)
    }
  } catch {
    return ''
  }

  return ''
}

export function toUint8Array(raw) {
  if (!raw) return new Uint8Array()
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  if (typeof raw === 'string') return new TextEncoder().encode(raw)
  return new Uint8Array()
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
