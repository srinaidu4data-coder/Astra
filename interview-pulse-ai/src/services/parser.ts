import { uid } from '@/lib/utils'
import type { KnowledgeDocType, ResumeDocument, StarMemory } from '@/types'

/** Max pages to parse (keeps large subject PDFs usable in-browser). */
const MAX_PDF_PAGES = 80
/** Cap extracted text so localStorage stays healthy. */
const MAX_TEXT_CHARS = 120_000

/**
 * pdf.js modern build calls Uint8Array#toHex() for document fingerprints.
 * That method is still missing in many browsers → "a.toHex is not a function".
 * Legacy build ships the polyfill; we also patch the main thread as a belt.
 */
function ensureUint8ArrayToHex(): void {
  const proto = Uint8Array.prototype as Uint8Array & {
    toHex?: () => string
  }
  if (typeof proto.toHex === 'function') return
  Object.defineProperty(proto, 'toHex', {
    value: function toHex(this: Uint8Array): string {
      let out = ''
      for (let i = 0; i < this.length; i++) {
        out += this[i]!.toString(16).padStart(2, '0')
      }
      return out
    },
    configurable: true,
    writable: true,
  })
}

/** Extract plain text from PDF using pdf.js (browser). */
export async function extractPdfText(file: File): Promise<string> {
  ensureUint8ArrayToHex()

  // Legacy build + matching worker: polyfills toHex / withResolvers for real browsers.
  // Vite ?url keeps worker version locked to the same package as the API.
  const [{ getDocument, GlobalWorkerOptions, version }, workerUrl] =
    await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url').then(
        (m) => m.default as string,
      ),
    ])

  GlobalWorkerOptions.workerSrc = workerUrl

  const data = new Uint8Array(await file.arrayBuffer())
  let doc: Awaited<ReturnType<typeof getDocument>['promise']>
  try {
    doc = await getDocument({
      data,
      // Text extraction only — keep options minimal for pdfjs 5.x typing
      useSystemFonts: true,
      disableAutoFetch: true,
      disableStream: true,
    }).promise
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/toHex|worker|Setting up fake worker|Failed to fetch/i.test(msg)) {
      throw new Error(
        `PDF engine failed (${msg}). Try DOCX/TXT, or re-export the PDF as text-based. pdf.js ${version}`,
      )
    }
    throw new Error(
      `Could not open PDF: ${msg}. If it is password-protected or scanned (image-only), export text or use DOCX/TXT.`,
    )
  }

  try {
    const pages: string[] = []
    const limit = Math.min(doc.numPages, MAX_PDF_PAGES)

    for (let i = 1; i <= limit; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
      pages.push(text)
    }

    let out = pages.join('\n').replace(/\s+/g, ' ').trim()
    if (doc.numPages > MAX_PDF_PAGES) {
      out += ` [truncated after ${MAX_PDF_PAGES} of ${doc.numPages} pages]`
    }
    return out.slice(0, MAX_TEXT_CHARS)
  } finally {
    try {
      await doc.destroy()
    } catch {
      /* ignore */
    }
  }
}

function u16(view: DataView, o: number) {
  return view.getUint16(o, true)
}
function u32(view: DataView, o: number) {
  return view.getUint32(o, true)
}

/**
 * Minimal ZIP reader for OOXML (.docx): find entry by name and inflate.
 * Avoids a jszip dependency while still producing real resume text.
 */
async function zipReadEntry(
  bytes: Uint8Array,
  entryName: string,
): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const target = entryName.replace(/\\/g, '/')

  while (offset + 30 < bytes.length) {
    const sig = u32(view, offset)
    if (sig !== 0x04034b50) break // local file header
    const method = u16(view, offset + 8)
    const compSize = u32(view, offset + 18)
    const uncompSize = u32(view, offset + 22)
    const nameLen = u16(view, offset + 26)
    const extraLen = u16(view, offset + 28)
    const nameStart = offset + 30
    const name = new TextDecoder('utf-8').decode(
      bytes.subarray(nameStart, nameStart + nameLen),
    )
    const dataStart = nameStart + nameLen + extraLen
    const dataEnd = dataStart + compSize
    if (dataEnd > bytes.length) return null

    if (name === target || name.endsWith('/' + target)) {
      const payload = bytes.subarray(dataStart, dataEnd)
      if (method === 0) {
        return payload.slice(0, uncompSize || payload.length)
      }
      if (method === 8) {
        // deflate
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('Browser cannot decompress DOCX (no DecompressionStream)')
        }
        const ds = new DecompressionStream('deflate-raw')
        // Copy into a fresh ArrayBuffer so BlobPart typing is happy under TS 5.x DOM libs
        const copy = new Uint8Array(payload.byteLength)
        copy.set(payload)
        const stream = new Blob([copy]).stream().pipeThrough(ds)
        const ab = await new Response(stream).arrayBuffer()
        return new Uint8Array(ab)
      }
      throw new Error(`Unsupported ZIP compression method ${method} in DOCX`)
    }
    offset = dataEnd
  }
  return null
}

