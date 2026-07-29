/** Mock interview API client (copilot API :8787). */

import { resolveCopilotHttpBase } from '@/lib/api-base'

const API_BASE = resolveCopilotHttpBase()

export type MockPersona =
  | 'strict-tech-lead'
  | 'behavioral-hr'
  | 'system-design'
  | 'friendly-recruiter'

export type MockDifficulty = 'easy' | 'medium' | 'hard'
export type MockFocus = 'mixed' | 'behavioral' | 'technical' | 'system-design'

export type MockQuestion = {
  id: string
  text: string
  /** How the interviewer says it aloud (bridge + question) */
  spoken_text?: string
  category: string
  hint?: string
  bridge?: string
}

export type MockStartResult = {
  session_id: string
  questions: MockQuestion[]
  persona: string
  difficulty: string
  focus: string
  job_title: string
  tips: string[]
  source: string
  intro_script?: string
  closing_script?: string
  audio_mode?: boolean
}

export type MockScore = {
  overall: number
  star_coverage: number
  technical_depth: number
  communication: number
  confidence: number
  filler_count: number
  strengths: string[]
  improvements: string[]
  follow_up: string | null
  model_answer_bullets: string[]
  coach_note: string
  source: string
}

export type MockReport = {
  overall: number
  star_coverage: number
  technical_depth: number
  communication: number
  confidence: number
  filler_count: number
  grade: string
  summary: string
  top_strengths: string[]
  top_improvements: string[]
  practice_plan: string[]
  highlight_quotes: string[]
  source: string
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return j?.detail?.error?.message || j?.detail || j?.message || res.statusText
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function startMockSession(input: {
  job_title: string
  job_description?: string
  persona: MockPersona
  difficulty: MockDifficulty
  focus: MockFocus
  question_count?: number
  resume_snippets?: string
  company?: string
}): Promise<MockStartResult> {
  const res = await fetch(`${API_BASE}/v1/mock/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_title: input.job_title,
      job_description: input.job_description || '',
      persona: input.persona,
      difficulty: input.difficulty,
      focus: input.focus,
      question_count: input.question_count ?? 5,
      resume_snippets: input.resume_snippets || '',
      company: input.company || '',
    }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function scoreMockAnswer(input: {
  session_id: string
  question: string
  answer: string
  persona: MockPersona
  difficulty: MockDifficulty
  job_title: string
  job_description?: string
  elapsed_sec?: number
}): Promise<MockScore> {
  const res = await fetch(`${API_BASE}/v1/mock/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function buildMockReport(input: {
  session_id: string
  job_title: string
  persona: MockPersona
  difficulty: MockDifficulty
  turns: Array<{ question: string; answer: string; scores?: Partial<MockScore> }>
}): Promise<MockReport> {
  const res = await fetch(`${API_BASE}/v1/mock/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

/** Client-side filler estimate while typing / speaking. */
export function countFillersLocal(text: string): number {
  const re =
    /\b(um+|uh+|like|you know|sort of|kind of|basically|actually|literally|right\?|i mean)\b/gi
  return (text.match(re) || []).length
}

/** Prefer spoken_text for TTS; fall back to display text. */
export function spokenQuestionLine(q: MockQuestion | null | undefined): string {
  if (!q) return ''
  return (q.spoken_text || q.text || '').trim()
}
