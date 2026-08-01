/**
 * SpeakCanvas highlights — math-scored isolation (von Restorff) + Zipf budget.
 * Cap via zipfHighlightBudget; never bold full sentences (MAX_SPAN_WORDS).
 * Multi-part shared budget + freeze-compatible allocation for streaming.
 */

import {
  isolationPrior,
  softmax,
  zipfHighlightBudget,
} from '@/lib/speak-canvas-engine'

export const HIGHLIGHT_BUDGET = 8
/** Reject spans longer than this (anti full-sentence bold) */
export const MAX_SPAN_WORDS = 4

const METRIC_RE =
  /(\$?\d+(?:[.,]\d+)?\s*(?:%|x|ms|s|k|m|b|hrs?|mins?|weeks?|days?|mo(?:nths)?|years?)?\b|\bp\d{2}\b|\bSLA\b)/gi

const OWNERSHIP_RE =
  /\b(I\s+(?:led|owned|shipped|built|designed|drove|reduced|cut|improved|delivered|launched|migrated|fixed|architected|scaled|negotiated|mentored))\b/gi

/** Outcome nouns — light isolation class for close lines */
const OUTCOME_RE =
  /\b(uptime|conversion|revenue|latency|throughput|retention|nps|sla|accuracy|savings|reduction|growth)\b/gi

export type SpeakHighlightSpan = {
  start: number
  end: number
  kind: 'metric' | 'ownership' | 'outcome'
  score: number
}

export type SpeakHighlightNode = {
  text: string
  highlight: boolean
}

export type SpeakHighlightsBudgetedOptions = {
  /** Shared max spans across all parts (default HIGHLIGHT_BUDGET = 8) */
  max?: number
  /** When true, reuse frozenParts (clipped to current text) instead of recomputing */
  freeze?: boolean
  frozenParts?: SpeakHighlightSpan[][]
}

