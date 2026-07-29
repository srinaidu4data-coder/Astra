import { uid } from '@/lib/utils'
import type { KnowledgeDocType, ResumeDocument, StarMemory } from '@/types'

/** Max pages to parse (keeps large subject PDFs usable in-browser). */
const MAX_PDF_PAGES = 80
/** Cap extracted text so localStorage stays healthy. */
const MAX_TEXT_CHARS = 120_000

/** Extract plain text from PDF using pdf.js (browser). */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Use CDN worker for Vite compatibility
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
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
}

export async function extractDocxText(file: File): Promise<string> {
  // Lightweight DOCX: read as text and strip rough XML tags for MVP.
  // Full OOXML parsing can be swapped for mammoth later.
  const buf = await file.arrayBuffer()
  const raw = new TextDecoder('utf-8').decode(buf)
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000)
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

  if (!text || text.trim().length < 20) {
    throw new Error(
      `Could not extract text from ${file.name}. If it is a scanned PDF, use a text-based export.`,
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
  ]
  const lower = text.toLowerCase()
  return vocab.filter((v) => lower.includes(v)).slice(0, 8)
}

/** Simple cosine-like bag-of-words match for top-k memories. */
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
      .replace(/[^a-z0-9\s]/g, ' ')
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
