/** Company Twin Interview Sprint API client */

import { authHeaders } from '@/services/auth'
import { resolveCopilotHttpBase } from '@/lib/api-base'

const API = () => resolveCopilotHttpBase()

export type InterviewStage =
  | 'recruiter'
  | 'hiring_manager'
  | 'technical'
  | 'behavioral'
  | 'case_study'
  | 'panel'
  | 'executive'
  | 'final'

export type Opportunity = {
  id: number
  company: string
  role: string
  job_description: string
  resume_text: string
  interview_stage: string
  interview_at?: string | null
  timezone: string
  duration_minutes?: number | null
  interviewers: Array<Record<string, string>>
  concerns: string[]
  answer_tone: string
  answer_length: string
  status: string
  readiness_score?: number | null
  has_diagnostic: boolean
  has_dossier: boolean
  created_at?: string | null
}

export type Diagnostic = {
  match_score: number
  likely_questions: string[]
  gaps: string[]
  supported_highlights?: string[]
  answer_preview: string
  estimated_prep_hours: number
  paid_unlocks: string[]
  disclaimer: string
  generated_at: string
}

export type ProductPublic = {
  code: string
  name: string
  description: string
  price_cents: number
  price_display: string
  billing_mode: string
  features: string[]
  purchasable: boolean
  live_minutes: number
  duration_hours: number | null
  max_opportunities: number
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return j?.detail?.error?.message || j?.detail || j?.message || res.statusText
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function fetchEntitlements(): Promise<{
  paid_access: boolean
  live_minutes_remaining: number
  max_opportunities: number
  plan_code: string
  features: Record<string, boolean>
  products: ProductPublic[]
  active_entitlements: Array<Record<string, unknown>>
}> {
  const res = await fetch(`${API()}/v1/sprint/entitlements`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function fetchProducts(): Promise<{
  products: ProductPublic[]
  stripe_configured: boolean
}> {
  const res = await fetch(`${API()}/v1/billing/products`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listOpportunities(): Promise<Opportunity[]> {
  const res = await fetch(`${API()}/v1/sprint/opportunities`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createOpportunity(body: Partial<Opportunity> & {
  interviewers?: Array<Record<string, string>>
  concerns?: string[]
}): Promise<Opportunity> {
  const res = await fetch(`${API()}/v1/sprint/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateOpportunity(
  id: number,
  body: Partial<Opportunity> & {
    interviewers?: Array<Record<string, string>>
    concerns?: string[]
  },
): Promise<Opportunity> {
  const res = await fetch(`${API()}/v1/sprint/opportunities/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function runDiagnostic(input: {
  opportunity_id?: number
  company?: string
  role?: string
  job_description?: string
  resume_text?: string
  interview_stage?: InterviewStage
  source?: string
}): Promise<{
  opportunity_id?: number
  diagnostic: Diagnostic
  entitlements: Record<string, unknown>
}> {
  const res = await fetch(`${API()}/v1/sprint/diagnostic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function generateDossier(oppId: number): Promise<{
  opportunity_id: number
  dossier: Record<string, unknown>
}> {
  const res = await fetch(`${API()}/v1/sprint/opportunities/${oppId}/dossier`, {
    method: 'POST',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function fetchMockPlan(oppId: number): Promise<{
  questions: Array<{ id: string; text: string; spoken_text?: string; probability?: number }>
  intro_script: string
  closing_script: string
  job_title: string
  persona: string
  difficulty: string
  focus: string
}> {
  const res = await fetch(`${API()}/v1/sprint/opportunities/${oppId}/mock-plan`, {
    method: 'POST',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function fetchLiveContext(oppId: number): Promise<{
  opportunity_id: number
  role: string
  company: string
  job_description: string
  resume_text: string
  verified_stories: Array<Record<string, unknown>>
  live_minutes_remaining: number
}> {
  const res = await fetch(`${API()}/v1/sprint/opportunities/${oppId}/live-context`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listStories(oppId: number): Promise<
  Array<{
    id: number
    title: string
    situation: string
    task: string
    actions: string
    result: string
    status: string
    confidence: number
    missing_details: string
    metrics: string
  }>
> {
  const res = await fetch(`${API()}/v1/sprint/opportunities/${oppId}/stories`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateStory(
  storyId: number,
  body: { status?: string; result?: string; metrics?: string; task?: string; actions?: string },
): Promise<{ id: number; status: string }> {
  const res = await fetch(`${API()}/v1/sprint/stories/${storyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function startProductCheckout(
  productCode: string,
  opportunityId?: number,
): Promise<string> {
  const res = await fetch(`${API()}/v1/billing/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      product_code: productCode,
      opportunity_id: opportunityId ?? null,
    }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  const data = (await res.json()) as { url: string }
  return data.url
}

export async function trackSprintEvent(
  event: string,
  extra?: Record<string, string>,
): Promise<void> {
  try {
    await fetch(`${API()}/v1/sprint/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ event, ...extra }),
    })
  } catch {
    /* non-blocking */
  }
}

export async function submitDebrief(input: {
  opportunity_id: number
  kind?: 'mock' | 'live'
  turns: Array<{ question: string; answer: string; scores?: Record<string, unknown> }>
  readiness_before?: number
}): Promise<{ session_id: number; debrief: Record<string, unknown> }> {
  const res = await fetch(`${API()}/v1/sprint/debrief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function consumeLiveMinutes(
  minutes: number,
  opportunityId?: number,
): Promise<{ ok: boolean; remaining: number }> {
  const res = await fetch(`${API()}/v1/sprint/live-minutes/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ minutes, opportunity_id: opportunityId ?? null }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function fetchReadinessReport(): Promise<{
  overall_readiness: number
  improvement_points: number
  completed_practice_sessions: number
  skill_categories: string[]
  anonymous_badge: string
  referral_code: string
  referral_link: string
  policy: string
}> {
  const res = await fetch(`${API()}/v1/sprint/readiness-report`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function exportSprintAccount(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API()}/v1/sprint/account/export`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteSprintAccountData(): Promise<{
  ok: boolean
  deleted: Record<string, number>
}> {
  const res = await fetch(`${API()}/v1/sprint/account/data`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function claimReferral(code: string): Promise<{ ok: boolean; bonus_live_minutes: number }> {
  const res = await fetch(`${API()}/v1/sprint/referral/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}
