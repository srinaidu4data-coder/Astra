/**
 * SpeakCanvas psych-math engine
 * --------------------------------
 * Combines classic psychology with formulas rarely used in interview UIs:
 *
 * 1. Softmax attention (τ-temperature) — allocate glance priority across beats
 * 2. Serial-position curve (primacy + recency) — Murdock / Ebbinghaus tradition
 * 3. Peak-end rule (Kahneman) — boost first speak line + last close
 * 4. Isolation / von Restorff — rare token kinds get higher highlight score
 * 5. Cognitive-load budget (Sweller-inspired) — L = words + highlights + beats
 * 6. Zipf-style rarity budget — highlight count ∝ 1/log(1+N)
 * 7. Time-utility under deadline — U = Σ a_i v_i e^{-t_i/T}
 * 8. Implementation intentions (Gollwitzer) — "When X → say Hook"
 * 9. Chunking (Miller/Cowan) — default 3 speak beats
 *
 * These drive layout intensity and highlight budget — not domain hardcoding.
 */

/** Softmax temperature (higher = flatter attention) */
export const ATTENTION_TAU = 0.72

/** Primacy / recency decay rates for serial-position scores */
export const LAMBDA_PRIMACY = 0.55
export const LAMBDA_RECENCY = 0.7

/** Peak weight for middle "proof/action" beat when n≥3 */
export const PEAK_MID_BOOST = 0.35

/** Cognitive load caps (normalized later to [0,1]) */
export const LOAD_WORD_CAP = 140
export const LOAD_HIGHLIGHT_CAP = 8
export const LOAD_BEAT_CAP = 5

export type BeatRole = 'hook' | 'proof' | 'close' | 'support'

export type BeatPlan = {
  index: number
  role: BeatRole
  /** Psych label shown in UI */
  label: string
  /** Famous technique this beat encodes */
  technique: string
  /** Raw serial-position score s_i */
  serialScore: number
  /** Softmax attention a_i ∈ (0,1), Σ a ≈ 1 */
  attention: number
  /** CSS scale for type size emphasis */
  displayScale: number
  /** Suggested max words to keep load low */
  wordBudget: number
}

export type SpeakCanvasStats = {
  /** Softmax temperature used */
  tau: number
  /** Cognitive load L ∈ [0, ~1.5] — keep ≤ 1 when possible */
  cognitiveLoad: number
  /** Zipf-derived highlight budget B */
  highlightBudget: number
  /** Expected utility under time T (seconds) */
  timeUtility: number
  /** Implementation intention line */
  intention: string
  beats: BeatPlan[]
  /** Human-readable formula strip */
  formulas: string[]
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x))
}

/**
 * Softmax: a_i = exp(s_i / τ) / Σ_j exp(s_j / τ)
 * Numerically stable with max subtraction.
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
 * Serial-position score (primacy + recency [+ mid peak for action]).
 * s_i = α e^{-λ_p i} + β e^{-λ_r (n-1-i)} + γ * peak_mid(i)
 */
export function serialPositionScores(n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [1]
  const alpha = 1
  const beta = 1
  const mid = n >= 3 ? Math.floor((n - 1) / 2) : -1
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const primacy = alpha * Math.exp(-LAMBDA_PRIMACY * i)
    const recency = beta * Math.exp(-LAMBDA_RECENCY * (n - 1 - i))
    const peak = i === mid ? PEAK_MID_BOOST : 0
    // Extra peak-end: first and last get +0.15 (Kahneman peak-end)
    const peakEnd = i === 0 || i === n - 1 ? 0.15 : 0
    out.push(primacy + recency + peak + peakEnd)
  }
  return out
}

/**
 * Role assignment under chunking (default 3): Hook / Proof / Close.
 * Maps famous techniques onto speak order.
 */