function stripDocxXml(xml: string): string {
  return xml
    .replace(/<w:tab[^/]*\/>/gi, '\t')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:br[^/]*\/>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * True if text looks like ZIP/DOCX binary (broken parse) or unreadable junk.
 * Empty string is NOT garbage — callers decide empty vs missing.
 */
export function looksLikeBinaryGarbage(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false

  // OOXML / ZIP magic — real resumes never start this way
  if (t.startsWith('PK')) {
    if (t.length <= 4) return true
    if (/^PK[\x00-\x08\x0b\x0c\x0e-\x1f\uFFFD]/.test(t)) return true
    if (/Content_Types|word\/|_rels|docProps|\[Content_Types\]/i.test(t.slice(0, 800))) {
      return true
    }
    // PK + mostly non-letters in the head → zip bytes decoded as text
    const head = t.slice(0, 120)
    const letters = (head.match(/[A-Za-z]/g) || []).length
    if (letters / head.length < 0.4) return true
  }

  if (t.includes('RESUME: PK') || /^RESUME:\s*PK/i.test(t)) return true
  if (/\[Content_Types\]\.xml/i.test(t) || /word\/document\.xml/i.test(t)) return true

  // high ratio of replacement / non-printable in sample
  let bad = 0
  const sample = t.slice(0, 500)
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) bad++
  }
  if (bad / Math.max(sample.length, 1) > 0.06) return true

  // Too few readable words for "resume length" text
  if (t.length > 80) {
    const words = t.match(/[A-Za-z]{3,}/g) || []
    if (words.length < 5) return true
  }
  return false
}

/** Return text if readable, else empty string. */
export function sanitizeResumeText(text: string | undefined | null): string {
  const raw = (text || '').trim()
  if (!raw || looksLikeBinaryGarbage(raw)) return ''
  return raw
}

/**
 * Extract plain text from DOCX by reading word/document.xml inside the zip.
 */
export async function extractDocxText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  // Magic: PK
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(`${file.name} does not look like a DOCX/ZIP file.`)
  }
  const xmlBytes = await zipReadEntry(buf, 'word/document.xml')
  if (!xmlBytes || !xmlBytes.length) {
    throw new Error(
      `Could not read document.xml from ${file.name}. Re-export as PDF or plain text.`,
    )
  }
  const xml = new TextDecoder('utf-8').decode(xmlBytes)
  const text = stripDocxXml(xml).slice(0, MAX_TEXT_CHARS)
  if (!text || text.length < 20 || looksLikeBinaryGarbage(text)) {
    throw new Error(
      `Could not extract readable text from ${file.name}. Try PDF or .txt export.`,
    )
  }
  return text
}

/** Guess "First Last" from resume filename like Sri_Naidu_SAP_ABAP.docx */
export function nameFromResumeFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  // Drop common resume suffixes
  const cleaned = base
    .replace(
      /\b(resume|cv|sap|abap|hana|consultant|engineer|developer|profile|final|v\d+)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
  const parts = cleaned.split(' ').filter((p) => p.length > 1 && /^[A-Za-z]+$/.test(p))
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  if (parts.length === 1 && parts[0]!.length >= 3) {
    return parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1).toLowerCase()
  }
  // Fallback: first two underscore tokens if they look like names
  const tokens = filename
    .replace(/\.[^.]+$/, '')
    .split(/[_\s-]+/)
    .filter((t) => /^[A-Za-z]{2,}$/.test(t))
  if (tokens.length >= 2) {
    return `${tokens[0]} ${tokens[1]}`.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return null
}

const ALLOWED_EXT = /\.(pdf|docx|md|txt|markdown)$/i

export function isAllowedKnowledgeFile(file: File): boolean {
  return ALLOWED_EXT.test(file.name)
}

export async function parseUploadedFile(
  file: File,
  type: KnowledgeDocType,
): Promise<ResumeDocument> {
  if (!isAllowedKnowledgeFile(file)) {
    throw new Error(`Unsupported file: ${file.name}. Use PDF, DOCX, MD, or TXT.`)
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error(`${file.name} is over 25 MB — use a smaller PDF or split it.`)
  }

  const ext = file.name.toLowerCase()
  let text = ''

  if (ext.endsWith('.pdf')) {
    text = await extractPdfText(file)
  } else if (ext.endsWith('.docx')) {
    text = await extractDocxText(file)
  } else {
    text = (await file.text()).slice(0, MAX_TEXT_CHARS)
  }

  if (!text || text.trim().length < 20 || looksLikeBinaryGarbage(text)) {
    throw new Error(
      `Could not extract text from ${file.name}. If it is a scanned PDF, use a text-based export. For Word, save as PDF or .txt.`,
    )
  }

  return {
    id: uid('doc'),
    name: file.name,
    type,
    text,
    uploadedAt: new Date().toISOString(),
    sizeBytes: file.size,
  }
}

/**
 * Turn uploaded docs into retrieval memories.
 * Resume → STAR-ish experience blocks.
 * Subject/reference/notes → knowledge chunks for interview Q&A.
 */
