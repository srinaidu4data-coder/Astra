/**
 * SpeakCanvas ASK engine — reverse-question rail (evidence-gated)
 * ----------------------------------------------------------------
 * Product doctrine (see docs/REVERSE_QUESTION_ASK_CARD_RESEARCH.md v3):
 *  - Answers dominate hire ratings (Heimbaugh 2016 [P]).
 *  - Reverse Qs can raise interest/fit impressions [P]; not proven offer levers.
 *  - Sparse · gated · collaborative · non-FAQ · end-biased.
 *  - Never surface psych/neuroscience chrome on the speak UI.
 *
 * Engineering style (Karpathy bar): pure functions, explicit graph, eval harness.
 * No model calls here — craft from conversation anchors only (honest IM).
 * Build id: ask-rail-v1.0.1 (asset hash bust for custom-domain CDN).
 */

export type AskArchetype =
  | 'constraint_fork'
  | 'success_metric'
  | 'silent_failure'
  | 'decision_rights'
  | 'second_order'
  | 'resume_lens'

export type AskGraphNodeId =
  | 'idle'
  | 'earn_floor'
  | 'anchor'
  | 'budget'
  | 'phase'
  | 'risk'
  | 'craft'
  | 'show'
  | 'suppress'

/** Directed graph of gate decisions (loop-friendly, eval-friendly). */
export const ASK_GRAPH: Record<
  AskGraphNodeId,
  { next_pass: AskGraphNodeId | null; next_fail: AskGraphNodeId | null }
> = {
  idle: { next_pass: 'earn_floor', next_fail: 'suppress' },
  earn_floor: { next_pass: 'anchor', next_fail: 'suppress' },
  anchor: { next_pass: 'budget', next_fail: 'suppress' },
  budget: { next_pass: 'phase', next_fail: 'suppress' },
  phase: { next_pass: 'risk', next_fail: 'suppress' },
  risk: { next_pass: 'craft', next_fail: 'suppress' },
  craft: { next_pass: 'show', next_fail: 'suppress' },
  show: { next_pass: null, next_fail: null },
  suppress: { next_pass: null, next_fail: null },
}

export type AskGateInput = {
  /** Answer body (bullets / STAR joined). */
  answerText: string
  /** Interviewer question. */
  question?: string
  /** Optional role / job context (login pack only — no bleed). */
  roleJob?: string
  /** Still streaming → never fire. */
  streaming?: boolean
  /** Session count of Ask cards already shown (rate limit). */
  asksShownThisSession?: number
  /** Hard max Ask fires per session (default 2). */
  maxAsksPerSession?: number
  /** Card index in session (0-based); first card more conservative. */
  cardIndex?: number
  /** Force craft even if gates fail (user button). */
  force?: boolean
}

export type AskGateTrace = {
  node: AskGraphNodeId
  pass: boolean
  reason: string
}

export type AskPlan = {
  show: boolean
  /** When true, UI should hide Cool (Ask supersedes). */
  supersedeCool: boolean
  question: string
  why: string
  archetype: AskArchetype | null
  /** 0–1 internal score — never shown as “science”. */
  score: number
  trace: AskGateTrace[]
  /** Graph path taken. */
  path: AskGraphNodeId[]
}

const FAQ_BAIT =
  /\b(what does (the )?company do|where is (the )?office|how many employees|what is the salary|how much (do you|pto|vacation)|benefits package|work from home policy)\b/i

const COMP_EARLY =
  /\b(salary|compensation|pay range|pto|vacation days|bonus structure|equity package)\b/i

const STOP = new Set(
  'a an the and or but if then to of in on for with about as at by from is are was were be been being i you we they it this that what how why when where which tell me your can could would should please just very really also do does did will would my our their'.split(
    ' ',
  ),
)

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x))
}

function wordCount(s: string): number {
  return (s || '').trim().split(/\s+/).filter(Boolean).length
}

/** Content tokens for anchoring (simple, domain-agnostic). */
export function askContentTokens(text: string): string[] {
  const raw = (text || '').match(/[A-Za-z][A-Za-z0-9./+-]{1,24}/g) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    const low = t.toLowerCase()
    if (STOP.has(low)) continue
    if (low.length < 3 && !/^[A-Z]{2,}$/.test(t)) continue
    if (seen.has(low)) continue
    seen.add(low)
    out.push(t)
  }
  return out
}

/**
 * Earn-floor heuristic: enough substance to avoid “weak answer + flashy Q”.
 * Not ML — length + structure cues only. [D] design; Heimbaugh: answers dominate.
 */
export function hasEarnedFloor(answerText: string): boolean {
  const t = (answerText || '').trim()
  if (!t) return false
  const wc = wordCount(t)
  if (wc < 18) return false
  // Prefer multi-beat or labeled structure (Hook/Proof/Action/Close)
  const structured =
    /(?:Hook|Proof|Close|Action|Result|Approach|Mechanism)\s*:/i.test(t) ||
    (t.match(/\n/g) || []).length >= 1
  // Structured: lower bar (still enough to speak) — design gate, not hire science
  if (structured && wc >= 22) return true
  return wc >= 55
}

