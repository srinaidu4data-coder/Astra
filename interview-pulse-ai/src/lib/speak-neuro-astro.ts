/**
 * SpeakCanvas — Neuroscience + Astrophysics representation layer
 * ---------------------------------------------------------------
 * Goal: make the *structure of attention* world-class without deleting
 * a single word of the answer (OpenAI product bar: progressive disclosure,
 * never permanent information loss).
 *
 * Neuroscience (applied as layout law, not labels):
 *  1. Fovea vs periphery (Yarbus / visual psychophysics)
 *     — first ~10 words of a beat = foveal; rest = peripheral dim
 *  2. Predictive coding (Friston) — stable structure; only mass updates
 *  3. Working memory (Cowan 4±1) — orbit slots, not infinite rails
 *  4. Speech motor chunking (~3–4s / ~10–14 words) — phrase cadence
 *  5. Magnocellular “pop” — impact words get magnitude (bold+luminance)
 *
 * Astrophysics metaphors (computational, not decoration):
 *  A. Inverse-square gravity — impact score → local visual mass
 *     L ∝ M / r²  (r = normalized position in beat; core mass higher)
 *  B. Orbital hierarchy — Hook = star core, Proof = planet, Close = rim,
 *     Support = moon (dimmer, still present)
 *  C. Event horizon — atomic punchline is the singularity (all mass)
 *  D. Luminosity classes — O/B/A/F/G magnitude bands for keywords
 *  E. Gravitational lensing — peak beat slightly scales neighbors’ attention
 *
 * IMPORTANT: every function only *annotates* text for CSS. The full string
 * is always preserved for speak / copy / expand.
 */

import type { BeatRole } from '@/lib/speak-canvas-engine'
import type { SpeakHighlightKind, SpeakHighlightSpan } from '@/lib/speak-highlight'

/** ~foveal window: first N words get full luminance (saccade landing) */
export const FOVEAL_WORD_COUNT = 11

/** Phrase length for motor speech chunks (~2.5–3.5s at interview pace) */
export const PHRASE_WORD_TARGET = 12

/** Luminosity / magnitude bands (astronomy O→G ≈ brightest→dimmer) */
export type LuminosityClass = 'O' | 'B' | 'A' | 'F' | 'G'

export type OrbitalShell = 'core' | 'planet' | 'rim' | 'moon'

export type PhraseSegment = {
  text: string
  /** true = inside foveal window of the beat */
  foveal: boolean
  /** phrase index for cadence (0-based) */
  phraseIndex: number
}

export type KeywordMagnitude = {
  kind: SpeakHighlightKind
  /** 0–1 visual mass from inverse-square + kind */
  mass: number
  luminosity: LuminosityClass
  cssClass: string
}

export function orbitalShell(role: BeatRole): OrbitalShell {
  if (role === 'hook') return 'core'
  if (role === 'proof') return 'planet'
  if (role === 'close') return 'rim'
  return 'moon'
}

/**
 * Inverse-square visual mass for a highlight.
 * kind provides rest mass M0; position in line acts as radius r ∈ (0.15, 1].
 * mass = M0 / (r²) then normalized softly.
 */
export function gravitationalMass(
  kind: SpeakHighlightKind,
  start: number,
  textLen: number,
): number {
  const M0: Record<SpeakHighlightKind, number> = {
    punch: 1.0,
    decision: 0.92,
    metric: 0.85,
    buzz: 0.78,
    term: 0.72,
    ownership: 0.55,
    outcome: 0.52,
  }
  const r = Math.max(0.15, (start + 1) / Math.max(1, textLen))
  const raw = (M0[kind] ?? 0.5) / (r * r)
  // soft cap so layout does not explode
  return Math.min(1, raw / 6)
}

export function luminosityFromMass(mass: number): LuminosityClass {
  if (mass >= 0.75) return 'O'
  if (mass >= 0.55) return 'B'
  if (mass >= 0.38) return 'A'
  if (mass >= 0.22) return 'F'
  return 'G'
}

export function keywordMagnitude(
  kind: SpeakHighlightKind,
  start: number,
  textLen: number,
): KeywordMagnitude {
  const mass = gravitationalMass(kind, start, textLen)
  const luminosity = luminosityFromMass(mass)
  return {
    kind,
    mass,
    luminosity,
    cssClass: `speak-mag-${luminosity.toLowerCase()} speak-keyword-${kind}`,
  }
}

/**
 * Split beat text into phrase segments for motor chunking + fovea.
 * Does not drop or rewrite words — only groups for CSS spans.
 */
export function segmentForNeuro(text: string): PhraseSegment[] {
  const raw = text || ''
  if (!raw.trim()) return []

  // Tokenize preserving whitespace so we can reassemble losslessly
  const tokens = raw.split(/(\s+)/)
  const wordsOnly = tokens.filter((t) => t.trim().length > 0)
  if (!wordsOnly.length) return [{ text: raw, foveal: true, phraseIndex: 0 }]

  const segments: PhraseSegment[] = []
  let wordIdx = 0
  let phraseIndex = 0
  let buf = ''
  let wordsInPhrase = 0

  const flush = (foveal: boolean) => {
    if (!buf) return
    segments.push({ text: buf, foveal, phraseIndex })
    buf = ''
    wordsInPhrase = 0
    phraseIndex += 1
  }

  for (const tok of tokens) {
    const isWord = tok.trim().length > 0
    buf += tok
    if (!isWord) continue
    const foveal = wordIdx < FOVEAL_WORD_COUNT
    wordIdx += 1
    wordsInPhrase += 1
    // Break phrase on punctuation end or target length
    const endsClause = /[.!?;:]\s*$/.test(tok) || /[.!?;:]$/.test(tok)
    if (endsClause || wordsInPhrase >= PHRASE_WORD_TARGET) {
      flush(foveal || wordIdx <= FOVEAL_WORD_COUNT)
    }
  }
  if (buf) {
    flush(wordIdx <= FOVEAL_WORD_COUNT)
  }

  // Fix foveal flag by absolute word position rebuild (more accurate)
  return recomputeFoveal(segments)
}

function recomputeFoveal(segments: PhraseSegment[]): PhraseSegment[] {
  let words = 0
  return segments.map((seg) => {
    const w = seg.text.trim().split(/\s+/).filter(Boolean).length
    const startWords = words
    words += w
    const foveal = startWords < FOVEAL_WORD_COUNT
    return { ...seg, foveal }
  })
}

/**
 * Gravitational lensing: boost proof-neighbor attention slightly.
 * Pure numbers for CSS scale — does not change text.
 */
export function lensedDisplayScale(
  baseScale: number,
  role: BeatRole,
  proofIndex: number,
  selfIndex: number,
): number {
  if (proofIndex < 0) return baseScale
  const dist = Math.abs(selfIndex - proofIndex)
  if (dist === 0) return baseScale * 1.04 // planet mass
  if (dist === 1) return baseScale * 1.015 // mild lensing
  if (role === 'hook') return baseScale * 1.02
  return baseScale
}

/**
 * Attach magnitude metadata to highlight spans for CSS classes.
 */
export function magnifySpans(
  spans: SpeakHighlightSpan[],
  textLen: number,
): Array<SpeakHighlightSpan & { luminosity: LuminosityClass; mass: number }> {
  return spans.map((s) => {
    const m = keywordMagnitude(s.kind, s.start, textLen)
    return { ...s, luminosity: m.luminosity, mass: m.mass }
  })
}
