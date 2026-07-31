/** Job Search product client — localhost by default. */

import { resolveCopilotHttpBase } from '@/lib/api-base'

const TRACKER_KEY = 'ip_jobsearch_tracker_v1'

function apiBase(): string {
  return resolveCopilotHttpBase()
}

function apiUrl(path: string): string {
  const base = apiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

export type JobSearchProfile = {
  name?: string
  target_title?: string
  summary?: string
  skills: string[]
  experience?: string[]
  location?: string
  remote_ok?: boolean
  resume_text?: string
  has_resume?: boolean
}

export type RankedJob = {
  id: string
  title: string
  company: string
  location?: string
  remote?: boolean
  work_mode?: string
  country?: string
  url?: string
  apply_url?: string
  apply_kind?: string
  linkedin_url?: string
  google_url?: string
  indeed_url?: string
  is_linkedin?: boolean
  is_synthetic?: boolean
  product_label?: 'live' | 'practice' | string
  skills?: string[]
  seniority?: string
  source?: string
  scores?: Record<string, number>
  verdict?: string
  gap_skills?: string[]
  skill_hits?: number
  skill_required?: number
  text?: string
}

export type NextStep = {
  id: string
  order: number
  title: string
  status: string
  detail: string
  cta?: string
  suggested_jobs?: Array<{
    id?: string
    title?: string
    company?: string
    apply_url?: string
    score?: number
    is_synthetic?: boolean
  }>
  gaps?: string[]
}

export type PipelineTick = {
  stage: string
  ms?: number
  jobs?: number
  ranked?: number
  live?: number
  seed?: number
  queries?: number
  sources?: string[]
}

export type JobSearchRunResult = {
  ok: boolean
  product?: {
    name?: string
    version?: string
    mode?: string
    honesty?: string
  }
  localhost_lab?: boolean
  filters?: Record<string, unknown>
  stages?: Record<string, unknown>
  agents: Record<string, unknown>
  next_steps?: {
    steps?: NextStep[]
    headline?: string
    has_resume?: boolean
    live_count?: number
    market_thin?: boolean
    warnings?: string[]
  }
  ranked_jobs: RankedJob[]
  meta?: Record<string, unknown>
  pipeline?: PipelineTick[]
  warnings?: string[]
}

export type AppStatus =
  | 'shortlisted'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'skipped'

export type TrackedApplication = {
  job_id: string
  title: string
  company: string
  apply_url?: string
  status: AppStatus
  updated_at: string
  score?: number
  is_synthetic?: boolean
}

export async function jobsearchHealth(): Promise<{
  ok: boolean
  lab_enabled?: boolean
  enabled?: boolean
  product?: string
  version?: string
  honesty?: string
  agents?: string[]
  stages?: string[]
  connectivity?: Record<string, { ok?: boolean; sample?: number; error?: string }>
  api_base?: string
  error?: string
}> {
  const url = apiUrl('/api/jobsearch/health')
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      return {
        ok: false,
        api_base: apiBase() || '(same-origin)',
        error: `HTTP ${res.status} from ${url}`,
      }
    }
    const data = await res.json()
    return { ...data, api_base: apiBase() || '(same-origin via Vite proxy)' }
  } catch (e) {
    return {
      ok: false,
      api_base: apiBase() || '(same-origin)',
      error: `${(e as Error).message || 'Failed to fetch'} — tried ${url}. Start: cd src && python copilot_api.py`,
    }
  }
}

