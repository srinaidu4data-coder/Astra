/**
 * SpeakCanvas doctrine tests — peak-end, glance, Cool roles.
 * Run: npx vitest run src/lib/speak-canvas-engine.test.ts
 */
import { describe, expect, it } from 'vitest'
import {
  assignBeatRoles,
  planSpeakCanvas,
  serialPositionScores,
  zipfHighlightBudget,
} from './speak-canvas-engine'
import { craftCoolSignoff, extractLabeledCoolLine } from './speak-cool-line'
import { advanceSpeakLadder, ladderCue } from './speak-psych-hacks'

describe('assignBeatRoles', () => {
  it('maps 3 beats to Hook / Proof / Close', () => {
    const r = assignBeatRoles(3)
    expect(r.map((x) => x.role)).toEqual(['hook', 'proof', 'close'])
  })

  it('labels last Cool: line as cool, Close as second-to-last', () => {
    const parts = [
      'Hook: Ship the invariant.',
      'Proof: block incomplete aggregation.',
      'Close: that is the control.',
      'Cool: Short version — longer if useful.',
    ]
    const r = assignBeatRoles(4, parts)
    expect(r.map((x) => x.role)).toEqual(['hook', 'proof', 'close', 'cool'])
  })
})

describe('planSpeakCanvas doctrine', () => {
  it('prefers glance for multi-beat answers (System 1 under stress)', () => {
    const parts = [
      'Hook: Yes.',
      'I enforce serialization before commission.',
      'Close: audit trail proves it.',
      'Detail that should collapse under load and more words here for load.',
    ]
    const plan = planSpeakCanvas(parts)
    expect(plan.processMode).toBe('glance')
    expect(plan.formulas).toEqual([])
    const peak = plan.beats.filter((b) =>
      ['hook', 'proof', 'close', 'cool'].includes(b.role),
    )
    peak.forEach((b) => expect(b.collapsible).toBe(false))
  })

  it('serial position peaks first and last', () => {
    const s = serialPositionScores(3)
    expect(s[0]!).toBeGreaterThan(0)
    expect(s[2]!).toBeGreaterThan(0)
    // mid proof has mid-peak boost
    expect(s[1]!).toBeGreaterThan(0.5)
  })

  it('zipf budget stays sparse', () => {
    expect(zipfHighlightBudget(40)).toBeLessThanOrEqual(6)
    expect(zipfHighlightBudget(200)).toBeLessThanOrEqual(4)
  })
})

describe('Cool + ladder', () => {
  it('extracts labeled Cool line', () => {
    expect(
      extractLabeledCoolLine('Hook: Yes.\nCool: Happy to go deeper.'),
    ).toBe('Happy to go deeper.')
  })

  it('crafts non-empty cool signoff', () => {
    const line = craftCoolSignoff({
      answerText: 'I led the EPCIS migration with clear rollback.',
      question: 'How did you handle EPCIS?',
    })
    expect(line.length).toBeGreaterThan(10)
  })

  it('ladder advances Hook → Proof → Close → Ask → Cool → done', () => {
    expect(advanceSpeakLadder('all')).toBe('hook')
    expect(advanceSpeakLadder('hook')).toBe('proof')
    expect(advanceSpeakLadder('proof')).toBe('close')
    expect(advanceSpeakLadder('close')).toBe('ask')
    expect(advanceSpeakLadder('ask')).toBe('cool')
    expect(advanceSpeakLadder('cool')).toBe('done')
    expect(ladderCue('close')).toMatch(/Ask/i)
  })
})
