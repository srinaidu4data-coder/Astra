import type { AnalyticsPoint, PracticeSession, StarMemory } from '@/types'
import { uid } from './utils'

export const DEMO_MEMORIES: StarMemory[] = [
  {
    id: uid('mem'),
    situation: 'Checkout latency spiked during Black Friday traffic.',
    task: 'Restore p99 latency under 200ms without full rewrite.',
    action:
      'Profiled Redis hot keys, introduced request coalescing, and scaled the cache cluster with connection pooling.',
    result: 'Cut p99 from 1.2s to 180ms and held 100k QPS peak.',
    metrics: ['180ms p99', '100k QPS', '85% cache hit rate'],
    tags: ['redis', 'performance', 'backend'],
    sourceFile: 'resume.pdf',
  },
  {
    id: uid('mem'),
    situation: 'ML inference service failed SLOs under burst load.',
    task: 'Stabilize model serving for real-time interview scoring.',
    action:
      'Batched GPU requests, added circuit breakers, and moved feature extraction closer to the edge.',
    result: 'Improved availability from 97.2% to 99.95% and reduced cost 22%.',
    metrics: ['99.95% uptime', '22% cost down'],
    tags: ['ml', 'gpu', 'sre'],
    sourceFile: 'resume.pdf',
  },
  {
    id: uid('mem'),
    situation: 'Cross-team system design interviews lacked consistency.',
    task: 'Create a reusable interview rubric and practice arena.',
    action:
      'Built structured STAR rubrics, filler-word telemetry, and persona-based mock sessions.',
    result: 'Raised pass rate of coached candidates by 31% over one quarter.',
    metrics: ['+31% pass rate'],
    tags: ['leadership', 'process', 'product'],
    sourceFile: 'notes.md',
  },
]

export const DEMO_ANALYTICS: AnalyticsPoint[] = [
  { date: 'Mon', confidence: 62, technicalDepth: 58, fillerRate: 8.2, starScore: 64 },
  { date: 'Tue', confidence: 68, technicalDepth: 63, fillerRate: 7.1, starScore: 70 },
  { date: 'Wed', confidence: 71, technicalDepth: 69, fillerRate: 6.4, starScore: 74 },
  { date: 'Thu', confidence: 76, technicalDepth: 72, fillerRate: 5.8, starScore: 78 },
  { date: 'Fri', confidence: 81, technicalDepth: 79, fillerRate: 4.9, starScore: 84 },
  { date: 'Sat', confidence: 84, technicalDepth: 82, fillerRate: 4.2, starScore: 88 },
  { date: 'Sun', confidence: 87, technicalDepth: 85, fillerRate: 3.8, starScore: 91 },
]

export const DEMO_SESSIONS: PracticeSession[] = [
  {
    id: uid('sess'),
    persona: 'strict-tech-lead',
    startedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    endedAt: new Date(Date.now() - 86400000 * 2 + 2400000).toISOString(),
    questions: 12,
    fillerWords: 17,
    starCoverage: 82,
    confidence: 78,
    technicalDepth: 86,
    notes: ['Strong Redis story', 'Hedge when unsure on CAP tradeoffs'],
  },
  {
    id: uid('sess'),
    persona: 'behavioral-hr',
    startedAt: new Date(Date.now() - 86400000).toISOString(),
    endedAt: new Date(Date.now() - 86400000 + 1800000).toISOString(),
    questions: 8,
    fillerWords: 11,
    starCoverage: 91,
    confidence: 85,
    technicalDepth: 54,
    notes: ['Excellent conflict resolution narrative'],
  },
]

export const SAMPLE_QUESTIONS = [
  'Tell me about a time you improved system performance under pressure.',
  'How would you design a real-time transcription pipeline with sub-second latency?',
  'Walk me through a conflict with a teammate and how you resolved it.',
  'What tradeoffs would you make for a stealth desktop overlay that captures system audio?',
  'Explain how you would evaluate RAG quality for interview answer personalization.',
]

export const PERSONA_LABELS: Record<string, string> = {
  'strict-tech-lead': 'Strict Tech Lead',
  'behavioral-hr': 'Behavioral HR',
  'system-design': 'System Design Architect',
  'friendly-recruiter': 'Friendly Recruiter',
}
