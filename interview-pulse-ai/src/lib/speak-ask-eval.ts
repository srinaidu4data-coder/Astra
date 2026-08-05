/**
 * Ask rail eval harness — offline fixtures, no network.
 * Karpathy bar: measure what you ship; fail closed on bad craft.
 */

import {
  craftAskQuestion,
  hasEarnedFloor,
  planAskRail,
  riskPass,
  type AskPlan,
} from '@/lib/speak-ask-engine'

export type AskEvalCase = {
  id: string
  name: string
  input: Parameters<typeof planAskRail>[0]
  /** expect show true/false */
  expectShow: boolean
  /** optional substring in question */
  expectIncludes?: string
  /** must not appear */
  forbid?: RegExp
}

export const ASK_EVAL_FIXTURES: AskEvalCase[] = [
  {
    id: 'thin-no-show',
    name: 'Thin answer never fires Ask',
    input: {
      answerText: 'Hook: Yes.',
      question: 'Do you know EPCIS?',
      streaming: false,
      cardIndex: 0,
      asksShownThisSession: 0,
    },
    expectShow: false,
  },
  {
    id: 'streaming-no-show',
    name: 'Streaming suppresses Ask',
    input: {
      answerText:
        'Hook: I block incomplete aggregation.\nProof: Partner trial showed orphan serials drop.\nClose: Audit trail is the proof.',
      question: 'How do you handle aggregation?',
      streaming: true,
      cardIndex: 1,
      asksShownThisSession: 0,
    },
    expectShow: false,
  },
  {
    id: 'strong-show',
    name: 'Strong multi-beat answer can fire Ask',
    input: {
      answerText: [
        'Hook: Serialization integrity before commission.',
        'Proof: I enforced ship-block on incomplete aggregation and cut orphan serials in a partner pilot.',
        'Close: The control I would put in front of audit.',
      ].join('\n'),
      question: 'How would you design aggregation controls for go-live?',
      roleJob: 'SAP ATTP Solution Architect',
      streaming: false,
      cardIndex: 1,
      asksShownThisSession: 0,
    },
    expectShow: true,
    forbid: /salary|pto|what does the company do/i,
  },
  {
    id: 'rate-limit',
    name: 'Session rate limit suppresses',
    input: {
      answerText: [
        'Hook: Decision rights first.',
        'Proof: I mapped who can say no after cutover with evidence thresholds.',
        'Close: That is the governance I ship.',
      ].join('\n'),
      question: 'How do you handle cutover governance?',
      streaming: false,
      cardIndex: 2,
      asksShownThisSession: 2,
      maxAsksPerSession: 2,
    },
    expectShow: false,
  },
  {
    id: 'force-override',
    name: 'Force still applies risk filters',
    input: {
      answerText: 'Short.',
      question: 'Tell me about yourself',
      force: true,
      streaming: false,
    },
    expectShow: true, // force crafts with fallback anchor
    forbid: /salary/i,
  },
]

export type AskEvalResult = {
  id: string
  name: string
  pass: boolean
  detail: string
  plan: AskPlan
}

export function runAskEvalCase(c: AskEvalCase): AskEvalResult {
  const plan = planAskRail(c.input)
  if (plan.show !== c.expectShow) {
    return {
      id: c.id,
      name: c.name,
      pass: false,
      detail: `show=${plan.show} expected ${c.expectShow} path=${plan.path.join('→')}`,
      plan,
    }
  }
  if (plan.show && c.expectIncludes) {
    if (!plan.question.toLowerCase().includes(c.expectIncludes.toLowerCase())) {
      return {
        id: c.id,
        name: c.name,
        pass: false,
        detail: `missing "${c.expectIncludes}" in: ${plan.question}`,
        plan,
      }
    }
  }
  if (plan.show && c.forbid && c.forbid.test(plan.question)) {
    return {
      id: c.id,
      name: c.name,
      pass: false,
      detail: `forbid matched: ${plan.question}`,
      plan,
    }
  }
  if (plan.show) {
    const r = riskPass(c.input.question || '', plan.question)
    if (!r.ok) {
      return {
        id: c.id,
        name: c.name,
        pass: false,
        detail: `risk fail ${r.reason}`,
        plan,
      }
    }
  }
  return {
    id: c.id,
    name: c.name,
    pass: true,
    detail: plan.show ? plan.question : `suppressed:${plan.trace.at(-1)?.reason}`,
    plan,
  }
}

export function runAskEvalSuite(cases: AskEvalCase[] = ASK_EVAL_FIXTURES): {
  passed: number
  failed: number
  results: AskEvalResult[]
} {
  const results = cases.map(runAskEvalCase)
  return {
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  }
}

/** Smoke: floor + craft invariants. */
export function askCraftInvariants(): string[] {
  const errors: string[] = []
  if (hasEarnedFloor('Yes.')) errors.push('thin earned floor')
  if (
    !hasEarnedFloor(
      'Hook: Integrity first on serialization.\nProof: I enforced ship-block on incomplete aggregation with partners and cut orphan serials in pilot.\nClose: Audit can read the trail I leave.',
    )
  ) {
    errors.push('structured should earn floor')
  }
  const q = craftAskQuestion({
    anchor: 'EPCIS',
    question: 'How do you validate EPCIS events?',
    answerText: 'I validate event completeness before commission.',
  })
  if (q.text.length < 12) errors.push('craft too short')
  if (/salary/i.test(q.text)) errors.push('comp leak')
  return errors
}
