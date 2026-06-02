import { mdUrlToPageUrl } from './gitbook-fetch.js'
import { MIN_CHUNK_CONTENT_LENGTH } from './constants.js'

const INDEX_LINK_REGEX = /-\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+\.md[^\s)]*)\)/gi
const AGENT_INSTRUCTIONS_REGEX = /\n---\s*\n+# Agent Instructions[\s\S]*$/i

/**
 * Parse the Python Documents index markdown into ordered topic links.
 */
export function parseIndexMarkdown(indexMarkdown) {
  const topics = []
  const seen = new Set()
  let sortOrder = 0

  let match
  const re = new RegExp(INDEX_LINK_REGEX.source, INDEX_LINK_REGEX.flags)
  while ((match = re.exec(indexMarkdown)) !== null) {
    const label = match[1].trim()
    const mdUrl = match[2].trim()

    if (seen.has(mdUrl)) continue
    seen.add(mdUrl)

    topics.push({
      label,
      mdUrl,
      pageUrl: mdUrlToPageUrl(mdUrl),
      topic: normalizeTopicLabel(label),
      sortOrder: sortOrder++,
    })
  }

  return topics
}

/**
 * Strip leading enumeration ("1.", "2.") from GitBook topic titles.
 */
export function normalizeTopicLabel(label) {
  return String(label || '')
    .replace(/^\d+\.\s*/, '')
    .trim()
}

export function slugifyHeading(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Remove GitBook agent-instruction footer blocks.
 */
export function stripGitBookBoilerplate(markdown) {
  return String(markdown || '')
    .replace(AGENT_INSTRUCTIONS_REGEX, '')
    .trim()
}

/**
 * Light cleanup: normalize excessive blank lines, trim notebook "In [n]:" lines spacing.
 */
export function cleanMarkdownBody(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Split a topic page into section chunks by ## headings (### stay within parent section).
 */
export function splitPageIntoSections(markdown, pageTitle) {
  const cleaned = cleanMarkdownBody(stripGitBookBoilerplate(markdown))
  if (!cleaned) return []

  const h1Match = cleaned.match(/^#\s+(.+)$/m)
  const documentTitle = h1Match?.[1]?.trim() || pageTitle
  const bodyAfterH1 = cleaned.replace(/^#\s+.+\n?/, '').trim()

  if (!bodyAfterH1) {
    return [
      {
        title: documentTitle,
        content: documentTitle,
      },
    ]
  }

  const sectionParts = bodyAfterH1.split(/^##\s+/m)
  const sections = []

  if (sectionParts.length === 1) {
    const content = sectionParts[0].trim()
    if (content.length >= MIN_CHUNK_CONTENT_LENGTH) {
      sections.push({
        title: documentTitle,
        content: prependContext(documentTitle, content),
      })
    }
    return sections
  }

  const intro = sectionParts[0].trim()
  if (intro.length >= MIN_CHUNK_CONTENT_LENGTH) {
    sections.push({
      title: `${documentTitle} — Overview`,
      content: prependContext(documentTitle, intro),
    })
  }

  for (let i = 1; i < sectionParts.length; i++) {
    const block = sectionParts[i].trim()
    if (!block) continue

    const newline = block.indexOf('\n')
    const heading = newline === -1 ? block : block.slice(0, newline).trim()
    const content = newline === -1 ? heading : block.slice(newline + 1).trim()

    if (content.length < MIN_CHUNK_CONTENT_LENGTH) continue

    sections.push({
      title: heading,
      content: prependContext(documentTitle, content, heading),
    })
  }

  return sections
}

function prependContext(documentTitle, content, sectionTitle) {
  const header = sectionTitle
    ? `Document: ${documentTitle}\nSection: ${sectionTitle}\n\n`
    : `Document: ${documentTitle}\n\n`
  return `${header}${content}`.trim()
}

/**
 * Build chunk records ready for Supabase upsert.
 */
export function buildChunkRecords({
  topicEntry,
  sections,
  phase,
  updatedBy,
}) {
  const { pageUrl, topic, sortOrder: topicOrder } = topicEntry
  const keywords = topicToKeywords(topic)

  return sections.map((section, sectionIndex) => {
    const sectionSlug = slugifyHeading(section.title)
    const sourceUrl =
      sections.length === 1 && section.title === topicEntry.label
        ? pageUrl
        : `${pageUrl}#${sectionSlug}`

    return {
      phase,
      topic,
      title: section.title,
      content: section.content,
      keywords,
      sort_order: topicOrder * 100 + sectionIndex,
      source_url: sourceUrl,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    }
  })
}

function topicToKeywords(topic) {
  if (!topic) return []
  return topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2)
    .slice(0, 12)
}