export function vectorizeToMemories(doc: ResumeDocument): StarMemory[] {
  if (doc.type === 'job') return []

  const isKnowledge = doc.type === 'notes' || doc.type === 'reference'
  const chunks = isKnowledge
    ? splitIntoKnowledgeChunks(doc.text)
    : splitIntoExperienceChunks(doc.text)

  return chunks.map((chunk, idx) => {
    const metrics =
      chunk.match(
        /\b\d+(\.\d+)?\s?(%|x|X|k|K|M|ms|s|QPS|users)?\b/gi,
      ) ?? []
    const tags = [
      ...extractTags(chunk),
      ...(isKnowledge ? ['knowledge', doc.type] : ['experience', 'resume']),
      ...tagsFromFilename(doc.name),
    ]
    const uniqueTags = [...new Set(tags)].slice(0, 8)

    if (isKnowledge) {
      return {
        id: uid('mem'),
        situation: `From ${doc.name}`,
        task: sentenceAt(chunk, 0) || `Topic ${idx + 1}`,
        action: chunk.slice(0, 320),
        result:
          sentenceAt(chunk, 1) ||
          (metrics.length
            ? `Key figures: ${metrics.slice(0, 3).join(', ')}`
            : 'Subject knowledge for interview answers.'),
        metrics: metrics.slice(0, 5),
        tags: uniqueTags,
        sourceFile: doc.name,
        score: 0.55 + Math.min(0.4, chunk.length / 2000),
      }
    }

    return {
      id: uid('mem'),
      situation: sentenceAt(chunk, 0) || `Experience block ${idx + 1}`,
      task: sentenceAt(chunk, 1) || 'Deliver measurable impact in role.',
      action: sentenceAt(chunk, 2) || chunk.slice(0, 180),
      result:
        metrics.length > 0
          ? `Achieved ${metrics.slice(0, 3).join(', ')}`
          : sentenceAt(chunk, 3) || 'Delivered positive outcome.',
      metrics: metrics.slice(0, 5),
      tags: uniqueTags,
      sourceFile: doc.name,
      score: 0.5 + Math.min(0.45, metrics.length * 0.08),
    }
  })
}

function tagsFromFilename(name: string): string[] {
  return name
    .replace(/\.[^.]+$/, '')
    .split(/[\s_\-.]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2 && t.length < 24)
    .slice(0, 4)
}

function splitIntoExperienceChunks(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []

  const byBullet = cleaned
    .split(/(?:•|\u2022|\n-|\n\*|;\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)

  if (byBullet.length >= 2) return byBullet.slice(0, 16)

  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned]
  const chunks: string[] = []
  for (let i = 0; i < sentences.length; i += 3) {
    chunks.push(sentences.slice(i, i + 3).join(' ').trim())
  }
  return chunks.filter(Boolean).slice(0, 16)
}

/** Larger topic chunks for subject PDFs / study notes. */
function splitIntoKnowledgeChunks(text: string): string[] {
  const cleaned = text.replace(/\r/g, '\n').trim()
  if (!cleaned) return []

  // Prefer heading-like or blank-line separated sections
  let parts = cleaned
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 60)

  if (parts.length < 2) {
    parts = cleaned
      .split(/(?=\b(?:Chapter|Section|Unit|Module|\d+\.\d+)\b)/i)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 60)
  }

  if (parts.length < 2) {
    // Sliding windows of ~400 chars
    const flat = cleaned.replace(/\s+/g, ' ')
    parts = []
    const step = 350
    for (let i = 0; i < flat.length && parts.length < 24; i += step) {
      const slice = flat.slice(i, i + 500).trim()
      if (slice.length > 80) parts.push(slice)
    }
  }

  return parts.slice(0, 24)
}

function sentenceAt(text: string, index: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
  return (sentences[index] ?? '').trim()
}

function extractTags(text: string): string[] {
  const vocab = [
    'react',
    'typescript',
    'python',
    'redis',
    'postgres',
    'aws',
    'kubernetes',
    'rag',
    'llm',
    'ml',
    'system design',
    'leadership',
    'latency',
    'backend',
    'frontend',
    // Finance / SAP / domain (subject PDFs)
    'sap',
    'fico',
    'vertex',
    'tax',
    'gl',
    'controlling',
    's/4hana',
    'accounting',
    'finance',
    'ros',
    'robotics',
    'gnc',
    'abap',
    'hana',
    'fiori',
  ]
  const lower = text.toLowerCase()
  return vocab.filter((v) => lower.includes(v)).slice(0, 8)
}

/** Bag-of-words Jaccard match for top-k STAR memories (interview RAG + JD match). */
export function rankMemories(
  query: string,
  memories: StarMemory[],
  k = 3,
): StarMemory[] {
  const q = tokenize(query)
  return [...memories]
    .map((m) => {
      const blob = tokenize(
        `${m.situation} ${m.task} ${m.action} ${m.result} ${m.tags.join(' ')}`,
      )
      const score = jaccard(q, blob)
      return { ...m, score }
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, k)
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s+#./-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return inter / union
}
