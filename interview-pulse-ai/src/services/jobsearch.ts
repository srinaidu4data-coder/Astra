/** Job Search product client — localhost by default. */

import { resolveCopilotHttpBase } from '@/lib/api-base'
import { sanitizeResumeText } from '@/services/parser'

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
  /** e.g. Sri_Naidu_SAP.docx — used to derive first/last name for autofill */
  resume_filename?: string
  email?: string
  phone?: string
  linkedin_url?: string
  portfolio_url?: string
  years_experience?: string
  work_authorization?: string
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
  request_id?: string
  product?: {
    name?: string
    version?: string
    grade?: string
    mode?: string
    honesty?: string
  }
  localhost_lab?: boolean
  cache?: {
    status?: string
    fingerprint?: string
    served_from_cache?: boolean
  }
  enterprise?: {
    grade?: string
    request_id?: string
    fingerprint?: string
    circuit_breakers?: Record<string, unknown>
  }
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

export type JobSearchHealth = {
  ok: boolean
  lab_enabled?: boolean
  enabled?: boolean
  product?: string
  version?: string
  grade?: string
  honesty?: string
  agents?: string[]
  stages?: string[]
  connectivity?: Record<string, { ok?: boolean; sample?: number; error?: string }>
  enterprise?: {
    grade?: string
    schema?: string
    capabilities?: string[]
    cache?: {
      entries?: number
      hit_rate?: number
      hits?: number
      misses?: number
    }
    slo?: { ready?: boolean; open_breakers?: string[] }
    open_breakers?: string[]
    uptime_sec?: number
  }
  readiness?: { ready?: boolean; status?: string }
  request_id?: string
  api_base?: string
  error?: string
}

