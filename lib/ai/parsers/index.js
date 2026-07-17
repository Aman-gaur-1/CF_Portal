import { MAX_EXTRACTED_FILE_CHARS, MAX_SUBMISSION_CHARS } from '../constants'
import { parseCsv } from './csv'
import { parseDocx } from './docx'
import { parseHtml } from './html'
import { parseJsonFile } from './json'
import { decodeBinaryToText, normalizeExtractedText } from './normalize'
import { parseNotebook } from './notebook'
import { parsePdf } from './pdf'
import { CODE_TEXT_EXTENSIONS, parseTextLike } from './text'

export function extensionFromPath(pathOrName) {
  if (!pathOrName) return ''
  const base = String(pathOrName).split('?')[0].split('/').pop() || ''
  const idx = base.lastIndexOf('.')
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : ''
}

export function parsePastedCode(raw) {
  const text = normalizeExtractedText(raw, { maxChars: MAX_SUBMISSION_CHARS })
  return {
    text,
    diagnostics: {
      parser: 'pasted-code',
      source: 'code_text',
      supported: true,
      characters: text.length,
    },
  }
}

export async function parseUploadedAssignment(raw, { fileName } = {}) {
  const ext = extensionFromPath(fileName)
  const parser = getParser(ext)
  const parserInput = ext === 'pdf' || ext === 'docx' ? raw : decodeBinaryToText(raw)
  const result = await parser(parserInput, { ext, fileName })
  const text = normalizeExtractedText(result.text, { maxChars: MAX_EXTRACTED_FILE_CHARS })
  const truncated = Boolean(result.text && text.length < result.text.trim().length)

  return {
    text,
    diagnostics: {
      ...result.diagnostics,
      extension: ext || null,
      fileName: fileName || null,
      truncated,
    },
  }
}

function getParser(ext) {
  if (ext === 'pdf') return parsePdf
  if (ext === 'docx') return parseDocx
  if (ext === 'ipynb') return parseNotebook
  if (ext === 'html' || ext === 'htm') return parseHtml
  if (ext === 'json') return parseJsonFile
  if (ext === 'csv') return parseCsv
  if (CODE_TEXT_EXTENSIONS.has(ext) || !ext) return parseTextLike
  return parseUnsupported
}

function parseUnsupported(raw, { ext, fileName } = {}) {
  const text = '[The uploaded work is not clearly visible enough to review in detail.]'
  return {
    text,
    diagnostics: {
      parser: 'unsupported',
      extension: ext || null,
      fileName: fileName || null,
      supported: false,
      raw_bytes_read_as_text: typeof raw === 'string' ? raw.length : 0,
    },
  }
}

export function logParserDiagnostics(diagnostics) {
  console.info('[assignment-parser] extracted submission text', sanitizeDiagnostics(diagnostics))
}

function sanitizeDiagnostics(diagnostics) {
  const clean = { ...(diagnostics || {}) }
  if (clean.fileName) clean.fileName = String(clean.fileName).slice(0, 160)
  if (clean.parse_error) clean.parse_error = String(clean.parse_error).slice(0, 240)
  if (clean.header_preview) clean.header_preview = String(clean.header_preview).slice(0, 160)
  return clean
}