export function assignBeatRoles(n: number): Array<{
  role: BeatRole
  label: string
  technique: string
}> {
  if (n <= 0) return []
  if (n === 1) {
    return [
      {
        role: 'hook',
        label: 'HOOK',
        technique: 'Primacy · open with the claim',
      },
    ]
  }
  if (n === 2) {
    return [
      { role: 'hook', label: 'HOOK', technique: 'Primacy effect' },
      { role: 'close', label: 'CLOSE', technique: 'Peak-end rule' },
    ]
  }
  // n >= 3 → chunk to Hook, Proof…, Close (Cowan ~3–4 chunks)
  const roles: Array<{ role: BeatRole; label: string; technique: string }> = []
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      roles.push({
        role: 'hook',
        label: 'HOOK',
        technique: 'Primacy · first fixation',
      })
    } else if (i === n - 1) {
      roles.push({
        role: 'close',
        label: 'CLOSE',
        technique: 'Recency + peak-end',
      })
    } else if (i === 1 || (n === 3 && i === 1)) {
      roles.push({
        role: 'proof',
        label: 'PROOF',
        technique: 'Peak · action + evidence',
      })
    } else {
      roles.push({
        role: 'support',
        label: `BEAT ${i + 1}`,
        technique: 'Chunking · support detail',
      })
    }
  }
  return roles
}

/**
 * Zipf-inspired highlight budget:
 * B = clamp(3, 8, floor(k / log2(1 + N_words)))
 * Rare in interview UIs — keeps isolation (von Restorff) intact as text grows.
 */
export function zipfHighlightBudget(totalWords: number): number {
  const n = Math.max(1, totalWords)
  const k = 18 // scale constant
  const b = Math.floor(k / Math.log2(1 + n))
  return clamp(b, 3, 8)
}

/**
 * Cognitive load (simplified Sweller form for UI):
 * L = 0.5*(W/Wmax) + 0.3*(H/Hmax) + 0.2*(B/Bmax)
 * Target L ≤ 1 for speakable glance load.
 */
export function cognitiveLoad(opts: {
  words: number
  highlights: number
  beats: number
}): number {
  const w = opts.words / LOAD_WORD_CAP
  const h = opts.highlights / LOAD_HIGHLIGHT_CAP
  const b = opts.beats / LOAD_BEAT_CAP
  return 0.5 * w + 0.3 * h + 0.2 * b
}

/**
 * Time-bounded utility (rarely used in copilots):
 * U = Σ_i a_i * v_i * exp(-t_i / T)
 * v_i higher for hook/proof/close; t_i ≈ cumulative word-time (0.35s/word)
 */
export function timeUtility(
  attentions: number[],
  roles: BeatRole[],
  wordCounts: number[],
  T = 45,
): number {
  const value: Record<BeatRole, number> = {
    hook: 1.0,
    proof: 1.15,
    close: 0.95,
    support: 0.55,
  }
  let t = 0
  let u = 0
  for (let i = 0; i < attentions.length; i++) {
    const words = wordCounts[i] ?? 0
    const v = value[roles[i] ?? 'support']
    const a = attentions[i] ?? 0
    // speak time for this beat before it is "heard"
    const decay = Math.exp(-t / Math.max(1, T))
    u += a * v * decay
    t += words * 0.35
  }
  return u
}

/**
 * Isolation prior for highlight kinds (von Restorff):
 * base * (1 + δ * log(1 + 1/freq))
 * Metrics rarer than ownership in prose → higher isolation score.
 */
export function isolationPrior(kind: 'metric' | 'ownership' | 'outcome'): number {
  // Approximate relative corpus freqs (interview answers)
  const freq = { metric: 0.04, ownership: 0.08, outcome: 0.06 }[kind]
  const delta = 0.85
  return 1 + delta * Math.log(1 + 1 / Math.max(1e-3, freq))
}

/**
 * Plan full SpeakCanvas layout for N text parts.
 */
