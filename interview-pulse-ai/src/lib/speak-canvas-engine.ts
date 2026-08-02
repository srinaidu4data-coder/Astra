/**
 * SpeakCanvas engine — world-class speak surface (psych-backed, UI-quiet)
 * -----------------------------------------------------------------------
 * Design bar (OpenAI + Anthropic product psych, applied to live interviews):
 *
 * OpenAI-like:
 *  - Instant progressive structure (outline → depth)
 *  - Progressive disclosure: show only what the eye needs under time pressure
 *  - High signal contrast (one focal claim, sparse emphasis)
 *
 * Anthropic-like:
 *  - Machinery hidden (no formula / technique chrome on the speak surface)
 *  - Deliberate density: fewer, better chunks
 *  - Trust via calm hierarchy — not flashy “AI skills” theater
 *
 * Classical psych used as *layout law* (never as labels the candidate reads):
 *  1. Serial position (Murdock) — first & last beats win
 *  2. Peak-end (Kahneman) — proof peak + close
 *  3. Cognitive load (Sweller) — collapse support when overloaded
 *  4. von Restorff isolation — sparse highlights only
 *  5. Zipf budget — highlight count shrinks as text grows
 *  6. Softmax attention — relative glance priority across beats
 *  7. Dual-process (System 1 glance / System 2 depth)
 *  8. Goal-gradient — streaming feels intentional, not broken
 *  9. Processing fluency — type scale contrast you can feel under stress
 * 10. Working memory (Cowan ~3–4) — hard chunk cap under pressure
 *
 * Domain-agnostic: no ML/SAP hardcoding. Isolation prefers numbers + acronyms
 * + ownership verbs from the *text itself*.
 */

/** Softmax temperature — lower = sharper peak (better under interview stress) */
export const ATTENTION_TAU = 0.62
/** When cognitive load is high, drop τ for even sharper focus */
export const ATTENTION_TAU_STRESS = 0.42

export const LAMBDA_PRIMACY = 0.48
export const LAMBDA_RECENCY = 0.62
/** Single mid-peak for Action/Proof (do not double-count peak-end) */
export const PEAK_MID_BOOST = 0.42

export const LOAD_WORD_CAP = 120
export const LOAD_HIGHLIGHT_CAP = 6
export const LOAD_BEAT_CAP = 4

/** Cowan-inspired hard cap on visible speak chunks under stress */
export const MAX_BEATS_STRESS = 3
export const MAX_BEATS_CALM = 5

/** Seconds assumed for a full spoken answer (time-utility horizon) */
export const DEFAULT_TIME_BUDGET_SEC = 40

export type BeatRole = 'hook' | 'proof' | 'close' | 'support'

/** Dual-process surface mode */
export type SpeakProcessMode = 'glance' | 'depth'
/**
 * glance  = System 1: Hook + peak only, max contrast (OpenAI “instant useful”)
 * depth   = System 2: full beats when load is low (Anthropic deliberate read)
 */

export type BeatPlan = {
  index: number
  role: BeatRole
  /** Short rail label for UI (HOOK / PROOF / CLOSE) — not psych jargon */
  label: string
  /** @deprecated kept for type compat; always empty — never show technique chrome */
  technique: string
  serialScore: number
  attention: number
  displayScale: number
  wordBudget: number
  /** Soft opacity hint 0.45–1 for support under load */
  opacity: number
  /** When true, UI may collapse to one line */
  collapsible: boolean
}

export type SpeakCanvasStats = {
  tau: number
  cognitiveLoad: number
  highlightBudget: number
  timeUtility: number
  /** Internal coach line only — do not render on speak surface by default */
  intention: string
  beats: BeatPlan[]
  /** @deprecated empty — formulas must not appear in speak UI */
  formulas: string[]
  processMode: SpeakProcessMode
  /** Recommended max visible beats after load control */
  visibleBeatCap: number
  /** Goal-gradient: 0–1 how “complete” the scaffold feels while streaming */
  completeness: number
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x))
}

/**
 * Softmax: a_i = exp(s_i / τ) / Σ_j exp(s_j / τ)
 */
