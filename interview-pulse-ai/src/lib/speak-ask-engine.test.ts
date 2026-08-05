/**
 * Ask engine + eval harness tests
 * Run: npx vitest run src/lib/speak-ask-engine.test.ts
 */
import { describe, expect, it } from 'vitest'
import {
  craftAskQuestion,
  hasEarnedFloor,
  planAskRail,
  riskPass,
} from './speak-ask-engine'
import {
  askCraftInvariants,
  runAskEvalSuite,
} from './speak-ask-eval'

describe('hasEarnedFloor', () => {
  it('rejects thin answers', () => {
    expect(hasEarnedFloor('Hook: Yes.')).toBe(false)
    expect(hasEarnedFloor('')).toBe(false)
  })
  it('accepts structured multi-beat substance', () => {
    expect(
      hasEarnedFloor(
        [
          'Hook: Serialization integrity before commission.',
          'Proof: I blocked incomplete aggregation with a partner pilot and cut orphan serials measurably.',
          'Close: Audit can read the trail I leave on every ship-block.',
        ].join('\n'),
      ),
    ).toBe(true)
  })
})

describe('planAskRail graph', () => {
  it('suppresses while streaming', () => {
    const p = planAskRail({
      answerText:
        'Hook: X.\nProof: I delivered Y with clear tradeoffs and validation.\nClose: Z.',
      streaming: true,
      cardIndex: 1,
    })
    expect(p.show).toBe(false)
    expect(p.path).toContain('suppress')
  })

  it('can show on strong answer and supersede Cool', () => {
    const p = planAskRail({
      answerText: [
        'Hook: Integrity before commission.',
        'Proof: I enforced ship-block on incomplete aggregation across trading partners and measured orphan serial reduction.',
        'Close: That is the control I defend in audit.',
      ].join('\n'),
      question: 'How do you handle aggregation at go-live?',
      roleJob: 'ATTP architect',
      streaming: false,
      cardIndex: 1,
      asksShownThisSession: 0,
    })
    expect(p.show).toBe(true)
    expect(p.supersedeCool).toBe(true)
    expect(p.question.length).toBeGreaterThan(20)
    expect(p.question.toLowerCase()).not.toMatch(/salary/)
  })

  it('rate limits session fires', () => {
    const p = planAskRail({
      answerText: [
        'Hook: Decision rights.',
        'Proof: I mapped who can refuse go-live on evidence thresholds with the program owner.',
        'Close: Governance over theater.',
      ].join('\n'),
      question: 'Cutover governance?',
      streaming: false,
      cardIndex: 3,
      asksShownThisSession: 2,
      maxAsksPerSession: 2,
    })
    expect(p.show).toBe(false)
  })
})

describe('craft + risk', () => {
  it('risk blocks prosecutorial and comp', () => {
    expect(riskPass('q', 'What is the salary range here?').ok).toBe(false)
    expect(
      riskPass('q', "Isn't it true you failed the last cutover?").ok,
    ).toBe(false)
    expect(
      riskPass(
        'q',
        'When aggregation fails quietly, who feels it first — ops or audit?',
      ).ok,
    ).toBe(true)
  })

  it('craft is deterministic for same inputs', () => {
    const a = craftAskQuestion({
      anchor: 'EPCIS',
      question: 'EPCIS validation?',
      answerText: 'I validate completeness before commission.',
    })
    const b = craftAskQuestion({
      anchor: 'EPCIS',
      question: 'EPCIS validation?',
      answerText: 'I validate completeness before commission.',
    })
    expect(a.text).toBe(b.text)
  })
})

describe('eval harness suite', () => {
  it('passes offline fixtures', () => {
    const inv = askCraftInvariants()
    expect(inv).toEqual([])
    const suite = runAskEvalSuite()
    if (suite.failed) {
      // surface failures
      console.error(suite.results.filter((r) => !r.pass))
    }
    expect(suite.failed).toBe(0)
    expect(suite.passed).toBeGreaterThanOrEqual(4)
  })
})
