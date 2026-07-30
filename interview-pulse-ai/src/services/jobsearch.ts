/** Job Search AI lab client — localhost only. */

import { resolveCopilotHttpBase } from '@/lib/api-base'

const API_BASE = resolveCopilotHttpBase()

export type JobSearchProfile = {
  name?: string
  target_title?: string
  summary?: string
  skills: string[]
  experience?: string[]
  location?: string
  remote_ok?: boolean
}

export type RankedJob = {
  id: string
  title: string
  company: string
  location?: string
  remote?: boolean
  url?: string
  skills?: string[]
  seniority?: string
  source?: string
  scores?: Record<string, number>
  verdict?: string
  gap_skills?: string[]
  skill_hits?: number
  skill_required?: number
}

export type JobSearchRunResult = {
  ok: boolean
  localhost_lab?: boolean
  agents: Record<string, unknown>
  ranked_jobs: RankedJob[]
  meta?: Record<string, unknown>
}

export async function jobsearchHealth(): Promise<{
  ok: boolean
  lab_enabled?: boolean
  agents?: string[]
}> {
  try {
    const res = await fetch(`${API_BASE}/api/jobsearch/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { ok: false }
    return res.json()
  } catch {
    return { ok: false }
  }
}

export async function runJobSearch(input: {
  profile: JobSearchProfile
  use_live?: boolean
}): Promise<JobSearchRunResult> {
  const res = await fetch(`${API_BASE}/api/jobsearch/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: input.profile,
      use_live: input.use_live ?? true,
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Job search failed (${res.status})`)
  }
  return res.json()
}

/** True only on local dev hosts — feature is hidden in production builds on real domains. */
export function isJobSearchLabHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}