/** Anchor: concrete noun from Q + answer (conversation mass). */
export function extractAskAnchor(opts: {
  question?: string
  answerText: string
  roleJob?: string
}): { token: string; source: 'question' | 'answer' | 'role' } | null {
  const qToks = askContentTokens(opts.question || '')
  const aToks = askContentTokens(opts.answerText || '')
  const rToks = askContentTokens(opts.roleJob || '')

  // Prefer ALLCAPS / acronym-like from question first
  for (const pool of [
    { toks: qToks, source: 'question' as const },
    { toks: aToks, source: 'answer' as const },
    { toks: rToks, source: 'role' as const },
  ]) {
    for (const t of pool.toks) {
      if (/^[A-Z][A-Z0-9]{1,7}$/.test(t) && t.length >= 2) {
        return { token: t, source: pool.source }
      }
    }
  }
  // Shared content between Q and answer
  const aSet = new Set(aToks.map((x) => x.toLowerCase()))
  for (const t of qToks) {
    if (aSet.has(t.toLowerCase()) && t.length >= 4) {
      return { token: t, source: 'question' }
    }
  }
  // First meaty answer token
  for (const t of aToks) {
    if (t.length >= 5) return { token: t, source: 'answer' }
  }
  for (const t of qToks) {
    if (t.length >= 4) return { token: t, source: 'question' }
  }
  return null
}

export function budgetAllows(shown: number, max: number, cardIndex: number): boolean {
  if (shown >= max) return false
  // First card: allow only if still under budget (same rule; eval can tighten)
  if (cardIndex === 0 && shown >= 1) return false
  // Soft Zipf: after one fire, only every other card
  if (shown >= 1 && cardIndex > 0 && cardIndex % 2 === 1) return false
  return true
}

/** Risk filters: no comp-early bait, no pure FAQ. */
export function riskPass(question: string, crafted: string): { ok: boolean; reason: string } {
  if (FAQ_BAIT.test(crafted) || FAQ_BAIT.test(question)) {
    return { ok: false, reason: 'faq_bait' }
  }
  if (COMP_EARLY.test(crafted)) {
    return { ok: false, reason: 'comp_early' }
  }
  if (wordCount(crafted) > 28 || wordCount(crafted) < 6) {
    return { ok: false, reason: 'length' }
  }
  // Prosecutorial / trap tone (simple lexicon)
  if (
    /\b(why did you fail|isn't it true|you clearly|wrong about|admit that)\b/i.test(
      crafted,
    )
  ) {
    return { ok: false, reason: 'prosecutorial' }
  }
  return { ok: true, reason: 'ok' }
}

/**
 * Craft one collaborative reverse question.
 * Templates are Implication/Need-payoff flavored [T SPIN] but plain English.
 */
export function craftAskQuestion(opts: {
  anchor: string
  question?: string
  answerText: string
  roleJob?: string
}): { text: string; why: string; archetype: AskArchetype; score: number } {
  const a = (opts.anchor || 'this').replace(/[.?!,;:]+$/g, '').trim()
  const blob = `${opts.question || ''}\n${opts.answerText || ''}\n${opts.roleJob || ''}`

  const isBehavioral =
    /\b(team|conflict|stakeholder|led|mentor|failed|situation|collaborat)\b/i.test(
      blob,
    )
  const isTech =
    /\b(design|system|latency|schema|pipeline|api|scale|tradeoff|architect|serial|aggregat|audit|cutover)\b/i.test(
      blob,
    )

  type Cand = {
    text: string
    why: string
    archetype: AskArchetype
    score: number
  }

  const cands: Cand[] = [
    {
      archetype: 'constraint_fork',
      text: `When you look at ${a}, is the binding constraint data, process, or decision rights right now?`,
      why: 'Names the real bottleneck — peer systems talk',
      score: 0.82,
    },
    {
      archetype: 'success_metric',
      text: `What would make someone strong on ${a} unmistakably successful in the first ninety days?`,
      why: 'Alignment on outcomes, not vibes',
      score: 0.8,
    },
    {
      archetype: 'silent_failure',
      text: `When ${a} fails quietly, who feels it first — customer, ops, or audit?`,
      why: 'Senior failure-mode ownership',
      score: 0.78,
    },
    {
      archetype: 'decision_rights',
      text: `Who can say no on ${a} after go-live, and on what evidence?`,
      why: 'Maps power without challenging the room',
      score: 0.76,
    },
    {
      archetype: 'second_order',
      text: `If we fixed ${a} this quarter, what problem would we inherit next?`,
      why: 'Second-order thinking — systems, not slogans',
      score: 0.77,
    },
  ]

  if (isBehavioral) {
    cands.push({
      archetype: 'resume_lens',
      text: `On ${a}, what usually blocks good people — unclear owners, incentives, or load?`,
      why: 'Org realism without gossip',
      score: 0.79,
    })
  }
  if (isTech) {
    cands.push({
      archetype: 'constraint_fork',
      text: `For ${a}, do you optimize for correctness, latency, or operability when those fight?`,
      why: 'Forces a real engineering tradeoff',
      score: 0.84,
    })
  }

  // Stable pick from answer length (deterministic, no RNG flash)
  const seed =
    (opts.answerText || opts.question || a).length + a.length * 7
  const ranked = [...cands].sort((x, y) => y.score - x.score)
  const pick = ranked[seed % ranked.length]!
  // Prefer highest score 60% of stable picks
  const best = ranked[0]!
  const chosen = seed % 5 < 3 ? best : pick

  let text = chosen.text
  // Soft length guard
  if (wordCount(text) > 26) {
    text = `What's the real constraint on ${a} for the team right now?`
  }

  return {
    text,
    why: chosen.why,
    archetype: chosen.archetype,
    score: chosen.score,
  }
}

