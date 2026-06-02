import { normalizeExtractedText } from './normalize'

export function parseCsv(raw, { ext, fileName } = {}) {
  const normalized = normalizeExtractedText(raw)
  const rows = normalized ? normalized.split('\n') : []
  const delimiter = detectDelimiter(rows.slice(0, 10))
  const header = rows[0] || ''

  return {
    text: normalized,
    diagnostics: {
      parser: 'csv',
      extension: ext || null,
      fileName: fileName || null,
      supported: true,
      rows: rows.length,
      delimiter,
      header_preview: header.slice(0, 160),
      characters: normalized.length,
    },
  }
}

function detectDelimiter(rows) {
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestScore = -1

  for (const delimiter of candidates) {
    const score = rows.reduce((sum, row) => sum + countDelimiter(row, delimiter), 0)
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }

  return best === '\t' ? 'tab' : best
}

function countDelimiter(row, delimiter) {
  let count = 0
  let quoted = false

  for (let i = 0; i < row.length; i++) {
    const char = row[i]
    if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === delimiter) {
      count++
    }
  }

  return count
}

