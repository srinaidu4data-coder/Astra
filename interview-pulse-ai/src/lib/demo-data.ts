import type { AnalyticsPoint, PracticeSession, StarMemory } from '@/types'

/**
 * No baked-in skill or project stories.
 * Memories come only from user-uploaded resume / notes on Knowledge.
 */
export const DEMO_MEMORIES: StarMemory[] = []

/** Neutral empty chart shell — no domain narrative. */
export const DEMO_ANALYTICS: AnalyticsPoint[] = [
  { date: 'Mon', confidence: 0, technicalDepth: 0, fillerRate: 0, starScore: 0 },
  { date: 'Tue', confidence: 0, technicalDepth: 0, fillerRate: 0, starScore: 0 },
  { date: 'Wed', confidence: 0, technicalDepth: 0, fillerRate: 0, starScore: 0 },
  { date: 'Thu', confidence: 0, technicalDepth: 0, fillerRate: 0, starScore: 0 },
  { date: 'Fri', confidence: 0, technicalDepth: 0, fillerRate: 0, starScore: 0 },
  { date: 'Sat', confidence: 0, technicalDepth: 0, fillerRate: 0, starScore: 0 },
  { date: 'Sun', confidence: 0, technicalDepth: 0, fillerRate: 0, starScore: 0 },
]

/** No seeded practice sessions with fabricated notes. */
export const DEMO_SESSIONS: PracticeSession[] = []

/** Empty — practice flow uses live STT / user materials, not canned skill Qs. */
export const SAMPLE_QUESTIONS: string[] = []

/** Interviewer persona labels (UI only — not answer-domain packs). */
export const PERSONA_LABELS: Record<string, string> = {
  'strict-tech-lead': 'Strict Tech Lead',
  'behavioral-hr': 'Behavioral HR',
  'system-design': 'System Design Architect',
  'friendly-recruiter': 'Friendly Recruiter',
}
