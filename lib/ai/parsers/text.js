import { normalizeExtractedText } from './normalize'

export const CODE_TEXT_EXTENSIONS = new Set([
  'py',
  'txt',
  'md',
  'js',
  'ts',
  'jsx',
  'tsx',
])

export function parseTextLike(raw, { ext, fileName } = {}) {
  const text = normalizeExtractedText(raw)
  return {
    text,
    diagnostics: {
      parser: 'text',
      extension: ext || null,
      fileName: fileName || null,
      supported: true,
      characters: text.length,
    },
  }
}