export function softmax(scores: number[], tau: number = ATTENTION_TAU): number[] {
  if (!scores.length) return []
  const t = Math.max(1e-6, tau)
  const m = Math.max(...scores)
  const exps = scores.map((s) => Math.exp((s - m) / t))
  const z = exps.reduce((a, b) => a + b, 0) || 1
  return exps.map((e) => e / z)
}

/**
 * Serial-position with single mid-peak (proof), not double peak-end stacking.
 * s_i = α e^{-λ_p i} + β e^{-λ_r (n-1-i)} + γ·1[mid]
 */
export function serialPositionScores(n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [1]
  const alpha = 1.05
  const beta = 1.0
  // Proof peak: prefer index 1 for n=3 (Hook/Proof/Close), else true mid
  const mid = n === 3 ? 1 : n >= 4 ? Math.floor(n / 2) : -1
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const primacy = alpha * Math.exp(-LAMBDA_PRIMACY * i)
    const recency = beta * Math.exp(-LAMBDA_RECENCY * (n - 1 - i))
    const peak = i === mid ? PEAK_MID_BOOST : 0
    out.push(primacy + recency + peak)
  }
  return out
}

/**
 * Role assignment under working-memory chunking.
 * Labels stay plain English (HOOK/PROOF/CLOSE) — Anthropic quiet chrome.
 */
export function assignBeatRoles(n: number): Array<{
  role: BeatRole
  label: string
  technique: string
}> {
  if (n <= 0) return []
  if (n === 1) {
    return [{ role: 'hook', label: 'HOOK', technique: '' }]
  }
  if (n === 2) {
    return [
      { role: 'hook', label: 'HOOK', technique: '' },
      { role: 'close', label: 'CLOSE', technique: '' },
    ]
  }
  const roles: Array<{ role: BeatRole; label: string; technique: string }> = []
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      roles.push({ role: 'hook', label: 'HOOK', technique: '' })
    } else if (i === n - 1) {
      roles.push({ role: 'close', label: 'CLOSE', technique: '' })
    } else if (i === 1 || (n === 3 && i === 1)) {
      roles.push({ role: 'proof', label: 'PROOF', technique: '' })
    } else {
      roles.push({
        role: 'support',
        label: n <= 4 ? 'DETAIL' : `BEAT ${i + 1}`,
        technique: '',
      })
    }
  }
  return roles
}

/**
 * Zipf-inspired highlight budget — isolation dies when everything is bold.
 * B = clamp(2, 6, floor(k / log2(1+N)))
 * Tighter than v0 (max 6) — OpenAI/Anthropic both punish highlight spam.
 */
export function zipfHighlightBudget(totalWords: number): number {
  const n = Math.max(1, totalWords)
  const k = 14
  const b = Math.floor(k / Math.log2(1 + n))
  return clamp(b, 2, 6)
}

/**
 * Cognitive load (Sweller-inspired for glance UI):
 * L = 0.55 W̃ + 0.25 H̃ + 0.20 B̃
 * Target L ≤ 0.85 for speakable glance load under interview cortisol.
 */
export function cognitiveLoad(opts: {
  words: number
  highlights: number
  beats: number
}): number {
  const w = opts.words / LOAD_WORD_CAP
  const h = opts.highlights / LOAD_HIGHLIGHT_CAP
  const b = opts.beats / LOAD_BEAT_CAP
  return 0.55 * w + 0.25 * h + 0.2 * b
}

/**
 * Adaptive τ: stress → lower temperature → sharper attention peak.
 */
export function adaptiveTau(load: number): number {
  if (load >= 1.05) return ATTENTION_TAU_STRESS
  if (load >= 0.85) return (ATTENTION_TAU + ATTENTION_TAU_STRESS) / 2
  return ATTENTION_TAU
}

/**
 * Time-bounded utility:
 * U = Σ_i a_i * v_i * exp(-t_i / T)
 */
