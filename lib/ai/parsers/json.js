import { normalizeExtractedText } from './normalize'

export function parseJsonFile(raw, { ext, fileName } = {}) {
  let parsed = null
  let validJson = false
  let parseError = null

  try {
    parsed = JSON.parse(String(raw || ''))
    validJson = true
  } catch (err) {
    parseError = err?.message || 'Invalid JSON'
  }

  const rendered = validJson ? JSON.stringify(parsed, null, 2) : String(raw || '')
  const text = normalizeExtractedText(rendered)

  return {
    text,
    diagnostics: {
      parser: 'json',
      extension: ext || null,
      fileName: fileName || null,
      supported: true,
      valid_json: validJson,
      parse_error: parseError,
      characters: text.length,
    },
  }
}