export async function runJobSearch(input: {
  profile: JobSearchProfile
  use_live?: boolean
  remote?: 'all' | 'remote' | 'hybrid' | 'onsite'
  location?: string
  exclude_linkedin?: boolean
  /** Opt-in synthetic practice market (default off in product mode) */
  include_seed?: boolean
  limit?: number
  min_score?: number
}): Promise<JobSearchRunResult> {
  const url = apiUrl('/api/jobsearch/run')
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: input.profile,
        use_live: input.use_live ?? true,
        remote: input.remote ?? 'all',
        location: input.location ?? 'all',
        exclude_linkedin: input.exclude_linkedin ?? false,
        include_seed: input.include_seed ?? false,
        limit: input.limit ?? 200,
        min_score: input.min_score ?? 0,
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (e) {
    throw new Error(
      `Failed to fetch ${url}. Is the API running?\n` +
        `  cd C:\\Users\\King2\\Desktop\\Astra\\src\n` +
        `  .\\venv\\Scripts\\python.exe copilot_api.py\n` +
        `(${(e as Error).message})`,
    )
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Job search failed (${res.status}) at ${url}`)
  }
  return res.json()
}

export function isJobSearchLabHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0') {
    return true
  }
  if (/^192\.168\.\d+\.\d+$/.test(h) || /^10\.\d+\.\d+\.\d+$/.test(h)) {
    return true
  }
  return false
}

export function loadTracker(): TrackedApplication[] {
  try {
    const raw = localStorage.getItem(TRACKER_KEY)
    if (!raw) return []
    const j = JSON.parse(raw)
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

export function saveTracker(rows: TrackedApplication[]) {
  try {
    localStorage.setItem(TRACKER_KEY, JSON.stringify(rows.slice(0, 200)))
  } catch {
    /* ignore */
  }
}

export function upsertTracked(
  job: RankedJob,
  status: AppStatus,
  existing: TrackedApplication[],
): TrackedApplication[] {
  const next = existing.filter((r) => r.job_id !== job.id)
  next.unshift({
    job_id: job.id,
    title: job.title,
    company: job.company,
    apply_url: job.apply_url || job.url,
    status,
    updated_at: new Date().toISOString(),
    score: job.scores?.ensemble,
    is_synthetic: Boolean(job.is_synthetic),
  })
  saveTracker(next)
  return next
}

export function resolveApplyUrl(j: RankedJob, preferNonLinkedIn = true): string {
  if (j.is_synthetic) {
    const q = encodeURIComponent(`${j.title} ${j.company}`.replace(/\([^)]*\)/g, '').trim())
    return preferNonLinkedIn
      ? `https://www.indeed.com/jobs?q=${q}&l=United+States`
      : `https://www.linkedin.com/jobs/search/?keywords=${q}`
  }
  const direct =
    j.apply_url && !j.apply_url.includes('example.com') ? j.apply_url : ''
  if (direct && !(preferNonLinkedIn && direct.includes('linkedin.com'))) {
    return direct
  }
  if (j.url && !j.url.includes('example.com') && !j.url.includes('linkedin.com')) {
    return j.url
  }
  if (preferNonLinkedIn && j.indeed_url) return j.indeed_url
  if (preferNonLinkedIn && j.google_url) return j.google_url
  if (j.linkedin_url) return j.linkedin_url
  const q = encodeURIComponent(`${j.title} ${j.company}`)
  return preferNonLinkedIn
    ? `https://www.indeed.com/jobs?q=${q}&l=United+States`
    : `https://www.linkedin.com/jobs/search/?keywords=${q}`
}

export function extractSkillsFromResume(text: string): string[] {
  const known = [
    'sap', 'fico', 's4hana', 's/4hana', 'abap', 'vertex', 'tax', 'controlling',
    'python', 'typescript', 'javascript', 'react', 'node', 'java', 'kotlin',
    'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'sql', 'postgresql',
    'fastapi', 'django', 'spring', 'llm', 'pytorch', 'tensorflow', 'kafka',
    'terraform', 'ci/cd', 'graphql', 'rest', 'excel', 'power bi',
  ]
  const low = (text || '').toLowerCase()
  const found = known.filter((k) => low.includes(k.replace('/', '')))
  const caps = (text || '').match(/\b[A-Z][A-Za-z0-9+#/]{2,12}\b/g) || []
  for (const c of caps.slice(0, 40)) {
    const t = c.toLowerCase()
    if (t.length >= 3 && !found.includes(t)) found.push(t)
  }
  return found.slice(0, 24)
}

export function isSyntheticJob(j: RankedJob): boolean {
  return Boolean(
    j.is_synthetic ||
      j.product_label === 'practice' ||
      j.source === 'seed_market' ||
      j.source === 'seed',
  )
}