export function timeUtility(
  attentions: number[],
  roles: BeatRole[],
  wordCounts: number[],
  T = DEFAULT_TIME_BUDGET_SEC,
): number {
  const value: Record<BeatRole, number> = {
    hook: 1.05,
    proof: 1.2,
    close: 1.0,
    support: 0.45,
  }
  let t = 0
  let u = 0
  for (let i = 0; i < attentions.length; i++) {
    const words = wordCounts[i] ?? 0
    const v = value[roles[i] ?? 'support']
    const a = attentions[i] ?? 0
    const decay = Math.exp(-t / Math.max(1, T))
    u += a * v * decay
    t += words * 0.32
  }
  return u
}

/**
 * Isolation prior (von Restorff) by span kind.
 * Metrics/acronyms rarer in prose → higher isolation.
 */
export function isolationPrior(
  kind: 'metric' | 'ownership' | 'outcome' | 'term',
): number {
  const freq = {
    metric: 0.035,
    term: 0.05,
    ownership: 0.08,
    outcome: 0.06,
  }[kind]
  const delta = 0.9
  return 1 + delta * Math.log(1 + 1 / Math.max(1e-3, freq))
}

/**
 * Processing fluency scale: wider dynamic range so stress-eye can feel it.
 * Old range ~0.88–1.16 was barely visible; world-class needs ~0.82–1.22.
 */
export function displayScaleFromAttention(
  attention: number,
  role: BeatRole,
  loadPenalty: number,
): number {
  const roleBoost =
    role === 'proof' ? 0.06 : role === 'hook' ? 0.04 : role === 'close' ? 0.02 : 0
  const base = 0.82 + 0.4 * attention + roleBoost
  return clamp(base * loadPenalty, 0.78, 1.28)
}

/**
 * Goal-gradient / Zeigarnik-safe completeness for streaming:
 * incomplete scaffold still “feels” intentional if structure is present.
 */
export function estimateCompleteness(parts: string[], streaming?: boolean): number {
  if (!parts.length) return 0
  const filled = parts.filter((p) => (p || '').trim().length > 8).length
  const ratio = filled / parts.length
  if (streaming) {
    // OpenAI pattern: partial is useful — boost early structure
    return clamp(0.25 + 0.75 * ratio, 0, 0.95)
  }
  return clamp(ratio, 0, 1)
}

export type PlanSpeakCanvasOptions = {
  highlightHits?: number
  timeBudgetSec?: number
  /** Force process mode; default auto from load */
  processMode?: SpeakProcessMode
  streaming?: boolean
}

/**
 * Plan full SpeakCanvas layout for N text parts.
 */
