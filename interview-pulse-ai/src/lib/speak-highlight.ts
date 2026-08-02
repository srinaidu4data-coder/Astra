/**
 * SpeakCanvas impact highlights — bold the words that carry the answer.
 *
 * Psych law (von Restorff isolation + Zipf sparsity):
 *   Only words that could stand in for the whole answer get bold.
 *   Never bold full sentences. Never spam.
 *
 * What counts as “same impact as whole answer”:
 *   • Atomic punch (Yes. / CAPM. / Block.)
 *   • Metrics & numbers
 *   • Domain terms / ALL-CAPS acronyms (EPCIS, GTIN, ATTP…)
 *   • Power verbs of ownership & decision
 *   • Hard tradeoff / control / compliance buzzwords
 *   • Outcome nouns that land the close
 */

import {
  isolationPrior,
  softmax,
  zipfHighlightBudget,
} from '@/lib/speak-canvas-engine'
import { applyQuestionOverlapBoost } from '@/lib/speak-psych-hacks'

export const HIGHLIGHT_BUDGET = 8
/** Reject spans longer than this (anti full-sentence bold) */
export const MAX_SPAN_WORDS = 3

// ── Lexicons: impact-bearing only (not filler) ─────────────────────────────

const METRIC_RE =
  /(\$?\d+(?:[.,]\d+)?\s*(?:%|x|ms|s|k|m|b|hrs?|mins?|weeks?|days?|mo(?:nths)?|years?)?\b|\bp\d{2}\b)/gi

/** “I [power verb] …” — ownership that carries a STAR Action */
const OWNERSHIP_RE =
  /\b(I\s+(?:led|owned|shipped|built|designed|drove|reduced|cut|improved|delivered|launched|migrated|fixed|architected|scaled|negotiated|mentored|configured|validated|authored|ran|blocked|refused|approved|rejected|escalated|enforced))\b/gi

/**
 * Standalone power verbs / decision words — the few that can replace a paragraph.
 * Matched as whole words; scored as `buzz`.
 */
/**
 * Power / process verbs — JD-leaning (serialization / integration / validation).
 * Avoid pure SWE theater (invariant, idempotent, p99) unless question uses them.
 */
const POWER_BUZZ_RE =
  /\b(block|blocked|blocking|reject|rejected|approve|approved|refuse|refused|enforce|enforced|hard stop|hard-stop|non-negotiable|go-live|cutover|hypercare|trade-?off|tradeoff|reconcile|reconciliation|commission|commissioning|aggregate|aggregation|deaggregation|serialize|serialization|serialisation|traceability|compliance|audit(?:able)?|validated|validation|authorize|authorized|authentication|master data|trading partner|business partner|ship-block|ship block|onboard(?:ing)?|mapping|repository)\b/gi

/** Outcomes that land the close — prefer domain outcomes over generic SaaS metrics */
const OUTCOME_RE =
  /\b(compliance|audit|go-live|cutover|hypercare|orphan serials|patient safety|traceability|integrity|throughput|accuracy|savings|reduction|aggregation|commissioning)\b/gi

/**
 * Yes / No / Conditional atomic decisions (often the entire answer)
 */
const DECISION_RE =
  /\b(Yes|No|Conditional|Approve|Reject|Green|Red|MAH|CMO|3PL)\b/g

/**
 * Domain-agnostic technical terms: 2–6 letter ALL-CAPS (EPCIS, GTIN, ATTP, DSCSA…)
 */
const TERM_RE = /\b(?![AI]\b)(?!OK\b)(?!US\b)(?!EU\b)[A-Z][A-Z0-9]{1,5}\b/g

const TERM_STOP = new Set([
  'THE',
  'AND',
  'FOR',
  'WITH',
  'FROM',
  'THIS',
  'THAT',
  'HAVE',
  'WILL',
  'YOUR',
  'WHAT',
  'WHEN',
  'HOW',
  'WHY',
  'WHO',
  'API',
  'UI',
  'UX',
  'CEO',
  'CTO',
  'PDF',
  'URL',
  'ID',
  'IT',
  'OR',
  'SLA', // captured via outcome when lowercased context; ALL-CAPS ok via TERM
])

export type SpeakHighlightKind =
  | 'metric'
  | 'ownership'
  | 'outcome'
  | 'term'
  | 'buzz'
  | 'punch'
  | 'decision'

export type SpeakHighlightSpan = {
  start: number
  end: number
  kind: SpeakHighlightKind
  score: number
}

export type SpeakHighlightNode = {
  text: string
  highlight: boolean
  kind?: SpeakHighlightKind
}

export type SpeakHighlightsBudgetedOptions = {
  /** Shared max spans across all parts */
  max?: number
  freeze?: boolean
  frozenParts?: SpeakHighlightSpan[][]
  /** Interviewer question — boost terms that also appear in the Q */
  question?: string
}

