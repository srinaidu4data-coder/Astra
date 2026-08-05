import { describe, expect, it } from 'vitest'
import {
  getInterviewReadiness,
  hasDocOfType,
  readinessSummary,
} from './interview-ready'
import type { ResumeDocument } from '@/types'

const doc = (
  type: ResumeDocument['type'],
  text: string,
): ResumeDocument => ({
  id: `d_${type}`,
  name: type,
  type,
  text,
  uploadedAt: new Date().toISOString(),
  sizeBytes: text.length,
})

describe('getInterviewReadiness', () => {
  it('requires role, context, resume, and JD', () => {
    const empty = getInterviewReadiness({
      role: '',
      jobContext: '',
      documents: [],
    })
    expect(empty.ready).toBe(false)
    expect(empty.completeCount).toBe(0)
    expect(empty.missing.map((m) => m.key)).toEqual([
      'role',
      'jobContext',
      'resume',
      'jd',
    ])
  })

  it('is ready only when all four pass', () => {
    const partial = getInterviewReadiness({
      role: 'SAP ATTP Architect',
      jobContext: 'EPCIS',
      documents: [doc('resume', 'x'.repeat(50))],
    })
    expect(partial.ready).toBe(false)
    expect(partial.missing.map((m) => m.key)).toEqual(['jd'])

    const full = getInterviewReadiness({
      role: 'SAP ATTP Architect',
      jobContext: 'EPCIS',
      documents: [
        doc('resume', 'x'.repeat(50)),
        doc('job', 'y'.repeat(50)),
      ],
    })
    expect(full.ready).toBe(true)
    expect(full.completeCount).toBe(4)
    expect(readinessSummary(full)).toBe('Ready to start')
  })

  it('rejects too-short role/context and short docs', () => {
    const r = getInterviewReadiness({
      role: 'A',
      jobContext: 'ab',
      documents: [doc('resume', 'short'), doc('job', 'short')],
    })
    expect(r.ready).toBe(false)
    expect(r.completeCount).toBe(0)
  })

  it('hasDocOfType checks length', () => {
    expect(hasDocOfType([doc('resume', 'x'.repeat(40))], 'resume')).toBe(true)
    expect(hasDocOfType([doc('resume', 'tiny')], 'resume')).toBe(false)
    expect(hasDocOfType([doc('job', 'x'.repeat(50))], 'resume')).toBe(false)
  })
})