export function planSpeakCanvas(
  parts: string[],
  opts?: PlanSpeakCanvasOptions,
): SpeakCanvasStats {
  const n = parts.length
  const rolesMeta = assignBeatRoles(n)
  const wordCounts = parts.map((p) =>
    (p || '').trim().split(/\s+/).filter(Boolean).length,
  )
  const totalWords = wordCounts.reduce((a, b) => a + b, 0)
  const highlightBudget = zipfHighlightBudget(totalWords || 40)
  const hits = opts?.highlightHits ?? 0
  const load = cognitiveLoad({
    words: totalWords,
    highlights: hits || Math.min(highlightBudget, 4),
    beats: Math.max(1, n),
  })

  const tau = adaptiveTau(load)
  const serial = serialPositionScores(n)
  const attention = softmax(serial, tau)

  // Dual-process: high load / few parts → glance (System 1)
  const autoMode: SpeakProcessMode =
    load >= 0.9 || totalWords > 160 || n >= 5 ? 'glance' : 'depth'
  const processMode = opts?.processMode ?? autoMode

  const visibleBeatCap =
    processMode === 'glance' ? MAX_BEATS_STRESS : MAX_BEATS_CALM

  // Extraneous load control — shrink type slightly when overloaded
  const loadPenalty = load > 1 ? 0.9 : load > 0.85 ? 0.95 : 1

  const beats: BeatPlan[] = rolesMeta.map((r, i) => {
    const a = attention[i] ?? 1 / Math.max(1, n)
    const displayScale = displayScaleFromAttention(a, r.role, loadPenalty)

    // Word budget: hook short, proof generous, support tight under load
    const roleWordMul =
      r.role === 'hook'
        ? 0.55
        : r.role === 'proof'
          ? 1.15
          : r.role === 'close'
            ? 0.7
            : processMode === 'glance'
              ? 0.45
              : 0.75
    const wordBudget = Math.max(
      r.role === 'hook' ? 8 : 12,
      Math.round((wordCounts[i] || 18) * roleWordMul * (0.75 + 0.5 * a)),
    )

    // Support collapses under stress (progressive disclosure)
    const collapsible =
      r.role === 'support' || (processMode === 'glance' && r.role !== 'hook' && r.role !== 'proof')
    const opacity =
      r.role === 'support'
        ? processMode === 'glance'
          ? 0.48
          : 0.72
        : r.role === 'hook'
          ? 1
          : r.role === 'proof'
            ? 1
            : 0.92

    return {
      index: i,
      role: r.role,
      label: r.label,
      technique: '', // never surface psych jargon on speak UI
      serialScore: serial[i] ?? 0,
      attention: a,
      displayScale,
      wordBudget,
      opacity,
      collapsible,
    }
  })

  const roles = rolesMeta.map((r) => r.role)
  const U = timeUtility(
    attention,
    roles,
    wordCounts,
    opts?.timeBudgetSec ?? DEFAULT_TIME_BUDGET_SEC,
  )

  const completeness = estimateCompleteness(parts, opts?.streaming)

  // Internal only — WhisperStream must not render this by default
  const intention =
    processMode === 'glance'
      ? 'Open on the claim. One proof. Land the close.'
      : 'Claim → mechanism → proof → land.'

  return {
    tau,
    cognitiveLoad: load,
    highlightBudget,
    timeUtility: U,
    intention,
    beats,
    formulas: [], // world-class: never paint formula chrome on speak surface
    processMode,
    visibleBeatCap,
    completeness,
  }
}

/**
 * Atomic first answer (one-word / yes-no rule):
 * "Hook: Yes." | "CAPM." | "No."
 */
export function extractAtomicPunchline(text: string): {
  token: string
  rest: string
} | null {
  const raw = (text || '').trim()
  if (!raw) return null
  const firstLine = raw.split(/\r?\n/)[0]?.trim() || ''
  const m = firstLine.match(
    /^(?:(?:Hook|Answer|Thesis)\s*[:—–-]\s*)?([A-Za-z0-9][\w./+-]*(?:\s+[A-Za-z0-9][\w./+-]*){0,3})\s*\.\s*$/i,
  )
  if (!m) return null
  const token = m[1]!.replace(/\.$/, '').replace(/\s+/g, ' ').trim()
  if (!token || token.length > 48) return null
  const rest = raw.slice(firstLine.length).replace(/^\s*\n?/, '').trim()
  const hasPeriod = /\.\s*$/.test(firstLine)
  const hasLabel = /^(?:Hook|Answer|Thesis)\s*[:—–-]/i.test(firstLine)
  if (!hasPeriod && !hasLabel) return null
  return { token, rest }
}

/**
 * STAR field weights — peak on Action (speak most), mute setup (anti-ramble).
 * Labels plain; techniques empty (no psych chrome).
 */
export function starFieldWeights(): Array<{
  key: 'situation' | 'task' | 'action' | 'result'
  label: string
  role: BeatRole
  technique: string
  weight: 'muted' | 'primary' | 'secondary'
}> {
  return [
    {
      key: 'situation',
      label: 'S · Situation',
      role: 'support',
      technique: '',
      weight: 'muted',
    },
    {
      key: 'task',
      label: 'T · Task',
      role: 'support',
      technique: '',
      weight: 'muted',
    },
    {
      key: 'action',
      label: 'A · Action',
      role: 'proof',
      technique: '',
      weight: 'primary',
    },
    {
      key: 'result',
      label: 'R · Result',
      role: 'close',
      technique: '',
      weight: 'secondary',
    },
  ]
}
