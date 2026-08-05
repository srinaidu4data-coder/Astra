/**
 * Cool sign-off line — last speak rail after Hook / Proof / Close
 * ----------------------------------------------------------------
 * Not stand-up. Not roasting the interviewer. A *short* affiliative closer
 * so the last 3–6 seconds of your answer signal warmth + composure.
 *
 * Literature (used as design law, never as labels on the speak surface):
 *
 * 1. Peak–end rule (Kahneman) — the last moment disproportionately colors
 *    the interviewer's memory of your answer.
 * 2. Warmth–competence (Fiske et al., stereotype content model) — after you
 *    prove competence (Hook/Proof/Close), a light warm beat prevents the
 *    "cold expert" trap without undercutting credibility.
 * 3. Benign-violation (McGraw & Warren) — humor lands when it is mild and
 *    clearly safe; no status attacks, no self-sabotage.
 * 4. Affiliative humor (Martin) — bond, don't perform; invitation > punchline.
 * 5. Processing fluency — short, speakable, one breath (~8–18 words).
 * 6. Ironic process avoidance — never "don't be nervous"; only a calm closer.
 *
 * Prefer extracting Cool: / Wit: from the model when present; otherwise
 * synthesize from the answer's own domain words (no generic meme bank only).
 */

const COOL_LABEL = /^(?:Cool|Wit|Spark|Charm|Sign[- ]?off)\s*[:—–-]\s*/i

/** Explicit Cool: line from model output if present. */
export function extractLabeledCoolLine(text: string): string | null {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i]!
    if (COOL_LABEL.test(ln)) {
      const body = ln.replace(COOL_LABEL, '').trim()
      if (body.length >= 8 && body.length <= 160) return body
    }
  }
  // Last bullet that looks like a light closer
  const last = lines[lines.length - 1] || ''
  if (
    /^(i'll leave|happy to|that's the short|short version|longer version|fair to stop)/i.test(
      last,
    ) &&
    last.length <= 140
  ) {
    return last.replace(/^(Close|Result)\s*[:—–-]\s*/i, '').trim()
  }
  return null
}

/**
 * Pull a concrete token from the answer/question text only.
 * No product-skill list — prefers ALL-CAPS present in the text, else a metric.
 */
function domainAnchor(blob: string): string | null {
  const t = blob || ''
  // Prefer ALLCAPS tokens that already appear in answer/Q
  const caps = t.match(/\b[A-Z][A-Z0-9]{1,7}\b/g) || []
  const labelSkip = new Set([
    'I',
    'A',
    'THE',
    'AND',
    'OR',
    'YES',
    'NO',
    'OK',
    'STAR',
    'HOOK',
    'CLOSE',
    'TASK',
    'ACTION',
    'RESULT',
  ])
  for (const c of caps) {
    if (!labelSkip.has(c) && c.length >= 2) return c
  }
  // Metric already in the text (no skill vocabulary)
  const metric = t.match(
    /\$?\d+(?:[.,]\d+)?\s*(?:%|x|ms|s|k|m|hrs?|days?|weeks?)?/i,
  )
  if (metric?.[0]) return metric[0].trim()
  return null
}

function isBehavioral(blob: string): boolean {
  return /\b(situation|conflict|team|stakeholder|mentor|failed|mistake|led|ownership)\b/i.test(
    blob,
  )
}

function isTechnical(blob: string): boolean {
  return /\b(design|architect|system|latency|throughput|tradeoff|mechanism|schema|API|scale)\b/i.test(
    blob,
  )
}

/**
 * Craft a cool, speakable sign-off.
 * Always returns one line; never empty.
 */
export function craftCoolSignoff(opts: {
  answerText: string
  question?: string
  mode?: string
}): string {
  const blob = `${opts.question || ''}\n${opts.answerText || ''}`
  const labeled = extractLabeledCoolLine(opts.answerText || '')
  if (labeled) return labeled

  const anchor = domainAnchor(blob)
  const mode = (opts.mode || '').toLowerCase()

  // Template families — calm confidence, not jokes-at-expense
  const withAnchor = (a: string): string[] => [
    `That's the short version on ${a} — longer war stories available if useful.`,
    `I'll leave ${a} there before I turn it into a whitepaper.`,
    `Happy to pressure-test any corner of that ${a} call — or we can move on.`,
    `That's where I'd put my name on ${a}. Deeper dive on request.`,
  ]

  const behavioral = [
    "That's the story — the longer cut has more coffee and fewer slides.",
    "I'll stop there before it becomes a TED talk nobody asked for.",
    "That's how I show up under pressure. Happy to unpack any beat.",
    "Short version done. The messy middle is available if you want it.",
  ]

  const technical = [
    "That's the design I stand behind — happy to stress-test any corner.",
    "I'll leave the diagram on the whiteboard, not in your ears.",
    "Tradeoffs included free of charge. Deep dive optional.",
    "That's the call I'd ship. Open to a second opinion in the room.",
  ]

  const general = [
    "I'll leave it there before I sound like a podcast.",
    "That's the honest short version — longer if useful.",
    "Happy to go one level deeper, or we can park it.",
    "Cool. That's me without the fluff.",
  ]

  let pool: string[]
  if (anchor) pool = withAnchor(anchor)
  else if (mode === 'star' || isBehavioral(blob)) pool = behavioral
  else if (mode === 'technical' || mode === 'code' || isTechnical(blob))
    pool = technical
  else pool = general

  // Stable pick from answer length so the same answer keeps the same cool line
  const seed = (opts.answerText || opts.question || 'x').length
  return pool[seed % pool.length]!
}

/** True if text already ends with a cool/sign-off style line (avoid double). */
export function answerHasCoolBeat(text: string): boolean {
  return Boolean(extractLabeledCoolLine(text))
}
