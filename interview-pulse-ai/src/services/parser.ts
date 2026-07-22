import { uid } from '@/lib/utils'
import type { ResumeDocument, StarMemory } from '@/types'

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

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    pages.push(text)
  }

  return pages.join('\n').replace(/\s+/g, ' ').trim()
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

export async function parseUploadedFile(
  file: File,
  type: ResumeDocument['type'],
): Promise<ResumeDocument> {
  const ext = file.name.toLowerCase()
  let text = ''

  if (ext.endsWith('.pdf')) {
    text = await extractPdfText(file)
  } else if (ext.endsWith('.docx')) {
    text = await extractDocxText(file)
  } else {
    text = await file.text()
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

/** Heuristic STAR atomic memory extraction for demo/offline RAG. */
export function vectorizeToMemories(doc: ResumeDocument): StarMemory[] {
  const chunks = splitIntoExperienceChunks(doc.text)
  return chunks.map((chunk, idx) => {
    const metrics =
      chunk.match(
        /\b\d+(\.\d+)?\s?(%|x|X|k|K|M|ms|s|QPS|users)?\b/gi,
      ) ?? []

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
      tags: extractTags(chunk),
      sourceFile: doc.name,
      score: 0.5 + Math.min(0.45, metrics.length * 0.08),
    }
  })
}

function splitIntoExperienceChunks(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []

  const byBullet = cleaned
    .split(/(?:•|\u2022|\n-|\n\*|;\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)

  if (byBullet.length >= 2) return byBullet.slice(0, 12)

  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned]
  const chunks: string[] = []
  for (let i = 0; i < sentences.length; i += 3) {
    chunks.push(sentences.slice(i, i + 3).join(' ').trim())
  }
  return chunks.filter(Boolean).slice(0, 12)
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
  ]
  const lower = text.toLowerCase()
  return vocab.filter((v) => lower.includes(v)).slice(0, 6)
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