function baseKindScore(kind: SpeakHighlightKind): number {
  // Higher = more likely to survive Zipf budget (true impact words win)
  switch (kind) {
    case 'punch':
      return 5.0
    case 'decision':
      return 4.4
    case 'metric':
      return 3.8
    case 'buzz':
      return 3.5
    case 'term':
      return 3.2
    case 'ownership':
      return 2.6
    case 'outcome':
      return 2.5
    default:
      return 2.0
  }
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Position prior: primacy of first clause + mild recency (peak-end of the line).
 */
function positionPrior(start: number, textLen: number): number {
  const L = Math.max(1, textLen)
  const pos = start / L
  return 1 + 0.32 * Math.exp(-pos * 2.4) + 0.18 * Math.exp(-(1 - pos) * 2.0)
}

function collect(
  regex: RegExp,
  text: string,
  kind: SpeakHighlightKind,
): SpeakHighlightSpan[] {
  const out: SpeakHighlightSpan[] = []
  const re = new RegExp(regex.source, regex.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (wordCount(m[0]) > MAX_SPAN_WORDS) continue
    const iso =
      kind === 'buzz' || kind === 'decision' || kind === 'punch'
        ? isolationPrior('term')
        : isolationPrior(
            kind === 'metric'
              ? 'metric'
              : kind === 'ownership'
                ? 'ownership'
                : kind === 'outcome'
                  ? 'outcome'
                  : 'term',
          )
    const score = baseKindScore(kind) * iso * positionPrior(start, text.length)
    out.push({ start, end, kind, score })
  }
  return out
}

function nonOverlappingTop(
  spans: SpeakHighlightSpan[],
  budget: number,
): SpeakHighlightSpan[] {
  if (!spans.length || budget <= 0) return []
  const scores = spans.map((s) => s.score)
  const attn = softmax(scores, 0.72) // sharper than before — impact winners only
  const ranked = spans
    .map((s, i) => ({ ...s, score: s.score * (1 + 2.4 * (attn[i] ?? 0)) }))
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

function collectTerms(text: string): SpeakHighlightSpan[] {
  const out: SpeakHighlightSpan[] = []
  const re = new RegExp(TERM_RE.source, TERM_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tok = m[0]
    if (TERM_STOP.has(tok)) continue
    if (tok.length < 3) continue
    const start = m.index
    const end = start + tok.length
    const score =
      baseKindScore('term') *
      isolationPrior('term') *
      positionPrior(start, text.length)
    out.push({ start, end, kind: 'term', score })
  }
  return out
}

/**
 * Atomic punchline on first line: "Hook: Yes." / "Hook: CAPM."
 * These words equal the entire answer under the one-word rule.
 */
function collectPunchlines(text: string): SpeakHighlightSpan[] {
  const firstLine = (text || '').split(/\r?\n/)[0] || ''
  const m = firstLine.match(
    /^(?:(?:Hook|Answer|Thesis)\s*[:—–-]\s*)?([A-Za-z0-9][\w./+-]*(?:\s+[A-Za-z0-9][\w./+-]*){0,3})\s*\.\s*$/i,
  )
  if (!m) return []
  const token = m[1]!
  const idx = firstLine.indexOf(token)
  if (idx < 0) return []
  return [
    {
      start: idx,
      end: idx + token.length,
      kind: 'punch',
      score:
        baseKindScore('punch') *
        isolationPrior('term') *
        positionPrior(idx, text.length) *
        1.4,
    },
  ]
}

/** Collect all high-impact candidates (domain-agnostic). */
export function collectSpeakCandidates(text: string): SpeakHighlightSpan[] {
  if (!text) return []
  return [
    ...collectPunchlines(text),
    ...collect(DECISION_RE, text, 'decision'),
    ...collect(METRIC_RE, text, 'metric'),
    ...collect(POWER_BUZZ_RE, text, 'buzz'),
    ...collectTerms(text),
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
  // Slightly higher floor so short answers still bold 3–4 impact words
  const zipf = Math.max(3, zipfHighlightBudget(words))
  const b = Math.min(budget, zipf)
  return nonOverlappingTop(collectSpeakCandidates(text), b)
}

/**
 * Split text into plain / highlight segments for rendering.
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
    if (s.end <= cursor) continue
    const from = Math.max(s.start, cursor)
    nodes.push({
      text: text.slice(from, s.end),
      highlight: true,
      kind: s.kind,
    })
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
 * Shared Zipf budget; impact-scored; freeze while streaming.
 */
export function getSpeakHighlightsBudgeted(
  parts: string[],
  options: SpeakHighlightsBudgetedOptions = {},
): SpeakHighlightSpan[][] {
  const totalWords = parts.reduce((a, p) => a + wordCount(p || ''), 0)
  const max =
    options.max ?? Math.max(4, zipfHighlightBudget(totalWords || 40))
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
  const q = (options.question || '').trim()

  for (let i = 0; i < n; i++) {
    const part = parts[i] ?? ''
    let cands = collectSpeakCandidates(part)
    if (q) cands = applyQuestionOverlapBoost(cands, part, q)
    for (const s of cands) {
      // Primacy: early beats get slight boost (speak first)
      const beatBoost = 1 + 0.15 * Math.exp(-0.45 * i)
      // Punch/decision on any beat always priority
      const kindBoost =
        s.kind === 'punch' || s.kind === 'decision'
          ? 1.25
          : s.kind === 'buzz' || s.kind === 'metric'
            ? 1.1
            : 1
      pool.push({
        ...s,
        part: i,
        score: s.score * beatBoost * kindBoost,
      })
    }
  }

  if (!pool.length) return parts.map(() => [])

  const attn = softmax(
    pool.map((s) => s.score),
    0.72,
  )
  const ranked = pool
    .map((s, i) => ({
      ...s,
      score: s.score * (1 + 2.4 * (attn[i] ?? 0)),
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

  return perPart.map((bucket) => bucket.sort((a, b) => a.start - b.start))
}
