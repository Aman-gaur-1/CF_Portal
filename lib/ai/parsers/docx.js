import zlib from 'zlib'
import { joinSections, normalizeExtractedText, toUint8Array } from './normalize'

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const MAX_EOCD_SEARCH = 65557

const DOCX_TEXT_PARTS = [
  'word/document.xml',
  'word/footnotes.xml',
  'word/endnotes.xml',
  'word/comments.xml',
]

export async function parseDocx(raw, { ext, fileName } = {}) {
  const bytes = toUint8Array(raw)
  const diagnostics = {
    parser: 'docx',
    extension: ext || 'docx',
    fileName: fileName || null,
    supported: true,
    bytes: bytes.byteLength,
    parts_read: [],
    characters: 0,
  }

  if (!bytes.byteLength) {
    diagnostics.supported = false
    diagnostics.parse_error = 'Empty DOCX bytes'
    return { text: '', diagnostics }
  }

  try {
    const entries = readZipEntries(bytes)
    const sections = []

    for (const partName of DOCX_TEXT_PARTS) {
      const entry = entries.get(partName)
      if (!entry) continue
      const xml = inflateZipEntry(bytes, entry)
      const text = extractWordXmlText(xml)
      if (text) {
        diagnostics.parts_read.push(partName)
        sections.push(text)
      }
    }

    const text = normalizeExtractedText(joinSections(sections))
    diagnostics.characters = text.length
    return { text, diagnostics }
  } catch (err) {
    diagnostics.supported = false
    diagnostics.parse_error = err?.message || 'DOCX text extraction failed'
    return { text: '', diagnostics }
  }
}

function readZipEntries(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries = new Map()

  let offset = centralDirectoryOffset
  const end = centralDirectoryOffset + centralDirectorySize

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid DOCX ZIP central directory.')
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const name = buffer.toString('utf8', nameStart, nameStart + fileNameLength)

    entries.set(name.replace(/\\/g, '/'), {
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })

    offset = nameStart + fileNameLength + extraLength + commentLength
  }

  return entries
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - MAX_EOCD_SEARCH)
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }
  throw new Error('DOCX ZIP directory was not found.')
}

function inflateZipEntry(bytes, entry) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = entry.localHeaderOffset

  if (buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error('Invalid DOCX ZIP local file header.')
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + fileNameLength + extraLength
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize)

  if (entry.compressionMethod === 0) return compressed.toString('utf8')
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed).toString('utf8')
  throw new Error(`Unsupported DOCX ZIP compression method ${entry.compressionMethod}.`)
}

function extractWordXmlText(xml) {
  return String(xml || '')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}