export async function jobsearchHealth(): Promise<JobSearchHealth> {
  const url = apiUrl('/api/jobsearch/health')
  try {
    const res = await fetch(url, {
      // Health must fail fast so UI doesn't hang "Checking…"
      signal: AbortSignal.timeout(4_000),
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
      error: `${(e as Error).message || 'Failed to fetch'} — tried ${url}. Start: cd src && python copilot_api.py (or START_JOBSEARCH_LAB.bat)`,
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
  bypass_cache?: boolean
}): Promise<JobSearchRunResult> {
  const url = apiUrl('/api/jobsearch/run')
  const requestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `fe-${crypto.randomUUID().slice(0, 12)}`
      : `fe-${Date.now().toString(36)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        profile: input.profile,
        use_live: input.use_live ?? true,
        remote: input.remote ?? 'all',
        location: input.location ?? 'all',
        exclude_linkedin: input.exclude_linkedin ?? false,
        include_seed: input.include_seed ?? false,
        limit: input.limit ?? 200,
        min_score: input.min_score ?? 0,
        bypass_cache: input.bypass_cache ?? false,
      }),
      // Latency budget: boards should finish well under this
      signal: AbortSignal.timeout(45_000),
    })
  } catch (e) {
    throw new Error(
      `Failed to fetch ${url}. Is the API running?\n` +
        `  Use START_JOBSEARCH_LAB.bat (supervised API auto-restarts)\n` +
        `  or: cd src && .\\venv\\Scripts\\python.exe -m jobsearch.supervisor\n` +
        `(${(e as Error).message})`,
    )
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    if (res.status === 429) {
      throw new Error('Rate limited — wait a few seconds and retry.')
    }
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

// ── AI Apply Studio (human-in-the-loop) ────────────────────────────────────

export type ApplyPacket = {
  job_id?: string
  title?: string
  company?: string
  source?: string
  is_synthetic?: boolean
  apply_url?: string
  ensemble_fit?: number
  apply_priority?: number
  p_response_proxy?: number
  expected_value?: number
  readiness?: number
  action?: string
  action_label?: string
  cover_note?: string
  star_bullets?: string[]
  subject_line?: string
  keyword_inject?: string[]
  /** Tailor RT / form-pack forged resume when prepared from Apply Kit */
  forged_resume?: string
  jd_keywords?: string[]
  checklist?: Array<{ id: string; label: string; done: boolean }>
  ats?: {
    coverage?: number
    hits?: string[]
    missing?: string[]
  }
  queue_rank?: number
  plackett_luce_mass?: number
  honesty?: string
}

export type ApplyQueueResult = {
  ok: boolean
  request_id?: string
  version?: string
  mode?: string
  honesty?: string
  budget?: number
  secretary_threshold?: number
  stats?: {
    input_jobs?: number
    live_jobs?: number
    practice_excluded?: number
    queued?: number
    ready_to_apply?: number
    mean_priority?: number
  }
  math_stack?: string[]
  queue?: ApplyPacket[]
  packets?: ApplyPacket[]
  elapsed_ms?: number
  error?: string
}

function profilePayload(profile: JobSearchProfile) {
  // Never send OOXML/binary garbage to the API (broken DOCX parse)
  const resume = sanitizeResumeText(profile.resume_text)
  const summaryRaw = String(profile.summary || '').trim()
  const summaryClean = sanitizeResumeText(summaryRaw) || (
    summaryRaw &&
    !/^PK/.test(summaryRaw) &&
    !/\[Content_Types\]/i.test(summaryRaw)
      ? summaryRaw
      : undefined
  )

  return {
    name: profile.name,
    target_title: profile.target_title,
    summary: summaryClean,
    skills: profile.skills || [],
    resume_text: resume || undefined,
    has_resume: Boolean(resume),
    resume_filename: profile.resume_filename,
    email: profile.email,
    phone: profile.phone,
    linkedin_url: profile.linkedin_url,
    portfolio_url: profile.portfolio_url,
    location: profile.location,
    years_experience: profile.years_experience,
    work_authorization: profile.work_authorization,
  }
}

function jobPayload(j: RankedJob) {
  return {
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    source: j.source,
    url: j.url,
    apply_url: j.apply_url,
    indeed_url: j.indeed_url,
    linkedin_url: j.linkedin_url,
    skills: j.skills || [],
    text: j.text,
    scores: j.scores,
    is_synthetic: Boolean(j.is_synthetic),
    product_label: j.product_label,
    gap_skills: j.gap_skills || [],
  }
}

export async function buildApplyQueue(input: {
  profile: JobSearchProfile
  jobs: RankedJob[]
  budget?: number
}): Promise<ApplyQueueResult> {
  const url = apiUrl('/api/jobsearch/apply/queue')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        jobs: input.jobs.map(jobPayload),
        budget: input.budget ?? 8,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Apply queue failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function prepareApplyPacket(input: {
  profile: JobSearchProfile
  job: RankedJob
  /** Multi-pack Apply Kit — URL-matched pack preferred over generic prepare */
  form_store?: ExtensionStoreResult | null
  /** Default true: use kit pack cover/resume when page URL matches */
  prefer_form_store?: boolean
  /** Precomputed pick (batch sequential apply) — skips re-scan */
  form_store_pick?: FormStorePick | null
  /** Shared pick cache across a multi-job run */
  pick_cache?: FormStorePickCache | null
}): Promise<{
  ok: boolean
  packet?: ApplyPacket
  error?: string
  form_pack_match?: FormPackMatch
  source?: 'form_store' | 'prepare_api'
}> {
  const pageUrl = String(
    input.job?.apply_url || input.job?.url || input.job?.linkedin_url || '',
  ).trim()
  const preferKit = input.prefer_form_store !== false
  const store =
    input.form_store !== undefined
      ? input.form_store
      : input.pick_cache?.store !== undefined
        ? input.pick_cache.store
        : preferKit
          ? loadStoredFormPack()
          : null
  /** Soft kit pick blocked by strict_soft — still report match meta after prepare_api */
  let softSkippedMatch: FormPackMatch | null = null
  if (preferKit) {
    const pick =
      input.form_store_pick !== undefined
        ? input.form_store_pick
        : input.pick_cache
          ? input.pick_cache.pick(pageUrl)
          : store
            ? pickFormStorePackForUrl(store, pageUrl)
            : null
    // strict_soft (store flag, default true): soft same-board packs must not
    // supply cover/resume — fall through to prepare API for cold materials.
    const storeStrict =
      store && typeof store === 'object' && 'strict_soft' in store
        ? store.strict_soft !== false
        : loadStrictSoft()
    if (pick && (pick.cover_note || pick.tailored_resume)) {
      if (allowKitFillFromPick(pick, storeStrict)) {
        return {
          ok: true,
          source: 'form_store',
          form_pack_match: {
            reason: pick.reason,
            score: pick.score,
            job_id: pick.job_id,
            title: pick.title,
            id_token: pick.id_token,
            match_kind: pick.match_kind || (pick.id_token ? 'id' : 'soft'),
            preferred: 'form_store_pack',
          },
          packet: {
            job_id: String(input.job?.id || pick.job_id || ''),
            title: input.job?.title || pick.title || '',
            company: input.job?.company || '',
            apply_url: pageUrl || pick.apply_url,
            cover_note: pick.cover_note,
            keyword_inject: pick.keyword_inject,
            forged_resume: pick.tailored_resume,
            honesty: 'Materials from URL-matched Apply Kit pack (skipped generic prepare).',
          },
        }
      }
      // Soft sibling under strict — cold prepare, but surface soft_skipped for UI
      softSkippedMatch = {
        reason: pick.reason || 'url',
        score: pick.score,
        job_id: pick.job_id,
        title: pick.title,
        id_token: pick.id_token === true,
        match_kind: 'soft',
        preferred: 'strict_soft_skip',
        soft_skipped: true,
      }
    }
  }

  const url = apiUrl('/api/jobsearch/apply/prepare')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        job: jobPayload(input.job),
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Prepare failed (${res.status})`)
    }
    const data = await res.json()
    return {
      ...data,
      source: 'prepare_api' as const,
      ...(softSkippedMatch
        ? {
            form_pack_match: softSkippedMatch,
            // Honesty for studio / toast when soft kit was detected but not used
            packet: data?.packet
              ? {
                  ...data.packet,
                  honesty:
                    (data.packet.honesty ? `${data.packet.honesty} ` : '') +
                    'Soft same-board kit match skipped (strict soft) — cold prepare materials.',
                }
              : data?.packet,
          }
        : {}),
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function confirmApply(input: {
  job_id: string
  status?: AppStatus | string
  note?: string
}): Promise<{ ok: boolean; message?: string }> {
  const url = apiUrl('/api/jobsearch/apply/confirm')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: input.job_id,
        status: input.status || 'applied',
        note: input.note,
      }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return res.json()
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ── Marvel Apply (SOTA multi-engine + Resume Forge) ───────────────────────

export type MarvelResult = {
  ok: boolean
  request_id?: string
  version?: string
  codename?: string
  mode?: string
  auto_submit?: boolean
  honesty?: string
  engines?: string[]
  control?: {
    kalman_response_prior?: number
    pid_suggested_budget?: number
    requested_budget?: number
  }
  stats?: {
    input_jobs?: number
    live_jobs?: number
    marvel_ranked?: number
    queued?: number
    forged?: number
    pareto_count?: number
    ising_selected?: number
  }
  ranked_jobs?: RankedJob[]
  queue?: Array<
    ApplyPacket & {
      resume_forge?: {
        scalar_score?: number
        ats_after?: number
        ats_lift?: number
        injects?: string[]
        forged_resume?: string
        bullets?: string[]
        objectives?: Record<string, number>
      }
    }
  >
  resume_forge?: {
    variants?: Array<{
      job_id?: string
      job_title?: string
      company?: string
      forged_resume?: string
      injects?: string[]
      bullets?: string[]
      scalar_score?: number
      objectives?: Record<string, number>
      ats_after?: { coverage?: number }
    }>
  }
  hero?: {
    packet?: ApplyPacket
    forge?: {
      forged_resume?: string
      scalar_score?: number
      injects?: string[]
      bullets?: string[]
    }
  }
  elapsed_ms?: number
  error?: string
}

export async function runMarvelApply(input: {
  profile: JobSearchProfile
  jobs: RankedJob[]
  budget?: number
  forge_top?: number
  inject_budget?: number
}): Promise<MarvelResult> {
  const url = apiUrl('/api/jobsearch/marvel/run')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        jobs: input.jobs.map(jobPayload),
        budget: input.budget ?? 8,
        forge_top: input.forge_top ?? 5,
        inject_budget: input.inject_budget ?? 8,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Marvel Apply failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function forgeResumeForJob(input: {
  profile: JobSearchProfile
  job: RankedJob
  inject_budget?: number
}): Promise<{ ok: boolean; forge?: MarvelResult['hero'] extends { forge?: infer F } ? F : never; error?: string; message?: string }> {
  const url = apiUrl('/api/jobsearch/marvel/forge')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        job: jobPayload(input.job),
        inject_budget: input.inject_budget ?? 8,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Forge failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── AI Auto Apply campaign ────────────────────────────────────────────────

export type AutoApplyStep = {
  step?: number
  job_id?: string
  title?: string
  company?: string
  source?: string
  apply_url?: string
  ensemble_fit?: number
  apply_priority?: number
  action?: string
  action_label?: string
  cover_note?: string
  star_bullets?: string[]
  subject_line?: string
  keyword_inject?: string[]
  forged_resume?: string
  forge_score?: number
  ats_coverage?: number
  delay_ms_after?: number
  status?: 'pending' | 'opened' | 'applied' | 'skipped' | 'failed' | string
}

export type AutoApplyCampaign = {
  ok: boolean
  request_id?: string
  campaign_id?: string
  version?: string
  mode?: string
  auto_submit_ats?: boolean
  honesty?: string
  budget?: number
  delay_ms?: number
  stats?: {
    input_live?: number
    steps?: number
    skipped?: number
    forged?: number
  }
  steps?: AutoApplyStep[]
  skipped?: Array<{ job_id?: string; title?: string; reason?: string }>
  instructions?: string[]
  elapsed_ms?: number
  error?: string
}

export async function planAutoApply(input: {
  profile: JobSearchProfile
  jobs: RankedJob[]
  budget?: number
  delay_ms?: number
  include_prepare?: boolean
  forge?: boolean
}): Promise<AutoApplyCampaign> {
  const url = apiUrl('/api/jobsearch/apply/auto')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        jobs: input.jobs.map(jobPayload),
        budget: input.budget ?? 10,
        delay_ms: input.delay_ms ?? 2500,
        include_prepare: input.include_prepare ?? true,
        forge: input.forge ?? true,
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Auto Apply plan failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function logAutoApplyStep(input: {
  campaign_id: string
  job_id: string
  status: string
  note?: string
}): Promise<{ ok: boolean }> {
  const url = apiUrl('/api/jobsearch/apply/auto/step')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8_000),
    })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  }
}

// ── Night Scout (search while you sleep) ──────────────────────────────────

export type NightSchedule = {
  id?: string
  name?: string
  enabled?: boolean
  target_title?: string
  skills?: string[]
  resume_text?: string
  location?: string
  remote?: string
  exclude_linkedin?: boolean
  include_seed?: boolean
  limit_jobs?: number
  run_hour_local?: number
  wake_hour_local?: number
  build_apply_plan?: boolean
  next_run_at?: string
  last_run_at?: string
}

export type MorningDigest = {
  ok?: boolean
  ready?: boolean
  count?: number
  tenant_id?: string
  as_of?: string
  runs?: Array<{
    run_id?: string
    finished_at?: string
    job_count?: number
    live_count?: number
    elapsed_ms?: number
    digest?: {
      headline?: string
      target_title?: string
      jobs?: RankedJob[]
      top5?: RankedJob[]
      apply_campaign?: {
        steps?: AutoApplyStep[]
        stats?: Record<string, number>
      }
      warnings?: string[]
    }
  }>
  error?: string
}

const TENANT_KEY = 'ip_night_tenant_v1'

export function getNightTenantId(): string {
  try {
    let t = localStorage.getItem(TENANT_KEY)
    if (!t) {
      t =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? `user-${crypto.randomUUID().slice(0, 12)}`
          : `user-${Date.now().toString(36)}`
      localStorage.setItem(TENANT_KEY, t)
    }
    return t
  } catch {
    return 'local-default'
  }
}

function nightHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-Id': getNightTenantId(),
  }
}

