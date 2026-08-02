/**
 * SpeakCanvas psych hacks — fixes from a devil’s-advocate pass
 * -------------------------------------------------------------
 * Critiques of SpeakCanvas v2 (and the hacks that answer them):
 *
 * 1) SPLIT ATTENTION — chips + path + body fight for working memory
 *    → Hide chips when spotlight is on; max 3 chips default (Zipf of chips)
 *
 * 2) DIM = UNREADABLE — 0.38 opacity kills text you still need
 *    → Soft dim + hover undim (affordance without losing content)
 *
 * 3) REGEX IS DUMB — bold misses Q-relevant terms
 *    → Question-overlap gravity: words shared with the question get mass boost
 *
 * 4) FIXED FOVEA WINDOW — “first 11 words” ignores clause structure
 *    → First-clause fovea (until , ; : — or . ! ?)
 *
 * 5) NO SPEAK LADDER — keys 1/2/3 require looking at chrome
 *    → Space advances Hook → Proof → Close (implementation intention as *behavior*)
 *
 * 6) FAKE PROGRESS — completeness bar after stream is done is theater
 *    → Only meaningful while streaming; sealed state after
 *
 * 7) IRONIC PROCESS — showing “don’t ramble” makes people ruminate
 *    → No coach labels; only structural cues (next beat to speak)
 *
 * 8) PEAK-END LEAK — Close can get lost mid-scroll
 *    → Land pulse once when stream completes
 *
 * 9) CHOICE OVERLOAD — too many affordances under cortisol
 *    → “Focus mode” after answer settles: strip chips, keep path minimal
 *
 * 10) COMMITMENT WITHOUT SEQUENCE — punch locks token but not speak order
 *     → Next-cue: “Speak Hook” → Space → “Speak Proof” → …
 */

import type { BeatRole } from '@/lib/speak-canvas-engine'
import type { SpeakHighlightSpan } from '@/lib/speak-highlight'

const STOP = new Set(
  'a an the and or but if then to of in on for with about as at by from is are was were be been being i you we they it this that what how why when where which tell me your can could would should please just very really also'.split(
    ' ',
  ),
)

/** Tokenize for overlap; keep domain-ish tokens (len≥3 or ALLCAPS). */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of (text || '').toLowerCase().match(/[a-z0-9][\w./+-]*/g) || []) {
    if (STOP.has(raw)) continue
    if (raw.length < 3 && !/^\d/.test(raw)) continue
    out.add(raw)
  }
  return out
}

/**
 * Boost highlight scores for terms that also appear in the question.
 * Psych: relevance = retrieval cue (encoding specificity / transfer-appropriate processing).
 */
export function applyQuestionOverlapBoost(
  spans: SpeakHighlightSpan[],
  partText: string,
  question: string,
): SpeakHighlightSpan[] {
  if (!spans.length || !question.trim()) return spans
  const qTok = contentTokens(question)
  if (!qTok.size) return spans
  return spans.map((s) => {
    const slice = partText.slice(s.start, s.end).toLowerCase()
    const words = slice.match(/[a-z0-9][\w./+-]*/g) || []
    const hits = words.filter((w) => qTok.has(w)).length
    if (!hits) return s
    // Up to +45% mass when fully overlapping
    const boost = 1 + Math.min(0.45, 0.18 * hits)
    return { ...s, score: s.score * boost }
  })
}

/**
 * First-clause fovea: words until first clause boundary, not fixed N.
 * Psych: clause = natural speech planning unit (Levelt).
 */
export function firstClauseWordCount(text: string, fallback = 11): number {
  const t = (text || '').trim()
  if (!t) return fallback
  const m = t.match(/^[\s\S]{8,160}?(?:[,;:—–]|\.\s|!\s|\?\s)/)
  if (!m) return fallback
  const n = m[0].trim().split(/\s+/).filter(Boolean).length
  return Math.max(4, Math.min(16, n || fallback))
}

export type SpeakLadderStep = 'hook' | 'proof' | 'close' | 'done'

/** Advance speak ladder: all → hook → proof → close → done → all */
export function advanceSpeakLadder(current: SpeakLadderStep | 'all'): SpeakLadderStep | 'all' {
  if (current === 'all' || current === 'done') return 'hook'
  if (current === 'hook') return 'proof'
  if (current === 'proof') return 'close'
  return 'done'
}

export function ladderCue(step: SpeakLadderStep | 'all'): string {
  if (step === 'all') return 'Space: start at Hook'
  if (step === 'hook') return 'Speak Hook · Space → Proof'
  if (step === 'proof') return 'Speak Proof · Space → Close'
  if (step === 'close') return 'Land Close · Space → done'
  return 'Sealed · Space restarts ladder'
}

export function roleMatchesLadder(
  role: BeatRole,
  step: SpeakLadderStep | 'all',
): boolean {
  if (step === 'all' || step === 'done') return true
  return role === step
}

/**
 * Zipf of chips: under stress, 3 chips max. Full strip only on demand.
 * Psych: choice overload (Iyengar/Lepper) + isolation.
 */
export function chipBudget(opts: {
  spotlightActive: boolean
  focusMode: boolean
  expanded?: boolean
}): number {
  if (opts.spotlightActive || opts.focusMode) return 0
  if (opts.expanded) return 6
  return 3
}

/** Soft dim opacity — still readable (devil: 0.38 was unusable). */
export const SOFT_DIM_OPACITY = 0.55

/**
 * Land pulse: true once when streaming flips true→false for a card.
 */
export function shouldLandPulse(
  wasStreaming: boolean,
  isStreaming: boolean,
  hasClose: boolean,
): boolean {
  return wasStreaming && !isStreaming && hasClose
}
