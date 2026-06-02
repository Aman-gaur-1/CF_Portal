import { normalizeExtractedText } from './normalize'

const BLOCK_TAG_PATTERN = /<\/?(address|article|aside|blockquote|br|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi

export function parseHtml(raw, { ext, fileName } = {}) {
  const withoutUnsafeBlocks = String(raw || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')

  const stripped = withoutUnsafeBlocks
    .replace(BLOCK_TAG_PATTERN, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code)
      return Number.isFinite(n) ? String.fromCharCode(n) : ' '
    })

  const text = normalizeExtractedText(stripped)
  return {
    text,
    diagnostics: {
      parser: 'html',
      extension: ext || null,
      fileName: fileName || null,
      supported: true,
      characters: text.length,
      scripts_stripped: /<script\b/i.test(raw || ''),
      styles_stripped: /<style\b/i.test(raw || ''),
    },
  }
}