export async function nightHealth(): Promise<{
  ok: boolean
  night_version?: string
  stats?: Record<string, unknown>
  scale?: Record<string, unknown>
}> {
  try {
    const res = await fetch(apiUrl('/api/jobsearch/night/health'), {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return { ok: false }
    return res.json()
  } catch {
    return { ok: false }
  }
}

export async function listNightSchedules(): Promise<{
  ok: boolean
  schedules?: NightSchedule[]
  error?: string
}> {
  try {
    const res = await fetch(apiUrl('/api/jobsearch/night/schedules'), {
      headers: nightHeaders(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function saveNightSchedule(
  schedule: NightSchedule,
): Promise<{ ok: boolean; schedule?: NightSchedule; error?: string }> {
  try {
    const res = await fetch(apiUrl('/api/jobsearch/night/schedules'), {
      method: 'POST',
      headers: nightHeaders(),
      body: JSON.stringify(schedule),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function runNightScheduleNow(
  scheduleId: string,
): Promise<{ ok: boolean; run?: { digest?: MorningDigest['runs'] extends (infer R)[] ? R extends { digest?: infer D } ? D : never : never }; error?: string; result?: { live_count?: number; elapsed_ms?: number } }> {
  try {
    const res = await fetch(apiUrl(`/api/jobsearch/night/schedules/${scheduleId}/run-now`), {
      method: 'POST',
      headers: nightHeaders(),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function fetchMorningDigest(): Promise<MorningDigest> {
  try {
    const res = await fetch(apiUrl('/api/jobsearch/night/morning'), {
      headers: nightHeaders(),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message, ready: false }
  }
}

// ── Astra Apply Nexus (best-of-breed 6-stage) ─────────────────────────────

export type NexusResult = {
  ok: boolean
  request_id?: string
  version?: string
  codename?: string
  mode?: string
  auto_submit_ats?: boolean
  honesty?: string
  inspired_by?: string[]
  warnings?: string[]
  stages?: Record<string, unknown>
  stats?: {
    input_jobs?: number
    passed_gate?: number
    skipped?: number
    materials?: number
    soft_fallback?: boolean
    grade_A?: number
    grade_B?: number
    grade_C?: number
  }
  skipped?: Array<{
    job_id?: string
    title?: string
    skip_reasons?: string[]
    nexus_grade?: string
  }>
  materials?: Array<{
    job_id?: string
    title?: string
    company?: string
    apply_url?: string
    nexus_grade?: string
    nexus_score?: number
    nexus_score_5?: number
    cover_note?: string
    forged_resume?: string
    keyword_inject?: string[]
    star_bullets?: string[]
    qa_bank?: Array<{ q?: string; a?: string }>
    forge_score?: number
    tailor_rt_passed?: boolean
    tailor_rt_grade?: string
  }>
  apply_campaign?: AutoApplyCampaign
  autofill_profile?: {
    schema?: string
    fields?: Record<string, string | boolean>
    common_answers?: Record<string, string>
  }
  elapsed_ms?: number
  error?: string
}

export async function runNexusPipeline(input: {
  profile: JobSearchProfile
  jobs: RankedJob[]
  min_score?: number
  min_grade?: string
  budget?: number
  forge?: boolean
  mode?: 'dry_run' | 'campaign'
  delay_ms?: number
}): Promise<NexusResult> {
  const url = apiUrl('/api/jobsearch/nexus/run')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        jobs: input.jobs.map(jobPayload),
        // Soft defaults: live IR scores often 30–55 — hard 55/D emptied all playbooks
        min_score: input.min_score ?? 0,
        min_grade: input.min_grade ?? 'F',
        budget: input.budget ?? 12,
        forge: input.forge ?? true,
        mode: input.mode ?? 'campaign',
        delay_ms: input.delay_ms ?? 2500,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `Nexus failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function fetchAutofillProfile(
  profile: JobSearchProfile,
): Promise<{ ok: boolean; autofill_profile?: NexusResult['autofill_profile']; error?: string }> {
  const url = apiUrl('/api/jobsearch/nexus/autofill')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profilePayload(profile)),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Single-URL Playwright fill (optional submit). */
export async function browserApplyOne(input: {
  profile: JobSearchProfile
  url: string
  submit?: boolean
  headless?: boolean
  cover_note?: string
  /** Multi-pack Apply Kit; when omitted and use_form_store, reads astra_form_pack_v1 */
  form_store?: ExtensionStoreResult | null
  /** Default true — attach stored Apply Kit so fill URL-matches packs */
  use_form_store?: boolean
  /** Join keys for lab metrics / trust log */
  job_id?: string
  title?: string
  company?: string
}): Promise<{
  ok?: boolean
  status?: string
  submitted?: boolean
  submit_click?: boolean
  filled_fields?: string[]
  error?: string
  url?: string
  ats?: string
  message?: string
  form_pack_match?: FormPackMatch
  form_store_used?: boolean
  form_store_packs?: number
  title?: string
  company?: string
  job_id?: string
  ledger_status?: string
  ledger_bucket?: string
  metrics?: {
    bucket?: string
    raw_status?: string
    deduped?: boolean
    submitted?: boolean
  }
}> {
  const url = apiUrl('/api/jobsearch/apply/browser')
  try {
    if (!input.profile?.email) {
      return { ok: false, error: 'email_required', message: 'Email required for form fill' }
    }
    if (!String(input.url || '').startsWith('http')) {
      return { ok: false, error: 'bad_url', message: 'Need an http(s) apply URL' }
    }
    const useStore = input.use_form_store !== false
    const stored =
      input.form_store !== undefined ? input.form_store : useStore ? loadStoredFormPack() : null
    const formStore =
      stored && stored.ok !== false && (stored.job_packs?.length || stored.base)
        ? stored
        : undefined
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        url: input.url,
        submit: input.submit ?? false,
        headless: input.headless ?? true,
        cover_note: input.cover_note || '',
        job_id: input.job_id || undefined,
        title: input.title || undefined,
        company: input.company || undefined,
        ...(formStore ? { form_store: formStore } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: t || `HTTP ${res.status}`, message: t || `HTTP ${res.status}` }
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message, message: (e as Error).message }
  }
}

/** Which form pack Playwright used for a fill (URL match vs active_id / first). */
export type FormPackMatch = {
  reason?: string
  score?: number
  job_id?: string
  title?: string | null
  /** True when URL match used job-id/path token (not same-board soft slug only) */
  id_token?: boolean
  /** id | soft | active_id | first | base | none */
  match_kind?: string
  /** form_store_pack | step_materials | pack_seed | strict_soft_skip */
  preferred?: string
  /** Soft sibling pack detected but materials not overlaid (strict_soft fill policy) */
  soft_skipped?: boolean
}

/** Human-readable pack match chip for one-click / browser result rows. */
export function formatFormPackMatch(m?: FormPackMatch | null): string | null {
  if (!m || !m.reason) return null
  const kind = String(m.match_kind || '').toLowerCase()
  let reasonBit: string
  if (m.reason === 'url' || kind === 'id' || kind === 'soft') {
    if (kind === 'id' || m.id_token === true) reasonBit = 'URL id match'
    else if (kind === 'soft' || m.id_token === false) reasonBit = 'URL soft match'
    else if (typeof m.score === 'number' && m.score >= 70) reasonBit = 'URL id match'
    else if (typeof m.score === 'number' && m.score > 0) reasonBit = 'URL soft match'
    else reasonBit = 'URL match'
  } else {
    const reasonLabel: Record<string, string> = {
      active_id: 'Active pack',
      first: 'First pack',
      base: 'Base pack',
      none: 'No pack',
    }
    reasonBit = reasonLabel[m.reason] || m.reason
  }
  const bits = [reasonBit]
  if (typeof m.score === 'number' && m.score > 0) bits.push(`score ${m.score}`)
  if (m.title) bits.push(String(m.title))
  else if (m.job_id) bits.push(String(m.job_id))
  if (m.preferred === 'form_store_pack') bits.push('kit pack')
  else if (m.preferred === 'step_materials') bits.push('step materials')
  else if (m.preferred === 'strict_soft_skip' || m.soft_skipped) bits.push('soft skipped')
  return bits.join(' · ')
}

/**
 * Visual severity for Apply Kit pack selection.
 * id = strong job-id/path match; soft = same-board only (warn); weak = active/first/base.
 */
export type KitMatchTone = 'id' | 'soft' | 'weak' | 'none'

export function kitMatchTone(
  m?: {
    reason?: string
    score?: number
    id_token?: boolean
    match_kind?: string
  } | null,
): KitMatchTone {
  if (!m) return 'none'
  const reason = String(m.reason || 'url')
  const kind = String(m.match_kind || '').toLowerCase()
  const idToken = m.id_token
  const score = typeof m.score === 'number' ? m.score : 0
  if (reason === 'url' || kind === 'id' || kind === 'soft') {
    if (kind === 'id' || idToken === true) return 'id'
    if (kind === 'soft' || idToken === false) return 'soft'
    if (score >= 70) return 'id'
    if (score > 0) return 'soft'
    return 'weak'
  }
  if (reason === 'active_id' || reason === 'first' || reason === 'base') return 'weak'
  return 'none'
}

/** Tailwind classes for pack match chips (pipeline + result rows). */
export function kitMatchToneChipClass(tone: KitMatchTone): string {
  switch (tone) {
    case 'id':
      return 'bg-[#20B8CD]/15 text-[#5DD5E3] border border-[#20B8CD]/30'
    case 'soft':
      return 'bg-[#E8C547]/15 text-[#E8C547] border border-[#E8C547]/35'
    case 'weak':
      return 'bg-white/[0.06] text-white/45 border border-white/10'
    default:
      return 'bg-white/[0.04] text-white/35'
  }
}

/** Detail / row accent text color for pipeline steps. */
export function kitMatchToneTextClass(tone: KitMatchTone): string {
  switch (tone) {
    case 'id':
      return 'text-[#5DD5E3]'
    case 'soft':
      return 'text-[#E8C547]'
    case 'weak':
      return 'text-white/45'
    default:
      return 'text-white/35'
  }
}

/** Real one-click browser auto-apply (Playwright fill + optional Submit). */
export type OneClickResult = {
  ok: boolean
  request_id?: string
  version?: string
  mode?: string
  submit?: boolean
  forge?: boolean
  auto_submit_ats?: boolean
  honesty?: string
  error?: string
  message?: string
  /** Whether multi-pack form store was used for URL-matched fill */
  use_form_store?: boolean
  form_store_source?: string | null
  form_store_packs?: number
  /**
   * Kit shortlist policy used server-side.
   * true (default): id → cold → soft. false: id → soft → cold.
   */
  strict_soft?: boolean
  summary?: {
    eligible?: number
    attempted?: number
    filled?: number
    submitted?: number
    opened_manual?: number
    fillable_ats?: number
    acted?: number
    /** Apply Kit URL matches among attempted results */
    kit_matched?: number
    kit_id?: number
    /** Soft same-board pack matches (warn) */
    kit_soft?: number
  }
  /** Tailor RT materials (keyword injects, forged resume flags) for playbook UI */
  materials?: Array<{
    job_id?: string
    title?: string
    company?: string
    apply_url?: string
    keyword_inject?: string[]
    has_cover?: boolean
    has_forged_resume?: boolean
    star_count?: number
    tailor_rt_grade?: string
  }>
  /** Present when Playwright missing or debug payload returns prepared steps */
  steps?: Array<{
    job_id?: string
    title?: string
    company?: string
    apply_url?: string
    cover_note?: string
    forged_resume?: string
    star_bullets?: string[]
    keyword_inject?: string[]
    tailor_rt_passed?: boolean
    tailor_rt_grade?: string
  }>
  browser?: {
    results?: Array<{
      job_id?: string
      title?: string
      company?: string
      url?: string
      status?: string
      submitted?: boolean
      filled_fields?: string[]
      error?: string
      ats?: string
      /** Pack selection for this fill (from materialize_step_profile) */
      form_pack_match?: FormPackMatch
    }>
    filled?: number
    submitted?: number
  }
  nexus_stats?: Record<string, number>
  skipped_gate?: unknown[]
  elapsed_ms?: number
}

/** AI-tailored resume + ATS answers for one job (extension + Playwright). */
export type FormPackResult = {
  ok: boolean
  schema?: string
  version?: string
  job_id?: string
  job?: { id?: string; title?: string; company?: string; apply_url?: string; source?: string }
  fields?: Record<string, unknown>
  label_map?: Record<string, string>
  qa?: Array<{ id?: string; question?: string; answer?: string }>
  cover_note?: string
  tailored_resume?: string
  forge?: {
    injects?: string[]
    ats_before?: unknown
    ats_after?: unknown
    objectives?: unknown
    scalar_score?: number
    tailor_rt_passed?: boolean
    grade?: string
  }
  tailor_rt?: TailorRTResult | null
  honesty?: string
  error?: string
  message?: string
  request_id?: string
  elapsed_ms?: number
}

/**
 * Multi-agent Tailor RT (Analyze → Evidence → Tailor → Validate loop).
 * Research: GARY / ApplyPilot / Tailr / career-ops patterns.
 */
export type TailorRTResult = {
  ok?: boolean
  schema?: string
  version?: string
  passed?: boolean
  ready_for_apply?: boolean
  grade?: string
  overall_score?: number
  forged_resume?: string
  injects?: string[]
  suggestions?: string[]
  strengths?: string[]
  weaknesses?: string[]
  rounds?: Array<{
    round?: number
    overall_score?: number
    passed?: boolean
    grade?: string
    injects?: string[]
  }>
  agents?: {
    jd_analyst?: {
      must_have?: string[]
      nice_to_have?: string[]
      keywords?: string[]
      seniority?: string
    }
    evidence?: {
      supported?: Array<{ requirement?: string; evidence?: string }>
      unsupported_must?: string[]
      coverage_of_must?: number
    }
    validator?: {
      scores?: Record<string, number>
      ats?: { coverage?: number; hits?: string[]; missing?: string[] }
      contact?: { email?: boolean; phone?: boolean; name_ok?: boolean; full_name?: string }
    }
  }
  job?: { id?: string; title?: string; company?: string }
  honesty?: string
  error?: string
  message?: string
  request_id?: string
  elapsed_ms?: number
  count?: number
  passed_n?: number
  results?: TailorRTResult[]
}

export type ExtensionStoreResult = {
  ok: boolean
  schema?: string
  base?: FormPackResult
  job_packs?: FormPackResult[]
  active_job_id?: string
  /** When not false (default true): soft same-board packs must not fill materials */
  strict_soft?: boolean
  export_json?: string
  error?: string
  message?: string
  request_id?: string
  source?: string
}

/** localStorage / extension chrome.storage key for Apply Kit form packs */
export const FORM_PACK_STORAGE_KEY = 'astra_form_pack_v1'

/** One job pack row for Autofill playbook / Apply Kit inject chips UI */
export type FormPackInjectRow = {
  jobId: string
  title: string
  company: string
  injects: string[]
  grade: string | null
  rtPassed: boolean | null
  active: boolean
}

/**
 * Parse astra_form_pack_v1 JSON (localStorage or extension paste).
 * Returns null when missing or not a usable store object.
 */
export function parseStoredFormPack(raw: string | null | undefined): ExtensionStoreResult | null {
  if (!raw || !String(raw).trim()) return null
  try {
    const store = JSON.parse(String(raw)) as ExtensionStoreResult
    if (!store || typeof store !== 'object') return null
    // Accept full extension-store or a lone form pack wrapped as base
    if (store.ok === false && !store.job_packs?.length && !store.base) return null
    return store
  } catch {
    return null
  }
}

/** Read Apply Kit from browser localStorage (Jobs lab writes this on Export). */
export function loadStoredFormPack(): ExtensionStoreResult | null {
  if (typeof localStorage === 'undefined') return null
  try {
    // PII hygiene: expire kits after 7 days
    const metaRaw = localStorage.getItem('astra_form_pack_meta_v1')
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw) as { expiresAt?: number }
        if (meta.expiresAt && Date.now() > meta.expiresAt) {
          localStorage.removeItem(FORM_PACK_STORAGE_KEY)
          localStorage.removeItem('astra_form_pack_meta_v1')
          return null
        }
      } catch {
        /* ignore */
      }
    }
    return parseStoredFormPack(localStorage.getItem(FORM_PACK_STORAGE_KEY))
  } catch {
    return null
  }
}

/**
 * Flatten job_packs into inject/grade rows for playbook + extension UI.
 * Active pack (active_job_id) is sorted first.
 */
export function formPackInjectRows(
  store: ExtensionStoreResult | null | undefined,
  limit = 6,
): FormPackInjectRow[] {
  if (!store?.job_packs?.length) return []
  const activeId = store.active_job_id ? String(store.active_job_id) : ''
  const rows: FormPackInjectRow[] = []
  for (const pack of store.job_packs) {
    if (!pack || pack.ok === false) continue
    const injects = (pack.forge?.injects || pack.tailor_rt?.injects || [])
      .map((k) => String(k || '').trim())
      .filter(Boolean)
      .slice(0, 8)
    const grade =
      pack.forge?.grade ||
      pack.tailor_rt?.grade ||
      (pack.forge?.tailor_rt_passed === true ? 'pass' : null)
    const rt =
      typeof pack.forge?.tailor_rt_passed === 'boolean'
        ? pack.forge.tailor_rt_passed
        : typeof pack.tailor_rt?.passed === 'boolean'
          ? pack.tailor_rt.passed
          : null
    const jobId = String(pack.job_id || pack.job?.id || '')
    rows.push({
      jobId,
      title: pack.job?.title || jobId || 'Job pack',
      company: pack.job?.company || '',
      injects,
      grade: grade ? String(grade) : null,
      rtPassed: rt,
      active: Boolean(activeId && jobId && activeId === jobId),
    })
  }
  rows.sort((a, b) => Number(b.active) - Number(a.active))
  return rows.slice(0, limit)
}

/** Result of URL-matching one Apply Kit job pack to a page URL. */
export type FormStorePick = {
  job_id: string
  title: string
  apply_url: string
  cover_note: string
  tailored_resume: string
  keyword_inject: string[]
  reason: string
  score: number
  /** Job-id/path token hit (not same-board soft only) */
  id_token?: boolean
  match_kind?: 'id' | 'soft' | string
}

/** Stable cache key for page URLs (host + path, strip www / trailing slash). */
export function normalizeFormStoreUrlKey(pageUrl: string): string {
  const raw = String(pageUrl || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return raw.replace(/\/$/, '')
  }
}

/**
 * Lightweight URL pack picker (mirrors form_pack.score_url_match / select_job_pack_for_page).
 * Used by prepareApplyPacket to prefer kit materials over generic prepare API.
 * When several packs score >= minScore, prefer id-token matches over same-board
 * host+slug soft hits (sibling Greenhouse packs must not cross-fill).
 * When only soft hits qualify, prefer store.active_job_id if it is among them.
 *
 * When opts.forFill is true and store.strict_soft !== false (default), soft-only
 * picks return null so callers cannot use sibling pack materials for fill.
 * Ranking / preindex should omit forFill so soft matches stay visible as warnings.
 */
export function pickFormStorePackForUrl(
  store: ExtensionStoreResult | null | undefined,
  pageUrl: string,
  minScore = 50,
  opts?: { forFill?: boolean },
): FormStorePick | null {
  if (!store?.job_packs?.length || !String(pageUrl || '').trim()) return null
  const page = String(pageUrl).trim().toLowerCase()
  const activeId = store.active_job_id ? String(store.active_job_id).trim() : ''

  const pathTokens = (u: string): string[] => {
    try {
      const raw = u.includes('://') ? u : `https://${u}`
      const url = new URL(raw)
      return url.pathname
        .toLowerCase()
        .split('/')
        .map((s) => s.replace(/\.html$/, ''))
        .filter(
          (s) =>
            s &&
            s.length >= 3 &&
            !['jobs', 'job', 'apply', 'application', 'careers', 'boards', 'en', 'us'].includes(s),
        )
    } catch {
      return []
    }
  }
  const hostOf = (u: string): string => {
    try {
      const raw = u.includes('://') ? u : `https://${u}`
      return new URL(raw).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      return ''
    }
  }
  const isIdToken = (t: string) => /^\d{4,}$/.test(t) || t.length >= 8
  const packJid = (pack: FormPackResult) =>
    String(pack.job_id || pack.job?.id || '').trim()

  const pageHost = hostOf(page)
  const pageTokList = pathTokens(page)
  const pageTok = new Set(pageTokList)
  const pageIds = new Set(pageTokList.filter(isIdToken))

  type Cand = { pack: FormPackResult; score: number; idHit: boolean }
  const scored: Cand[] = []

  for (const pack of store.job_packs) {
    if (!pack || pack.ok === false) continue
    const packUrl = String(pack.job?.apply_url || '').trim()
    const jid = packJid(pack)
    let score = 0
    let idHit = false
    if (jid && jid !== 'base-profile' && page.includes(jid.toLowerCase())) {
      score = Math.max(score, 70)
      idHit = true
    }
    if (packUrl) {
      const ph = hostOf(packUrl)
      const pTok = pathTokens(packUrl)
      const packIds = new Set(pTok.filter(isIdToken))
      if (pageHost && ph && pageHost === ph) score += 40
      else if (pageHost && ph && pageHost.endsWith(ph.split('.').slice(-2).join('.')))
        score += 15
      else if (!page.includes(jid.toLowerCase())) continue
      if (pageTok.size && pTok.length) {
        const shared = pTok.filter((t) => pageTok.has(t))
        const idShared = shared.filter(isIdToken)
        if (idShared.length) {
          score += 55
          idHit = true
        } else if (shared.length) score += Math.min(30, 10 * shared.length)
        // shared numeric/uuid ids between page and pack
        for (const id of packIds) {
          if (pageIds.has(id)) idHit = true
        }
      }
      const last = pTok[pTok.length - 1]
      if (last && page.includes(last)) {
        score += /^\d+$/.test(last) ? 20 : 10
        if (isIdToken(last) || /^\d{4,}$/.test(last)) idHit = true
      }
      try {
        const pagePath = new URL(page.includes('://') ? page : `https://${page}`).pathname
          .toLowerCase()
          .replace(/\/$/, '')
        const packPath = new URL(
          packUrl.includes('://') ? packUrl : `https://${packUrl}`,
        ).pathname
          .toLowerCase()
          .replace(/\/$/, '')
        if (pagePath && packPath && pagePath === packPath) idHit = true
      } catch {
        /* ignore */
      }
    }
    if (score >= minScore) scored.push({ pack, score, idHit })
  }

  if (!scored.length) return null
  const idPool = scored.filter((c) => c.idHit)
  let best: Cand
  if (idPool.length) {
    best = idPool[0]!
    for (const c of idPool) {
      if (c.score > best.score) best = c
    }
  } else {
    // Soft-only: prefer active_job_id among soft hits when set
    const activeSoft = activeId
      ? scored.find((c) => packJid(c.pack) === activeId)
      : undefined
    if (activeSoft) {
      best = activeSoft
    } else {
      best = scored[0]!
      for (const c of scored) {
        if (c.score > best.score) best = c
      }
    }
  }
  const pack = best.pack
  const injects = (pack.forge?.injects || pack.tailor_rt?.injects || [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)
  const idToken = Boolean(best.idHit)
  const pick: FormStorePick = {
    job_id: String(pack.job_id || pack.job?.id || ''),
    title: pack.job?.title || '',
    apply_url: String(pack.job?.apply_url || ''),
    cover_note: String(pack.cover_note || ''),
    tailored_resume: String(pack.tailored_resume || ''),
    keyword_inject: injects,
    reason: 'url',
    score: best.score,
    id_token: idToken,
    match_kind: idToken ? 'id' : 'soft',
  }
  if (opts?.forFill) {
    const strictSoft = store.strict_soft !== false
    if (!allowKitFillFromPick(pick, strictSoft)) return null
  }
  return pick
}

/**
 * Memoize pickFormStorePackForUrl for sequential multi-job apply.
 * Also builds slim single-pack stores so browserApplyOne POSTs stay small.
 * pick() always keeps soft matches for pipeline counts; fill-time soft skip is
 * enforced by store.strict_soft + materialize / allowKitFillFromPick / prepare.
 */
export function createFormStorePickCache(
  store: ExtensionStoreResult | null | undefined,
  minScore = 50,
) {
  const cache = new Map<string, FormStorePick | null>()
  const root = store && store.ok !== false ? store : null
  return {
    store: root,
    get cacheSize() {
      return cache.size
    },
    pick(pageUrl: string): FormStorePick | null {
      if (!root?.job_packs?.length) return null
      const key = normalizeFormStoreUrlKey(pageUrl)
      if (!key) return null
      if (cache.has(key)) return cache.get(key) ?? null
      // Ranking / pipeline: keep soft picks so softMatched counts stay honest
      const hit = pickFormStorePackForUrl(root, pageUrl, minScore)
      cache.set(key, hit)
      return hit
    },
    /**
     * Trim multi-pack kit to the URL-matched pack only (or full store if no match).
     * Avoids re-uploading every tailored resume on each sequential apply POST.
     * Stamps strict_soft so server materialize can skip soft sibling overlays.
     * Caller may overwrite strict_soft with the UI toggle before POST.
     */
    slimStore(pageUrl: string): ExtensionStoreResult | null {
      if (!root) return null
      const hit = this.pick(pageUrl)
      const stamped = root.strict_soft !== false
      if (!hit?.job_id) {
        return { ...root, strict_soft: stamped }
      }
      const pack = (root.job_packs || []).find(
        (p) => p && String(p.job_id || p.job?.id || '') === hit.job_id,
      )
      if (!pack) return { ...root, strict_soft: stamped }
      return {
        ok: true,
        schema: root.schema,
        base: root.base,
        job_packs: [pack],
        active_job_id: hit.job_id,
        strict_soft: stamped,
        source: root.source,
      }
    },
  }
}

export type FormStorePickCache = ReturnType<typeof createFormStorePickCache>

/**
 * Warm pick cache for a batch of apply URLs at sequential-apply start.
 * Returns per-URL picks + match counts for pipeline header UI.
 * idMatched = job-id/path token; softMatched = same-board only (warn).
 */
export function preindexFormStoreUrls(
  cache: FormStorePickCache,
  pageUrls: Array<string | null | undefined>,
): {
  total: number
  withUrl: number
  matched: number
  idMatched: number
  softMatched: number
  kitPacks: number
  picks: Array<FormStorePick | null>
} {
  const kitPacks = cache.store?.job_packs?.length ?? 0
  const picks: Array<FormStorePick | null> = []
  let withUrl = 0
  let matched = 0
  let idMatched = 0
  let softMatched = 0
  for (const raw of pageUrls) {
    const u = String(raw || '').trim()
    if (!u.startsWith('http')) {
      picks.push(null)
      continue
    }
    withUrl++
    const hit = cache.pick(u)
    picks.push(hit)
    if (hit) {
      matched++
      const tone = kitMatchTone(hit)
      if (tone === 'id') idMatched++
      else if (tone === 'soft') softMatched++
    }
  }
  return {
    total: pageUrls.length,
    withUrl,
    matched,
    idMatched,
    softMatched,
    kitPacks,
    picks,
  }
}

/** Compact kit match line for progress / toast (empty if no kit activity). */
export function formatKitMatchCounts(input: {
  matched?: number
  id?: number
  soft?: number
  /** Prefix e.g. "Kit" or "" */
  label?: string
}): string {
  const matched = Number(input.matched || 0)
  const idN = Number(input.id || 0)
  const softN = Number(input.soft || 0)
  if (matched <= 0 && idN <= 0 && softN <= 0) return ''
  const label = input.label === '' ? '' : `${input.label ?? 'Kit'} `
  const total = matched > 0 ? matched : idN + softN
  let s = `${label}${total} match`
  if (idN > 0 || softN > 0) {
    const parts: string[] = []
    if (idN > 0) parts.push(`${idN} id`)
    if (softN > 0) parts.push(`${softN} soft ⚠`)
    s += ` (${parts.join(', ')})`
  }
  return s
}

/** Count id/soft kit tones from browser apply result form_pack_match rows. */
export function countKitTonesFromResults(
  results: Array<{ form_pack_match?: FormPackMatch | null } | null | undefined>,
): { matched: number; id: number; soft: number } {
  let id = 0
  let soft = 0
  for (const r of results || []) {
    const t = kitMatchTone(r?.form_pack_match)
    if (t === 'id') id++
    else if (t === 'soft') soft++
  }
  return { matched: id + soft, id, soft }
}

/**
 * ATS / public-form priority for sequential auto-apply (lower = better).
 * Greenhouse/Lever/Ashby/Freshteam first; LinkedIn/Indeed last.
 */
export function applyPlatformPriority(
  job: Pick<RankedJob, 'apply_url' | 'url'> | { apply_url?: string; url?: string },
): number {
  const u = String(job.apply_url || job.url || '').toLowerCase()
  if (
    u.includes('greenhouse') ||
    u.includes('lever.co') ||
    u.includes('ashby') ||
    u.includes('freshteam')
  )
    return 0
  if (u.includes('workable') || u.includes('bamboohr') || u.includes('smartrecruiters'))
    return 1
  if (u.includes('linkedin') || u.includes('indeed')) return 90
  if (u.includes('workday') || u.includes('icims') || u.includes('oraclecloud')) return 6
  return 2
}

/**
 * Strong kit tier (id/path). Aligns with Python KIT_RANK_MIN_URL_SCORE.
 * Soft same-board fills still use pick min=50.
 */
export const KIT_RANK_MIN_SCORE = 70
/** Soft same-board floor (host+slug). Aligns with Python KIT_SOFT_MIN_URL_SCORE. */
export const KIT_SOFT_MIN_SCORE = 50
/** 0 = id/strong, 1 = soft, 2 = none — raw match strength. */
export const KIT_TIER_ID = 0
export const KIT_TIER_SOFT = 1
export const KIT_TIER_NONE = 2

/**
 * Map kit tier → sort key.
 * strictSoft (default): id → cold/none → soft (avoid soft mis-fill siblings).
 * non-strict: id → soft → none.
 */
export function kitSortTier(tier: number, strictSoft = true): number {
  const t = Number(tier)
  if (!strictSoft) return t
  if (t === KIT_TIER_ID) return 0
  if (t === KIT_TIER_NONE) return 1
  if (t === KIT_TIER_SOFT) return 2
  return t
}

/** Strong kit pick: id_token, match_kind=id, or score >= KIT_RANK_MIN_SCORE (70). */
export function isStrongKitPick(
  pick: { id_token?: boolean; match_kind?: string; score?: number } | null | undefined,
): boolean {
  if (!pick) return false
  if (pick.id_token === true) return true
  if (String(pick.match_kind || '').toLowerCase() === 'id') return true
  if (typeof pick.score === 'number' && pick.score >= KIT_RANK_MIN_SCORE) return true
  return kitMatchTone(pick) === 'id'
}

/**
 * Whether sequential fill may use this Apply Kit pick.
 * strictSoft (default): only strong id/path packs — soft siblings mis-fill.
 */
export function allowKitFillFromPick(
  pick: { id_token?: boolean; match_kind?: string; score?: number } | null | undefined,
  strictSoft = true,
): boolean {
  if (!pick) return false
  if (!strictSoft) return true
  return isStrongKitPick(pick)
}

/**
 * Order jobs for sequential apply budget.
 *
 * When Apply Kit (`formStore`) has job packs:
 *   - strong URL id/path matches first
 *   - strictSoft=true (default): cold before soft same-board (soft packs often
 *     mis-fill sibling listings and must not steal budget)
 *   - strictSoft=false: soft before cold
 * Soft never outranks id. Within a sort tier: ATS priority (stable).
 * Without a kit: pure ATS priority.
 */
export function rankJobsForApply(
  jobs: RankedJob[],
  opts?: {
    formStore?: ExtensionStoreResult | null
    minKitScore?: number
    minSoftScore?: number
    /** Default true — demote soft same-board below cold ATS */
    strictSoft?: boolean
    /** Resolve listing → page URL for kit match (defaults to apply_url || url) */
    resolveUrl?: (job: RankedJob) => string
  },
): RankedJob[] {
  const list = Array.isArray(jobs) ? jobs : []
  if (!list.length) return []
  const store =
    opts?.formStore && opts.formStore.ok !== false ? opts.formStore : null
  const hasKit = Boolean(store?.job_packs?.length)
  const strongMin = opts?.minKitScore ?? KIT_RANK_MIN_SCORE
  const softMin = opts?.minSoftScore ?? KIT_SOFT_MIN_SCORE
  const strictSoft = opts?.strictSoft !== false
  // Soft floor for classification; strength from id_token / score vs strongMin
  const cache = hasKit
    ? createFormStorePickCache(store, Math.min(softMin, strongMin))
    : null
  const resolve =
    opts?.resolveUrl ||
    ((j: RankedJob) => String(j.apply_url || j.url || '').trim())

  const keyed = list.map((job, index) => {
    const url = resolve(job)
    let kitRank = KIT_TIER_NONE
    if (cache && url.startsWith('http')) {
      const pick = cache.pick(url)
      if (pick) {
        const tone = kitMatchTone(pick)
        // Never treat soft host+slug (~50) as strong if minKitScore was lowered
        const strongFloor = Math.max(strongMin, KIT_RANK_MIN_SCORE)
        const strong =
          tone === 'id' ||
          pick.id_token === true ||
          (typeof pick.score === 'number' && pick.score >= strongFloor)
        kitRank = strong ? KIT_TIER_ID : KIT_TIER_SOFT
      }
    }
    return {
      job,
      index,
      kitRank: kitSortTier(kitRank, strictSoft),
      platform: applyPlatformPriority(job),
    }
  })
  keyed.sort((a, b) => {
    if (a.kitRank !== b.kitRank) return a.kitRank - b.kitRank
    if (a.platform !== b.platform) return a.platform - b.platform
    return a.index - b.index
  })
  return keyed.map((k) => k.job)
}

export async function buildFormPack(input: {
  profile: JobSearchProfile
  job?: RankedJob
  forge?: boolean
  use_tailor_rt?: boolean
}): Promise<FormPackResult> {
  const url = apiUrl('/api/jobsearch/apply/form-pack')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        job: input.job ? jobPayload(input.job) : null,
        forge: input.forge ?? true,
        use_tailor_rt: input.use_tailor_rt ?? true,
        inject_budget: 8,
        max_rt_rounds: 3,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `form-pack failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message, message: (e as Error).message }
  }
}

/** Tailor + validate one resume against a job (multi-agent RT loop). */
export async function runTailorRT(input: {
  profile: JobSearchProfile
  job: RankedJob
  max_rounds?: number
}): Promise<TailorRTResult> {
  const url = apiUrl('/api/jobsearch/apply/tailor-rt')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        job: jobPayload(input.job),
        max_rounds: input.max_rounds ?? 3,
        inject_budget: 8,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `tailor-rt failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message, message: (e as Error).message }
  }
}

/** Batch Tailor RT for top shortlist (validator-ranked). */
export async function runTailorRTBatch(input: {
  profile: JobSearchProfile
  jobs: RankedJob[]
  limit?: number
}): Promise<TailorRTResult> {
  const url = apiUrl('/api/jobsearch/apply/tailor-rt/batch')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        jobs: (input.jobs || [])
          .filter((j) => !j.is_synthetic)
          .slice(0, 12)
          .map(jobPayload),
        limit: input.limit ?? 5,
        max_rounds: 2,
        inject_budget: 8,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `tailor-rt batch failed (${res.status})`)
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message, message: (e as Error).message }
  }
}

export async function buildExtensionStore(input: {
  profile: JobSearchProfile
  jobs?: RankedJob[]
  forge_top?: number
  /** Stamp store.strict_soft for Chrome content script (defaults to loadStrictSoft) */
  strict_soft?: boolean
}): Promise<ExtensionStoreResult> {
  const url = apiUrl('/api/jobsearch/apply/extension-store')
  try {
    const jobs = (input.jobs || [])
      .filter((j) => !j.is_synthetic && j.product_label !== 'practice')
      .map(jobPayload)
      .slice(0, 8)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        jobs,
        forge_top: input.forge_top ?? 3,
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `extension-store failed (${res.status})`)
    }
    const store = (await res.json()) as ExtensionStoreResult
    // Ensure Chrome selectPack sees the same policy as Search/one_click
    const strict =
      input.strict_soft !== undefined ? Boolean(input.strict_soft) : loadStrictSoft()
    if (store && store.ok !== false) {
      store.strict_soft = strict
    }
    return store
  } catch (e) {
    return { ok: false, error: (e as Error).message, message: (e as Error).message }
  }
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Persist kit soft-match ranking policy (default true = cold before soft). */
const STRICT_SOFT_KEY = 'astra_strict_soft_v1'

export function loadStrictSoft(): boolean {
  try {
    const v = localStorage.getItem(STRICT_SOFT_KEY)
    if (v == null) return true
    return v !== '0' && v !== 'false'
  } catch {
    return true
  }
}

export function saveStrictSoft(strict: boolean): void {
  try {
    localStorage.setItem(STRICT_SOFT_KEY, strict ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export async function oneClickAutoApply(input: {
  profile: JobSearchProfile
  jobs: RankedJob[]
  min_score?: number
  budget?: number
  submit?: boolean
  headless?: boolean
  forge?: boolean
  /** When false (default), keep shortlist URLs — don't re-filter by grade */
  strict_gate?: boolean
  /** Multi-pack Apply Kit; defaults to astra_form_pack_v1 localStorage when present */
  form_store?: ExtensionStoreResult | null
  /** When true (default), pass form_store / let server synthesize from steps */
  use_form_store?: boolean
  /**
   * Kit ranking: true (default) demotes soft same-board below cold ATS.
   * false = soft before cold. Defaults to loadStrictSoft() when omitted.
   */
  strict_soft?: boolean
}): Promise<OneClickResult> {
  const url = apiUrl('/api/jobsearch/apply/one-click')
  try {
    const jobs = (input.jobs || [])
      .filter((j) => !j.is_synthetic && j.product_label !== 'practice')
      .map(jobPayload)
      .map((j) => ({
        ...j,
        // Ensure apply_url is never empty if url exists
        apply_url: j.apply_url || j.url || j.indeed_url || j.linkedin_url,
      }))
      .filter((j) => String(j.apply_url || '').startsWith('http'))

    if (!jobs.length) {
      return {
        ok: false,
        error: 'no_apply_urls',
        message:
          'No jobs with http apply links. Re-run Search and check Apply buttons open real URLs.',
      }
    }

    if (!input.profile?.email) {
      return {
        ok: false,
        error: 'email_required',
        message: 'Add email under Options → Applicant profile before auto-apply.',
      }
    }

    const useStore = input.use_form_store !== false
    const stored =
      input.form_store !== undefined ? input.form_store : useStore ? loadStoredFormPack() : null
    const formStore =
      stored && stored.ok !== false && (stored.job_packs?.length || stored.base)
        ? stored
        : undefined

    const strictSoft =
      input.strict_soft !== undefined ? Boolean(input.strict_soft) : loadStrictSoft()

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: profilePayload(input.profile),
        jobs,
        min_score: input.min_score ?? 0,
        min_grade: 'F',
        budget: input.budget ?? 4,
        submit: input.submit ?? true,
        headless: input.headless ?? true,
        // Prefer Tailor RT materials (matches backend OneClickRequest / one_click default)
        forge: input.forge ?? true,
        delay_sec: 0.5,
        strict_gate: input.strict_gate ?? false,
        prefer_auto_forms: true,
        use_form_store: useStore,
        // Default true: cold ATS before soft sibling kit packs
        strict_soft: strictSoft,
        ...(formStore ? { form_store: formStore } : {}),
      }),
      // Playwright fill+submit on a few jobs — allow up to 3 min
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      // FastAPI error detail
      try {
        const j = JSON.parse(t)
        const msg = j?.detail?.error?.message || j?.detail || t
        throw new Error(typeof msg === 'string' ? msg : t || `HTTP ${res.status}`)
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.startsWith('{')) throw e
        throw new Error(t || `One-click apply failed (${res.status})`)
      }
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message, message: (e as Error).message }
  }
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

/** CSV export of local application tracker (for spreadsheets / career-ops style tracking). */
export function exportTrackerCsv(rows: TrackedApplication[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = ['status', 'title', 'company', 'score', 'apply_url', 'updated_at', 'job_id']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.status,
        r.title,
        r.company,
        r.score ?? '',
        r.apply_url ?? '',
        r.updated_at ?? '',
        r.job_id,
      ]
        .map(esc)
        .join(','),
    )
  }
  return lines.join('\n')
}

export function downloadTrackerCsv(rows: TrackedApplication[], filename = 'applications.csv') {
  const blob = new Blob([exportTrackerCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Clean board URLs so Apply never ships broken hrefs. */
export function sanitizeUrl(url?: string, fallback = ''): string {
  let u = (url || '').trim()
  if (!u || /^(none|null|n\/a|#)$/i.test(u)) return fallback
  u = u
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
  if (u.startsWith('//')) u = `https:${u}`
  if (u.startsWith('www.')) u = `https://${u}`
  const m = u.match(/linkedin\.com\/jobs\/view\/(\d+)/i)
  if (m) u = `https://www.linkedin.com/jobs/view/${m[1]}/`
  if (!/^https?:\/\//i.test(u)) {
    if (u.includes(':') && !u.startsWith('http')) return fallback
    u = `https://${u.replace(/^\/+/, '')}`
  }
  if (u.includes('example.com')) return fallback
  return u
}

/** True LinkedIn job posting URL (view/ID), not a keyword search. */
export function isLinkedInJobPostUrl(u?: string): boolean {
  if (!u) return false
  const s = sanitizeUrl(u).toLowerCase()
  return (
    s.includes('linkedin.com/jobs/view/') ||
    s.includes('linkedin.com/jobs/collections/') ||
    /linkedin\.com\/.*jobPosting/i.test(s)
  )
}

export function isLinkedInSourcedJob(j: RankedJob): boolean {
  return Boolean(
    j.is_linkedin ||
      j.source === 'linkedin' ||
      isLinkedInJobPostUrl(j.apply_url) ||
      isLinkedInJobPostUrl(j.url),
  )
}

/**
 * Best apply URL.
 * @param preferNonLinkedIn when true (Non-LinkedIn mode), skip LinkedIn apply paths.
 * LinkedIn-sourced postings always use their /jobs/view/ link when LinkedIn is allowed.
 */
export function resolveApplyUrl(j: RankedJob, preferNonLinkedIn = true): string {
  const q = encodeURIComponent(
    `${j.title || ''} ${j.company || ''}`.replace(/\([^)]*\)/g, '').trim(),
  )
  const indeedFallback = `https://www.indeed.com/jobs?q=${q}&l=United+States`
  const liSearchFallback = `https://www.linkedin.com/jobs/search/?keywords=${q}`

  if (j.is_synthetic) {
    return preferNonLinkedIn ? indeedFallback : liSearchFallback
  }

  const apply = sanitizeUrl(j.apply_url)
  const url = sanitizeUrl(j.url)
  const li = sanitizeUrl(j.linkedin_url)
  const indeed = sanitizeUrl(j.indeed_url, indeedFallback)
  const google = sanitizeUrl(j.google_url)

  // LinkedIn harvest rows — always the real job page when LI is allowed
  if (!preferNonLinkedIn && isLinkedInSourcedJob(j)) {
    if (isLinkedInJobPostUrl(apply)) return apply
    if (isLinkedInJobPostUrl(url)) return url
    if (isLinkedInJobPostUrl(li)) return li
    return li || liSearchFallback
  }

  if (apply && !(preferNonLinkedIn && apply.includes('linkedin.com'))) {
    return apply
  }
  if (url && !(preferNonLinkedIn && url.includes('linkedin.com'))) {
    return url
  }
  if (preferNonLinkedIn && indeed) return indeed
  if (preferNonLinkedIn && google) return google
  if (!preferNonLinkedIn && isLinkedInJobPostUrl(li)) return li
  if (!preferNonLinkedIn && li) return li
  return preferNonLinkedIn ? indeedFallback : liSearchFallback
}

/** Best LinkedIn URL for the card button (real post > search). */
export function resolveLinkedInUrl(j: RankedJob): string | null {
  const apply = sanitizeUrl(j.apply_url)
  const url = sanitizeUrl(j.url)
  const li = sanitizeUrl(j.linkedin_url)
  if (isLinkedInJobPostUrl(apply)) return apply
  if (isLinkedInJobPostUrl(url)) return url
  if (isLinkedInJobPostUrl(li)) return li
  if (li) return li
  if (j.title) {
    const q = encodeURIComponent(`${j.title} ${j.company || ''}`.trim())
    return `https://www.linkedin.com/jobs/search/?keywords=${q}`
  }
  return null
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