export function planSpeakCanvas(
  parts: string[],
  opts?: { highlightHits?: number; timeBudgetSec?: number },
): SpeakCanvasStats {
  const n = parts.length
  const rolesMeta = assignBeatRoles(n)
  const serial = serialPositionScores(n)
  const attention = softmax(serial, ATTENTION_TAU)
  const wordCounts = parts.map((p) =>
    (p || '').trim().split(/\s+/).filter(Boolean).length,
  )
  const totalWords = wordCounts.reduce((a, b) => a + b, 0)
  const highlightBudget = zipfHighlightBudget(totalWords || 40)
  const hits = opts?.highlightHits ?? 0
  const load = cognitiveLoad({
    words: totalWords,
    highlights: hits || highlightBudget,
    beats: Math.max(1, n),
  })

  // If load high, shrink display scales slightly (extraneous load control)
  const loadPenalty = load > 1 ? 0.92 : 1

  const beats: BeatPlan[] = rolesMeta.map((r, i) => {
    const a = attention[i] ?? 1 / Math.max(1, n)
    // displayScale from attention — peak beats larger (peak-end + primacy)
    const displayScale = (0.88 + 0.28 * a) * loadPenalty
    // word budget proportional to attention under global cap
    const wordBudget = Math.max(
      12,
      Math.round((wordCounts[i] || 20) * (0.7 + 0.6 * a)),
    )
    return {
      index: i,
      role: r.role,
      label: r.label,
      technique: r.technique,
      serialScore: serial[i] ?? 0,
      attention: a,
      displayScale,
      wordBudget,
    }
  })

  const roles = rolesMeta.map((r) => r.role)
  const U = timeUtility(attention, roles, wordCounts, opts?.timeBudgetSec ?? 45)

  const intention =
    n <= 0
      ? 'When the interviewer stops → open with one clear claim.'
      : 'When they finish the question → speak HOOK first (primacy), then PROOF (peak), end on CLOSE (peak-end).'

  return {
    tau: ATTENTION_TAU,
    cognitiveLoad: load,
    highlightBudget,
    timeUtility: U,
    intention,
    beats,
    formulas: [
      `a_i = softmax(s_i / τ)  τ=${ATTENTION_TAU}`,
      `s_i = e^{-λ_p i} + e^{-λ_r (n-1-i)} + peak  (serial position)`,
      `B = ⌊k / log₂(1+N)⌋ ∈ [3,8]  (Zipf highlight budget → ${highlightBudget})`,
      `L = 0.5 W̃ + 0.3 H̃ + 0.2 B̃  (cognitive load → ${load.toFixed(2)})`,
      `U = Σ a_i v_i e^{-t_i/T}  (time utility → ${U.toFixed(2)})`,
      `Isolation: d = 1 + δ log(1+1/f)  (von Restorff rarity)`,
    ],
  }
}

/**
 * Detect atomic first answer (one-word rule): 1–4 word term + period.
 * Matches: "Hook: CAPM." | "Hook — CAPM." | "Net Present Value." | "CAPM."
 */
export function extractAtomicPunchline(text: string): {
  token: string
  rest: string
} | null {
  const raw = (text || '').trim()
  if (!raw) return null
  const firstLine = raw.split(/\r?\n/)[0]?.trim() || ''
  // Allow colon or em-dash after label (API bullets use "Hook — …" sometimes)
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

/** Map STAR fields to psych roles with peak on Action. */
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
      technique: 'Compress setup (anti-ramble)',
      weight: 'muted',
    },
    {
      key: 'task',
      label: 'T · Task',
      role: 'support',
      technique: 'Goal frame only',
      weight: 'muted',
    },
    {
      key: 'action',
      label: 'A · Action',
      role: 'proof',
      technique: 'Peak · speak most of this',
      weight: 'primary',
    },
    {
      key: 'result',
      label: 'R · Result',
      role: 'close',
      technique: 'Peak-end · metric close',
      weight: 'secondary',
    },
  ]
}