function baseKindScore(kind: SpeakHighlightSpan['kind']): number {
  if (kind === 'metric') return 3.2
  if (kind === 'ownership') return 2.4
  return 2.0
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Position prior inside a line (primacy of first clause + mild recency):
 * p(pos) = 1 + 0.25 e^{-pos/L} + 0.12 e^{-(L-pos)/L}
 */
function positionPrior(start: number, textLen: number): number {
  const L = Math.max(1, textLen)
  const pos = start / L
  return 1 + 0.25 * Math.exp(-pos * 2.2) + 0.12 * Math.exp(-(1 - pos) * 2.2)
}

function collect(
  regex: RegExp,
  text: string,
  kind: SpeakHighlightSpan['kind'],
): SpeakHighlightSpan[] {
  const out: SpeakHighlightSpan[] = []
  const re = new RegExp(regex.source, regex.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (wordCount(m[0]) > MAX_SPAN_WORDS) continue
    // score = base * isolation(von Restorff) * position prior
    const score =
      baseKindScore(kind) *
      isolationPrior(kind) *
      positionPrior(start, text.length)
    out.push({ start, end, kind, score })
  }
  return out
}

/**
 * Softmax-ranked non-overlapping top-k (rarely used in UIs).
 * Converts raw scores → attention probs, picks highest mass first.
 */
function nonOverlappingTop(
  spans: SpeakHighlightSpan[],
  budget: number,
): SpeakHighlightSpan[] {
  if (!spans.length || budget <= 0) return []
  const scores = spans.map((s) => s.score)
  const attn = softmax(scores, 0.85)
  const ranked = spans
    .map((s, i) => ({ ...s, score: s.score * (1 + 2 * (attn[i] ?? 0)) }))
    .sort((a, b) => b.score - a.score || a.start - b.start)

  const picked: SpeakHighlightSpan[] = []
  for (const s of ranked) {
    if (picked.length >= budget) break
    if (picked.some((p) => !(s.end <= p.start || s.start >= p.end))) continue
    picked.push({
      start: s.start,
      end: s.end,
      kind: s.kind,
      score: s.score,
    })
  }
  return picked.sort((a, b) => a.start - b.start)
}

/** Collect metric + ownership + outcome candidates for one text block. */
export function collectSpeakCandidates(text: string): SpeakHighlightSpan[] {
  if (!text) return []
  return [
    ...collect(METRIC_RE, text, 'metric'),
    ...collect(OWNERSHIP_RE, text, 'ownership'),
    ...collect(OUTCOME_RE, text, 'outcome'),
  ]
}

/** Plan highlight spans for one text block (respect budget). */
export function planSpeakHighlights(
  text: string,
  budget: number = HIGHLIGHT_BUDGET,
): SpeakHighlightSpan[] {
  if (!text || budget <= 0) return []
  const words = wordCount(text)
  const b = Math.min(budget, zipfHighlightBudget(words))
  return nonOverlappingTop(collectSpeakCandidates(text), b)
}

/**
 * Split text into plain / highlight segments for rendering.
 * Spans are assumed non-overlapping; they are sorted by start.
 */
export function splitHighlighted(
  text: string,
  spans: SpeakHighlightSpan[],
): SpeakHighlightNode[] {
  if (!text) return []
  if (!spans?.length) return [{ text, highlight: false }]

  const sorted = [...spans]
    .filter((s) => s.end > s.start && s.start >= 0 && s.start < text.length)
    .map((s) => ({
      ...s,
      end: Math.min(s.end, text.length),
    }))
    .sort((a, b) => a.start - b.start)

  if (!sorted.length) return [{ text, highlight: false }]

  const nodes: SpeakHighlightNode[] = []
  let cursor = 0
  for (const s of sorted) {
    if (s.start > cursor) {
      nodes.push({ text: text.slice(cursor, s.start), highlight: false })
    }
    // Skip if overlapped past cursor (defensive)
    if (s.end <= cursor) continue
    const from = Math.max(s.start, cursor)
    nodes.push({ text: text.slice(from, s.end), highlight: true })
    cursor = s.end
  }
  if (cursor < text.length) {
    nodes.push({ text: text.slice(cursor), highlight: false })
  }
  return nodes
}

function clipSpansToText(
  spans: SpeakHighlightSpan[],
  text: string,
): SpeakHighlightSpan[] {
  if (!text || !spans?.length) return []
  return spans
    .filter((s) => s.start >= 0 && s.end > s.start && s.start < text.length)
    .map((s) => ({
      ...s,
      end: Math.min(s.end, text.length),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)
}

/**
 * Multi-part budgeted highlights for SpeakCanvas.
 * Shared Zipf budget across parts; isolation-scored candidates; softmax pick.
 * freeze + frozenParts: keep prior spans (clipped) so stream growth does not reshuffle.
 */
export function getSpeakHighlightsBudgeted(
  parts: string[],
  options: SpeakHighlightsBudgetedOptions = {},
): SpeakHighlightSpan[][] {
  const totalWords = parts.reduce(
    (a, p) => a + wordCount(p || ''),
    0,
  )
  const max = options.max ?? zipfHighlightBudget(totalWords || 40)
  const n = parts.length

  if (n === 0) return []

  if (options.freeze && options.frozenParts) {
    return parts.map((text, i) =>
      clipSpansToText(options.frozenParts![i] ?? [], text),
    )
  }

  if (max <= 0) return parts.map(() => [])

  type Indexed = SpeakHighlightSpan & { part: number }
  const pool: Indexed[] = []
  for (let i = 0; i < n; i++) {
    for (const s of collectSpeakCandidates(parts[i] ?? '')) {
      // Mild primacy boost for early beats (serial position across parts)
      const beatBoost = 1 + 0.12 * Math.exp(-0.5 * i)
      pool.push({ ...s, part: i, score: s.score * beatBoost })
    }
  }

  if (!pool.length) return parts.map(() => [])

  // Softmax over global pool → pick mass; non-overlap per part
  const attn = softmax(
    pool.map((s) => s.score),
    0.85,
  )
  const ranked = pool
    .map((s, i) => ({
      ...s,
      score: s.score * (1 + 2.2 * (attn[i] ?? 0)),
    }))
    .sort(
      (a, b) => b.score - a.score || a.part - b.part || a.start - b.start,
    )

  const perPart: SpeakHighlightSpan[][] = Array.from({ length: n }, () => [])
  let used = 0

  for (const s of ranked) {
    if (used >= max) break
    const bucket = perPart[s.part]
    if (bucket.some((p) => !(s.end <= p.start || s.start >= p.end))) continue
    bucket.push({
      start: s.start,
      end: s.end,
      kind: s.kind,
      score: s.score,
    })
    used += 1
  }

  return perPart.map((bucket) =>
    bucket.sort((a, b) => a.start - b.start),
  )
}