/**
 * Walk the Ask decision graph. Pure. Loop-safe. Eval-friendly.
 */
export function planAskRail(input: AskGateInput): AskPlan {
  const empty = (trace: AskGateTrace[], path: AskGraphNodeId[]): AskPlan => ({
    show: false,
    supersedeCool: false,
    question: '',
    why: '',
    archetype: null,
    score: 0,
    trace,
    path,
  })

  const trace: AskGateTrace[] = []
  const path: AskGraphNodeId[] = []
  let node: AskGraphNodeId = 'idle'

  const maxAsks = input.maxAsksPerSession ?? 2
  const shown = input.asksShownThisSession ?? 0
  const cardIndex = input.cardIndex ?? 0

  const step = (n: AskGraphNodeId, pass: boolean, reason: string) => {
    trace.push({ node: n, pass, reason })
    path.push(n)
  }

  // idle → earn_floor
  step('idle', true, 'start')
  node = 'earn_floor'

  if (input.streaming) {
    step('earn_floor', false, 'streaming')
    return empty(trace, [...path, 'suppress'])
  }

  if (input.force) {
    // Force path: still need minimal text
    const anchor =
      extractAskAnchor({
        question: input.question,
        answerText: input.answerText,
        roleJob: input.roleJob,
      }) || { token: 'this work', source: 'answer' as const }
    const crafted = craftAskQuestion({
      anchor: anchor.token,
      question: input.question,
      answerText: input.answerText,
      roleJob: input.roleJob,
    })
    const risk = riskPass(input.question || '', crafted.text)
    if (!risk.ok) {
      step('risk', false, risk.reason)
      return empty(trace, [...path, 'suppress'])
    }
    step('earn_floor', true, 'force')
    step('anchor', true, anchor.source)
    step('budget', true, 'force')
    step('phase', true, 'force')
    step('risk', true, risk.reason)
    step('craft', true, crafted.archetype)
    step('show', true, 'force')
    return {
      show: true,
      supersedeCool: true,
      question: crafted.text,
      why: crafted.why,
      archetype: crafted.archetype,
      score: crafted.score,
      trace,
      path,
    }
  }

  const earned = hasEarnedFloor(input.answerText)
  step('earn_floor', earned, earned ? 'substance' : 'thin_answer')
  if (!earned) return empty(trace, [...path, 'suppress'])

  const anchor = extractAskAnchor({
    question: input.question,
    answerText: input.answerText,
    roleJob: input.roleJob,
  })
  step('anchor', Boolean(anchor), anchor ? anchor.source : 'no_anchor')
  if (!anchor) return empty(trace, [...path, 'suppress'])

  const bud = budgetAllows(shown, maxAsks, cardIndex)
  step('budget', bud, bud ? `shown=${shown}` : 'rate_limit')
  if (!bud) return empty(trace, [...path, 'suppress'])

  // Phase: end-biased — only after non-streaming complete answer (already checked)
  // Card 0: slightly stricter (require more words)
  const phaseOk = cardIndex === 0 ? wordCount(input.answerText) >= 40 : true
  step('phase', phaseOk, phaseOk ? 'end_slot' : 'first_card_thin')
  if (!phaseOk) return empty(trace, [...path, 'suppress'])

  const crafted = craftAskQuestion({
    anchor: anchor.token,
    question: input.question,
    answerText: input.answerText,
    roleJob: input.roleJob,
  })
  const risk = riskPass(input.question || '', crafted.text)
  step('risk', risk.ok, risk.reason)
  if (!risk.ok) return empty(trace, [...path, 'suppress'])

  step('craft', true, crafted.archetype)
  step('show', true, 'gates_pass')

  return {
    show: true,
    supersedeCool: true,
    question: crafted.text,
    why: crafted.why,
    archetype: crafted.archetype,
    score: crafted.score,
    trace,
    path,
  }
}

/** Session budget helper for React state. */
export function nextAskSessionCount(prev: number, plan: AskPlan): number {
  return plan.show ? prev + 1 : prev
}
