/**
 * Ready-made mock interview catalog (Mock → Ready-made mocks).
 * Generated bank lives in readyMadeMocks.generated.json (from Final 50.xlsx).
 */
import type { MockDifficulty, MockFocus, MockPersona, MockQuestion } from '@/services/mock-interview'
import catalog from './readyMadeMocks.generated.json'

export type ReadyMadePack = {
  id: string
  title: string
  subtitle: string
  difficulty: MockDifficulty
  focus: MockFocus
  persona: MockPersona
  job_title: string
  company?: string
  question_count: number
  answer_seconds: number
  tags: string[]
  /** Optional pre-recorded full panel audio (served from /public) */
  audio_url?: string
  intro_script: string
  closing_script: string
  questions: Array<
    MockQuestion & {
      speaker?: string
    }
  >
}

export type ReadyMadeCategory = {
  id: string
  label: string
  description: string
  packs: ReadyMadePack[]
}

export const READY_MADE_CATEGORIES: ReadyMadeCategory[] =
  catalog.categories as ReadyMadeCategory[]

export function getReadyMadeCategory(id: string): ReadyMadeCategory | undefined {
  return READY_MADE_CATEGORIES.find((c) => c.id === id)
}

export function getReadyMadePack(packId: string): ReadyMadePack | undefined {
  for (const cat of READY_MADE_CATEGORIES) {
    const p = cat.packs.find((x) => x.id === packId)
    if (p) return p
  }
  return undefined
}

export function listReadyMadePacks(): ReadyMadePack[] {
  return READY_MADE_CATEGORIES.flatMap((c) => c.packs)
}
