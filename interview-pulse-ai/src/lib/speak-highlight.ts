/**
 * SpeakCanvas v0 — sparse impact highlighting (single path).
 * Cap 8 spans; never bold full sentences (MAX_SPAN_WORDS).
 * Multi-part shared budget + freeze-compatible allocation for streaming.
 */

export const HIGHLIGHT_BUDGET = 8
/** Reject spans longer than this (anti full-sentence bold) */
export const MAX_SPAN_WORDS = 4

const METRIC_RE =
  /(\$?\d+(?:[.,]\d+)?\s*(?:%|x|ms|s|k|m|b|hrs?|mins?|weeks?|days?|mo(?:nths)?|years?)?\b|\bp\d{2}\b|\bSLA\b)/gi

const OWNERSHIP_RE =
  /\b(I\s+(?:led|owned|shipped|built|designed|drove|reduced|cut|improved|delivered|launched|migrated|fixed|architected|scaled|negotiated|mentored))\b/gi

export type SpeakHighlightSpan = {
  start: number
  end: number
  kind: 'metric' | 'ownership'
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

function scoreMatch(kind: SpeakHighlightSpan['kind']): number {
  return kind === 'metric' ? 3 : 2
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
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
    out.push({ start, end, kind, score: scoreMatch(kind) })
  }
  return out
}

function nonOverlappingTop(
  spans: SpeakHighlightSpan[],
  budget: number,
): SpeakHighlightSpan[] {
  const sorted = [...spans].sort(
    (a, b) => b.score - a.score || a.start - b.start,
  )
  const picked: SpeakHighlightSpan[] = []
  for (const s of sorted) {
    if (picked.length >= budget) break
    if (picked.some((p) => !(s.end <= p.start || s.start >= p.end))) continue
    picked.push(s)
  }
  return picked.sort((a, b) => a.start - b.start)
}

/** Collect metric + ownership candidates for one text block. */
export function collectSpeakCandidates(text: string): SpeakHighlightSpan[] {
  if (!text) return []
  return [
    ...collect(METRIC_RE, text, 'metric'),
    ...collect(OWNERSHIP_RE, text, 'ownership'),
  ]
}

/** Plan highlight spans for one text block (respect budget). */
export function planSpeakHighlights(
  text: string,
  budget: number = HIGHLIGHT_BUDGET,
): SpeakHighlightSpan[] {
  if (!text || budget <= 0) return []
  return nonOverlappingTop(collectSpeakCandidates(text), budget)
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
 * Shared `max` (default 8) across all parts; metrics + ownership only.
 * freeze + frozenParts: keep prior spans (clipped) so stream growth does not reshuffle.
 */
export function getSpeakHighlightsBudgeted(
  parts: string[],
  options: SpeakHighlightsBudgetedOptions = {},
): SpeakHighlightSpan[][] {
  const max = options.max ?? HIGHLIGHT_BUDGET
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
      pool.push({ ...s, part: i })
    }
  }

  // Global score order; enforce non-overlap within each part; shared budget.
  const sorted = pool.sort(
    (a, b) => b.score - a.score || a.part - b.part || a.start - b.start,
  )
  const perPart: SpeakHighlightSpan[][] = Array.from({ length: n }, () => [])
  let used = 0

  for (const s of sorted) {
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
