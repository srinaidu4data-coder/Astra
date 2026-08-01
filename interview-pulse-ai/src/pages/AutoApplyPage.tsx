/**
 * Auto Apply product surface — AIApply.co–inspired workflow (original UI).
 *
 * Flow (matches public AIApply product pattern, not their code/brand):
 *  1. Profile + criteria
 *  2. Find high-match roles
 *  3. Tailor resume + cover letter per role
 *  4. Auto-apply campaign (open URLs + track)
 *  5. Live activity feed (Applying / Applied / Pending)
 *
 * Honest: opens employer apply pages in your browser; does not silent-POST
 * third-party ATS credentials.
 */

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  isJobSearchLabHost,
  isSyntheticJob,
  jobsearchHealth,
  loadStrictSoft,
  loadTracker,
  logAutoApplyStep,
  planAutoApply,
  runJobSearch,
  oneClickAutoApply,
  runNexusPipeline,
  saveStrictSoft,
  upsertTracked,
  type AutoApplyCampaign,
  type AutoApplyStep,
  type AppStatus,
  type NexusResult,
  type OneClickResult,
  type RankedJob,
  type TrackedApplication,
} from '@/services/jobsearch'
import { ApplyTrustPanel } from '@/modules/jobs'
import { StrictSoftToggle } from '@/pages/JobPlaybooks'
import { looksLikeBinaryGarbage, sanitizeResumeText } from '@/services/parser'
import { useAppStore } from '@/stores/app-store'
import { cn, companyInitials } from '@/lib/utils'
import {
  Briefcase,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
  UploadCloud,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// v2: empty skills by default (v1 kept demo skills forever)
const PREFS_KEY = 'ip_auto_apply_prefs_v2'

type Prefs = {
  title: string
  skills: string
  location: 'us' | 'all'
  remote: 'all' | 'remote'
  dailyBudget: number
  excludeLinkedIn: boolean
  delayMs: number
}

function loadPrefs(): Prefs {
  const defaults: Prefs = {
    title: 'Software Engineer',
    skills: '',
    location: 'us',
    remote: 'all',
    dailyBudget: 15,
    excludeLinkedIn: false,
    delayMs: 2500,
  }
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'),
    }
  } catch {
    return defaults
  }
}

function statusTone(st?: string) {
  if (st === 'applied') return 'text-[#5DD5E3]'
  if (st === 'opened' || st === 'applying') return 'text-[#E8C547]'
  if (st === 'failed') return 'text-[#E85D5D]'
  return 'text-white/40'
}

export type AutoApplyPageProps = {
  /** When embedded in Job Search hub */
  embedded?: boolean
  seedJobs?: RankedJob[]
  seedTitle?: string
  seedSkills?: string
  seedResume?: string
  seedEmail?: string
  seedPhone?: string
  onSwitchSearch?: () => void
  /** Parent Search trust result — show truth on Apply tab */
  seedOneClickResult?: OneClickResult | null
  /** Prefer parent Search → Apply lifecycle (single car) */
  onApplyLifecycle?: () => void
}

export function AutoApplyPage({
  embedded = false,
  seedJobs,
  seedTitle,
  seedSkills,
  seedResume,
  seedEmail,
  seedPhone,
  onSwitchSearch,
  seedOneClickResult,
  onApplyLifecycle,
}: AutoApplyPageProps = {}) {
  const lab = isJobSearchLabHost()
  const user = useAppStore((s) => s.user)
  const setRoute = useAppStore((s) => s.setRoute)
  // Select stable documents ref — never .filter() inside the selector (React 19
  // useSyncExternalStore infinite loop if getSnapshot returns a new array each time).
  const documents = useAppStore((s) => s.documents)
  const resumeDocs = useMemo(
    () => (documents || []).filter((d) => d.type === 'resume'),
    [documents],
  )
  const resumeTextStore = sanitizeResumeText(
    seedResume || resumeDocs[0]?.text || '',
  )

  const [prefs, setPrefs] = useState<Prefs>(() => {
    const base = loadPrefs()
    if (seedTitle) base.title = seedTitle
    if (seedSkills) base.skills = seedSkills
    return base
  })
  const [resumeText, setResumeText] = useState(() => resumeTextStore)
  const [apiOk, setApiOk] = useState(false)
  const [busyFind, setBusyFind] = useState(false)
  const [busyPlan, setBusyPlan] = useState(false)
  const [jobs, setJobs] = useState<RankedJob[]>(() => seedJobs || [])
  const [campaign, setCampaign] = useState<AutoApplyCampaign | null>(null)
  const [steps, setSteps] = useState<AutoApplyStep[]>([])
  const [running, setRunning] = useState(false)
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [tracker, setTracker] = useState<TrackedApplication[]>(() => loadTracker())
  // Embedded + seeded shortlist: collapse criteria — continue from Search, not restart
  const [prefsOpen, setPrefsOpen] = useState(() => {
    const hasSeed = Boolean(seedJobs?.length)
    const hasMail = Boolean(seedEmail || user?.email)
    return !(embedded && hasSeed && hasMail)
  })
  const stopRef = useRef(false)
  const [staged, setStaged] = useState<NexusResult | null>(null)
  const [stagedBusy, setStagedBusy] = useState(false)
  const [applyMode, setApplyMode] = useState<'dry_run' | 'campaign'>('campaign')
  const [minScore, setMinScore] = useState(55)
  const [oneClickBusy, setOneClickBusy] = useState(false)
  /** Kit soft ranking — same astra_strict_soft_v1 as Search / playbooks. */
  const [strictSoft, setStrictSoft] = useState(() => loadStrictSoft())
  const setStrictSoftPersist = useCallback((v: boolean) => {
    setStrictSoft(v)
    saveStrictSoft(v)
  }, [])
  const [contactEmail, setContactEmail] = useState(
    seedEmail || user?.email || '',
  )
  const [contactPhone, setContactPhone] = useState(seedPhone || '')

  // Keep seed jobs from parent search in sync
  useEffect(() => {
    if (seedJobs && seedJobs.length) setJobs(seedJobs)
  }, [seedJobs])

  useEffect(() => {
    if (!seedTitle) return
    setPrefs((p) => (p.title === seedTitle ? p : { ...p, title: seedTitle }))
  }, [seedTitle])

  useEffect(() => {
    if (!seedSkills) return
    setPrefs((p) => (p.skills === seedSkills ? p : { ...p, skills: seedSkills }))
  }, [seedSkills])

  useEffect(() => {
    if (!seedResume) return
    setResumeText(sanitizeResumeText(seedResume))
  }, [seedResume])

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* ignore */
    }
  }, [prefs])

  // Drop binary if user pastes / store hydrates junk; hydrate clean store when empty
  useEffect(() => {
    if (resumeText && looksLikeBinaryGarbage(resumeText)) {
      setResumeText('')
      setErr('Resume text was unreadable (broken DOCX). Paste plain text or re-upload PDF.')
      return
    }
    if (resumeTextStore && !resumeText) setResumeText(resumeTextStore)
  }, [resumeTextStore, resumeText])

  useEffect(() => {
    if (!lab) return
    const ping = () => {
      void jobsearchHealth().then((h) => setApiOk(Boolean(h.ok)))
    }
    ping()
    const t = window.setInterval(ping, 30_000)
    return () => window.clearInterval(t)
  }, [lab])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (seedEmail) setContactEmail(seedEmail)
  }, [seedEmail])
  useEffect(() => {
    if (seedPhone) setContactPhone(seedPhone)
  }, [seedPhone])

  const profile = useMemo(
    () => ({
      name: user?.name || user?.email || 'Candidate',
      target_title: prefs.title.trim() || 'Software Engineer',
      skills: prefs.skills
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      summary: '',
      resume_text: sanitizeResumeText(resumeText).slice(0, 8000) || undefined,
      has_resume: Boolean(sanitizeResumeText(resumeText)),
      email: contactEmail.trim() || user?.email || undefined,
      phone: contactPhone.trim() || undefined,
    }),
    [user, prefs.title, prefs.skills, resumeText, contactEmail, contactPhone],
  )

  const appliedToday = useMemo(() => {
    const day = new Date().toISOString().slice(0, 10)
    return tracker.filter(
      (t) => t.status === 'applied' && (t.updated_at || '').startsWith(day),
    ).length
  }, [tracker])

  const findMatches = async (): Promise<RankedJob[]> => {
    if (!apiOk) {
      setErr('API offline. Start START_JOBSEARCH_LAB.bat')
      return []
    }
    setBusyFind(true)
    setErr(null)
    try {
      const data = await runJobSearch({
        profile,
        use_live: true,
        remote: prefs.remote,
        location: prefs.location,
        exclude_linkedin: prefs.excludeLinkedIn,
        include_seed: false,
        limit: 80,
        min_score: 0,
      })
      const live = (data.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
      setJobs(live)
      setToast(`Found ${live.length} high-match live roles`)
      if (!live.length) {
        setErr('No live matches. Broaden location or allow LinkedIn.')
      }
      return live
    } catch (e) {
      setErr((e as Error).message || 'Search failed')
      return []
    } finally {
      setBusyFind(false)
    }
  }

  const runLifecycleFromStudio = async () => {
    if (!contactEmail.trim()) {
      setErr('Add email under Your criteria first.')
      setPrefsOpen(true)
      return
    }
    if (!apiOk) {
      setErr('API offline. Start START_JOBSEARCH_LAB.bat')
      return
    }
    setErr(null)
    let live = jobs.filter((j) => !isSyntheticJob(j))
    if (!live.length) {
      setToast('Finding jobs…')
      live = await findMatches()
    }
    if (!live.length) return
    setOneClickBusy(true)
    setToast(`Auto applying to top ${Math.min(prefs.dailyBudget, 4)}…`)
    try {
      const r = await oneClickAutoApply({
        profile: {
          ...profile,
          email: contactEmail.trim() || profile.email || undefined,
          phone: contactPhone.trim() || undefined,
        },
        jobs: live,
        min_score: 0,
        budget: Math.min(prefs.dailyBudget, 4),
        submit: true,
        headless: true,
        // Tailor RT materials (inject-aligned cover + forged resume) — match one_click default
        forge: true,
        strict_gate: false,
        strict_soft: strictSoft,
      })
      if (!r.ok) {
        setErr(r.message || r.error || 'One-click failed')
        return
      }
      const softNote =
        r.strict_soft === false
          ? ' · soft-before-cold'
          : r.strict_soft === true
            ? ' · cold-before-soft'
            : ''
      const kitId = r.summary?.kit_id ?? 0
      const kitSoft = r.summary?.kit_soft ?? 0
      const kitNote =
        (kitId > 0 ? ` · ${kitId} id kit` : '') +
        (kitSoft > 0 ? ` · ${kitSoft} soft ⚠` : '')
      setToast(
        (r.message ||
          `Submitted ${r.summary?.submitted ?? 0} · filled ${r.summary?.filled ?? 0}` +
            (r.summary?.opened_manual ? ` · opened ${r.summary.opened_manual}` : '')) +
          softNote +
          kitNote,
      )
      for (const row of r.browser?.results || []) {
        if (
          row.submitted ||
          row.status === 'filled' ||
          row.status === 'opened_manual'
        ) {
          markApplied({
            id: String(row.job_id || ''),
            title: row.title || '',
            company: row.company || '',
            apply_url: row.url,
          })
        }
      }
    } finally {
      setOneClickBusy(false)
    }
  }

  const buildCampaign = async () => {
    if (!jobs.length) {
      setErr('Find matches first')
      return
    }
    setBusyPlan(true)
    setErr(null)
    try {
      const plan = await planAutoApply({
        profile,
        jobs,
        budget: prefs.dailyBudget,
        delay_ms: prefs.delayMs,
        include_prepare: true,
        forge: true,
      })
      if (!plan.ok) {
        setErr(plan.error || 'Campaign plan failed')
        return
      }
      setCampaign(plan)
      setSteps((plan.steps || []).map((s) => ({ ...s, status: 'pending' })))
      setIdx(0)
      setPrefsOpen(false)
      setToast(`Campaign ready · ${plan.stats?.steps ?? 0} auto-applies queued`)
    } catch (e) {
      setErr((e as Error).message || 'Plan failed')
    } finally {
      setBusyPlan(false)
    }
  }

  /** Staged apply: quality gate + 6 stages + dry-run or campaign */
  const runStagedApply = async () => {
    if (!jobs.length) {
      setErr('Find matches first — Need a shortlist first')
      return
    }
    setStagedBusy(true)
    setErr(null)
    try {
      const res = await runNexusPipeline({
        profile,
        jobs,
        min_score: minScore,
        min_grade: 'D',
        budget: prefs.dailyBudget,
        forge: true,
        mode: applyMode,
        delay_ms: prefs.delayMs,
      })
      if (!res.ok) {
        setErr(res.error || 'Staged apply failed')
        return
      }
      setStaged(res)
      // Promote campaign steps into live feed when campaign mode
      const stepsFrom =
        res.apply_campaign?.steps ||
        (res.materials || []).map((m, i) => ({
          step: i + 1,
          job_id: m.job_id,
          title: m.title,
          company: m.company,
          apply_url: m.apply_url,
          cover_note: m.cover_note,
          forged_resume: m.forged_resume,
          keyword_inject: m.keyword_inject,
          status: 'pending' as const,
          ensemble_fit: m.nexus_score,
        }))
      if (applyMode === 'campaign' && stepsFrom.length) {
        setCampaign(
          (res.apply_campaign as AutoApplyCampaign) || {
            ok: true,
            steps: stepsFrom,
            stats: { steps: stepsFrom.length },
          },
        )
        setSteps(stepsFrom.map((s) => ({ ...s, status: s.status || 'pending' })))
        setPrefsOpen(false)
      }
      setToast(
        `Pipeline · ${res.stats?.passed_gate ?? 0} passed gate` +
          ` · ${res.stats?.skipped ?? 0} skipped` +
          ` · ${res.stats?.materials ?? 0} packets` +
          (res.elapsed_ms ? ` · ${Math.round(res.elapsed_ms)}ms` : '') +
          (applyMode === 'dry_run' ? ' · dry-run' : ''),
      )
    } catch (e) {
      setErr((e as Error).message || 'Staged apply failed')
    } finally {
      setStagedBusy(false)
    }
  }

  const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

  const markApplied = useCallback((job: RankedJob) => {
    setTracker((prev) => upsertTracked(job, 'applied' as AppStatus, prev))
  }, [])

  const runCampaign = async () => {
    if (!steps.length || !campaign) return
    setRunning(true)
    stopRef.current = false
    setToast('Auto Apply running… finish any employer form fields if shown')
    const campaignId = campaign.campaign_id || campaign.request_id || 'local'
    const next = [...steps]

    for (let i = 0; i < next.length; i++) {
      if (stopRef.current) break
      setIdx(i)
      const step = next[i]!
      next[i] = { ...step, status: 'applying' }
      setSteps([...next])

      const paste = [step.subject_line, '', step.cover_note, '', ...(step.star_bullets || [])]
        .filter(Boolean)
        .join('\n')
      try {
        if (paste) await navigator.clipboard.writeText(paste)
      } catch {
        /* ignore */
      }

      const url = step.apply_url || ''
      if (url) window.open(url, '_blank', 'noopener,noreferrer')

      next[i] = { ...next[i]!, status: 'applied' }
      setSteps([...next])

      const job: RankedJob = {
        id: String(step.job_id || ''),
        title: step.title || '',
        company: step.company || '',
        apply_url: url,
        scores: { ensemble: Number(step.ensemble_fit ?? 0) },
      }
      markApplied(job)
      void logAutoApplyStep({
        campaign_id: campaignId,
        job_id: String(step.job_id || ''),
        status: 'applied',
      })

      if (i < next.length - 1 && !stopRef.current) {
        await sleep(step.delay_ms_after ?? prefs.delayMs)
      }
    }

    setRunning(false)
    const n = next.filter((s) => s.status === 'applied').length
    setToast(`Done · ${n} applications processed`)
  }

  if (!lab) {
    return (
      <div className="rounded-2xl border border-white/10 p-8 text-center text-white/50">
        Auto Apply is available on localhost lab only.
      </div>
    )
  }

  const hasSeededShortlist = embedded && jobs.length > 0

  return (
    <div className={cn('jobs-result-enter flex flex-col gap-4', embedded ? '' : 'mx-auto max-w-6xl pb-10')}>
      {/* Enterprise campaign command surface */}
      <header className="jobs-command jobs-command-primary overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 md:p-6">
          <div className="max-w-xl">
            <h2 className="text-[22px] font-semibold tracking-tight text-white/95">
              Apply
              {jobs.length > 0 && (
                <span className="ml-2 text-[14px] font-normal text-white/40">
                  · {jobs.length} ready
                </span>
              )}
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-white/40">
              {hasSeededShortlist
                ? 'Uses roles from Search (checkboxes there). Confirm claims → form-fill → trust log. LinkedIn often stays manual.'
                : 'Prefer Search first: Search → pick roles → Apply selected. Or find roles here. Email required.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="jobs-primary-cta font-semibold"
                disabled={!apiOk || busyFind || oneClickBusy}
                onClick={() =>
                  onApplyLifecycle
                    ? onApplyLifecycle()
                    : void runLifecycleFromStudio()
                }
                data-testid="studio-lifecycle"
              >
                {busyFind || oneClickBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                {busyFind
                  ? 'Finding…'
                  : oneClickBusy
                    ? 'Applying…'
                    : jobs.length
                      ? 'Apply top matches'
                      : 'Find & apply'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!jobs.length || busyPlan}
                onClick={() => void buildCampaign()}
              >
                {busyPlan ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Open links only
              </Button>
              {(embedded || onSwitchSearch) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => (onSwitchSearch ? onSwitchSearch() : setRoute('jobsearch'))}
                >
                  <Radar className="h-3.5 w-3.5" />
                  Back to Search
                </Button>
              )}
              <StrictSoftToggle
                strictSoft={strictSoft}
                onChange={setStrictSoftPersist}
                className="!py-1.5"
              />
            </div>
            {jobs.length > 0 && !contactEmail.trim() && (
              <p className="mt-2 text-[11px] text-[#E8C547]">
                Add email under Your criteria — required for form fill.
              </p>
            )}
            {hasSeededShortlist && contactEmail.trim() && (
              <p className="mt-2 text-[11px] text-[#5DD5E3]/80">
                Shortlist + contact imported from Search — ready to apply.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[200px]">
            <StatCard label="Live matches" value={String(jobs.length)} />
            <StatCard label="Queued" value={String(steps.length)} />
            <StatCard label="Applied today" value={String(appliedToday)} accent />
            <StatCard
              label="API"
              value={apiOk ? 'Online' : 'Offline'}
              tone={apiOk ? 'ok' : 'bad'}
            />
          </div>
        </div>
      </header>

      {err && (
        <div className="rounded-2xl border border-[#E85D5D]/35 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
          {err}
        </div>
      )}
      {toast && (
        <div className="rounded-2xl border border-[#20B8CD]/30 bg-[#20B8CD]/10 px-4 py-2.5 text-[13px] text-[#5DD5E3]">
          {toast}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Preferences — AIApply step 1–2 */}
        <aside className="glass space-y-4 rounded-[24px] p-4 md:p-5">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setPrefsOpen((v) => !v)}
          >
            <span className="flex items-center gap-2 text-[14px] font-semibold text-white/90">
              <Settings2 className="h-4 w-4 text-[#B8A6FF]" />
              Your criteria
            </span>
            <span className="text-[11px] text-white/35">{prefsOpen ? 'Hide' : 'Show'}</span>
          </button>

          {prefsOpen && (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                  Target role
                </span>
                <input
                  value={prefs.title}
                  onChange={(e) => setPrefs((p) => ({ ...p, title: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-[13px] text-white/90 outline-none focus:border-[#7C5CFF]/40"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                  Email * (for form fill)
                </span>
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  type="email"
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-[13px] text-white/90 outline-none focus:border-[#7C5CFF]/40"
                  placeholder="you@email.com"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                  Phone
                </span>
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-[13px] text-white/90 outline-none focus:border-[#7C5CFF]/40"
                  placeholder="+1 555…"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                  Skills
                </span>
                <input
                  value={prefs.skills}
                  onChange={(e) => setPrefs((p) => ({ ...p, skills: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-[13px] text-white/90 outline-none focus:border-[#7C5CFF]/40"
                  placeholder="python, sap, fico…"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                    Location
                  </span>
                  <select
                    value={prefs.location}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, location: e.target.value as Prefs['location'] }))
                    }
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
                  >
                    <option value="us">United States</option>
                    <option value="all">Anywhere</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                    Work mode
                  </span>
                  <select
                    value={prefs.remote}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, remote: e.target.value as Prefs['remote'] }))
                    }
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
                  >
                    <option value="all">All</option>
                    <option value="remote">Remote</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                  Daily auto-apply budget
                </span>
                <select
                  value={prefs.dailyBudget}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, dailyBudget: Number(e.target.value) }))
                  }
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
                >
                  {[5, 10, 15, 20, 25].map((n) => (
                    <option key={n} value={n}>
                      {n} applications / day
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                    Min score
                  </span>
                  <select
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
                  >
                    {[45, 55, 65, 75].map((n) => (
                      <option key={n} value={n}>
                        {n}+
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/35">
                    Apply mode
                  </span>
                  <select
                    value={applyMode}
                    onChange={(e) =>
                      setApplyMode(e.target.value as 'dry_run' | 'campaign')
                    }
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
                  >
                    <option value="campaign">Live (fill + open)</option>
                    <option value="dry_run">Dry-run (plan only)</option>
                  </select>
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-white/55">
                <input
                  type="checkbox"
                  checked={prefs.excludeLinkedIn}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, excludeLinkedIn: e.target.checked }))
                  }
                  className="accent-[#7C5CFF]"
                />
                Exclude LinkedIn guest results
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/35">
                  <UploadCloud className="h-3 w-3" /> Resume text
                </span>
                <textarea
                  value={
                    looksLikeBinaryGarbage(resumeText) ? '' : resumeText
                  }
                  onChange={(e) => {
                    const v = e.target.value
                    if (looksLikeBinaryGarbage(v)) {
                      setResumeText('')
                      setErr(
                        'That paste looks like a broken Word file. Paste plain text or re-upload PDF.',
                      )
                      return
                    }
                    setResumeText(v)
                  }}
                  rows={6}
                  placeholder="Paste resume as plain text — or re-upload PDF/DOCX on Search (not raw .docx bytes)"
                  className="w-full resize-y rounded-xl border border-white/[0.08] bg-black/30 p-3 text-[11px] leading-relaxed text-white/70 outline-none focus:border-[#7C5CFF]/40"
                />
                {looksLikeBinaryGarbage(resumeText) && (
                  <p className="mt-1 text-[11px] text-[#E85D5D]">
                    Binary resume cleared — re-upload as PDF or paste text.
                  </p>
                )}
              </label>
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                disabled={!jobs.length || stagedBusy || !apiOk}
                onClick={() => void runStagedApply()}
              >
                {stagedBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Run staged apply ({applyMode === 'dry_run' ? 'dry-run' : 'live'})
              </Button>
            </div>
          )}

          {/* How it works */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-white/30">
              How Apply works
            </div>
            <ol className="space-y-2 text-[11px] text-white/50">
              <li className="flex gap-2">
                <span className="text-[#B8A6FF]">1</span> Upload resume & set criteria
              </li>
              <li className="flex gap-2">
                <span className="text-[#B8A6FF]">2</span> AI finds high-match live roles
              </li>
              <li className="flex gap-2">
                <span className="text-[#B8A6FF]">3</span> Tailors resume + cover letter each
              </li>
              <li className="flex gap-2">
                <span className="text-[#B8A6FF]">4</span> Fills forms when ATS allows; you finish login walls
              </li>
            </ol>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex flex-col gap-4">
          {/* Activity feed — AIApply "Applying now" aesthetic */}
          <section className="glass overflow-hidden rounded-[24px]">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 md:px-5">
              <Zap className={cn('h-4 w-4 text-[#E8C547]', running && 'animate-pulse')} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-white/95">Apply pipeline</h2>
                <p className="text-[11px] text-white/40">
                  {running
                    ? `Applying ${Math.min(idx + 1, steps.length)} / ${steps.length}…`
                    : steps.length
                      ? `${steps.filter((s) => s.status === 'applied').length} applied · ${steps.filter((s) => s.status === 'pending').length} pending`
                      : 'Build a campaign to start the feed'}
                </p>
              </div>
              {steps.length > 0 && !running && (
                <Button size="sm" className="font-semibold" onClick={() => void runCampaign()}>
                  <Play className="h-3.5 w-3.5" />
                  Start Auto Apply
                </Button>
              )}
              {running && (
                <Button size="sm" variant="secondary" onClick={() => { stopRef.current = true }}>
                  <Pause className="h-3.5 w-3.5" />
                  Pause
                </Button>
              )}
              {campaign && !running && (
                <Button size="sm" variant="ghost" onClick={() => void buildCampaign()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rebuild
                </Button>
              )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {!steps.length && (
                <div className="px-6 py-12 text-center">
                  <Briefcase className="mx-auto h-8 w-8 text-white/20" />
                  <p className="mt-3 text-[14px] text-white/50">
                    {hasSeededShortlist
                      ? 'Shortlist from Search ready — press Apply top matches (same claim sheet + trust log).'
                      : 'No campaign yet. Prefer Search → pick roles → Apply selected, or find roles here.'}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {hasSeededShortlist ? (
                      <Button
                        size="sm"
                        className="jobs-primary-cta font-semibold"
                        disabled={!apiOk || oneClickBusy}
                        onClick={() =>
                          onApplyLifecycle
                            ? onApplyLifecycle()
                            : void runLifecycleFromStudio()
                        }
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Apply top matches
                      </Button>
                    ) : (
                      <>
                        {(embedded || onSwitchSearch) && (
                          <Button
                            size="sm"
                            className="jobs-primary-cta font-semibold"
                            onClick={() =>
                              onSwitchSearch ? onSwitchSearch() : setRoute('jobsearch')
                            }
                          >
                            <Radar className="h-3.5 w-3.5" />
                            Go to Search
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!apiOk || busyFind || oneClickBusy}
                          onClick={() => void runLifecycleFromStudio()}
                        >
                          <Zap className="h-3.5 w-3.5" />
                          Find &amp; apply here
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {steps.map((s, i) => (
                <div
                  key={String(s.job_id) + i}
                  className={cn(
                    'flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition',
                    running && i === idx && 'bg-[#E8C547]/08',
                    s.status === 'applied' && 'bg-[#20B8CD]/05',
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[11px] font-semibold text-[#B8A6FF]">
                    {companyInitials(s.company || '')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-white/90">{s.title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-white/40">
                      <span>{s.company}</span>
                      {s.ensemble_fit != null && (
                        <span className="text-white/25">· fit {s.ensemble_fit}</span>
                      )}
                      {s.forge_score != null && (
                        <span className="text-[#B8A6FF]/80">· forge {s.forge_score}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn('text-[11px] font-medium capitalize', statusTone(s.status))}>
                      {s.status === 'applying'
                        ? 'Applying now…'
                        : s.status === 'applied'
                          ? 'Applied'
                          : s.status === 'pending'
                            ? 'Pending'
                            : s.status}
                    </span>
                    {s.apply_url && (
                      <a
                        href={s.apply_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] text-white/30 hover:text-[#5DD5E3]"
                      >
                        <ExternalLink className="h-3 w-3" /> open
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {campaign?.honesty && (
              <p className="border-t border-white/[0.05] px-4 py-2.5 text-[10px] leading-relaxed text-white/25">
                {campaign.honesty}
              </p>
            )}
          </section>

          {/* Staged apply results (API: nexus pipeline, product name: Apply stages) */}
          {staged && (
            <section className="glass overflow-hidden rounded-[24px] border border-[#7C5CFF]/30">
              <div className="border-b border-white/[0.06] bg-gradient-to-r from-[#7C5CFF]/15 to-transparent px-4 py-3">
                <h2 className="text-[14px] font-semibold text-white/95">
                  Pipeline · {staged.codename || 'pipeline'}
                </h2>
                <p className="text-[11px] text-white/40">
                  Passed {staged.stats?.passed_gate ?? 0} · Skipped {staged.stats?.skipped ?? 0} · A
                  grades {staged.stats?.grade_A ?? 0} · mode {staged.mode}
                </p>
              </div>
              {!!staged.skipped?.length && (
                <div className="border-b border-white/[0.05] px-4 py-2 text-[11px] text-white/40">
                  <span className="text-white/55">Skip examples: </span>
                  {staged.skipped.slice(0, 3).map((s) => (
                    <span key={String(s.job_id)} className="mr-2">
                      {s.title} ({(s.skip_reasons || []).join(',')})
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-48 overflow-y-auto">
                {(staged.materials || []).slice(0, 8).map((m) => (
                  <div
                    key={String(m.job_id)}
                    className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2 text-[12px]"
                  >
                    <span className="rounded bg-[#7C5CFF]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#B8A6FF]">
                      {m.nexus_grade || '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-white/85">
                      {m.title} · {m.company}
                    </span>
                    <span className="tabular-nums text-[#5DD5E3]">{m.nexus_score_5 ?? m.nexus_score}</span>
                  </div>
                ))}
              </div>
              {staged.autofill_profile?.fields && (
                <div className="border-t border-white/[0.05] px-4 py-2 text-[10px] text-white/35">
                  Autofill pack ready ({staged.autofill_profile.schema}) — used when pasting into ATS
                  forms
                </div>
              )}
              <p className="px-4 py-2 text-[10px] text-white/25">{staged.honesty}</p>
            </section>
          )}

          {/* Match board */}
          {jobs.length > 0 && (
            <section className="glass rounded-[24px] p-4 md:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-white/90">
                  High-match roles
                  <span className="ml-2 font-normal text-white/35">{jobs.length}</span>
                </h2>
                <Badge tone="emerald">live boards</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {jobs.slice(0, 8).map((j) => (
                  <div
                    key={j.id}
                    className="rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2.5"
                  >
                    <div className="truncate text-[13px] font-medium text-white/90">{j.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
                      <span className="inline-flex items-center gap-1">
                        <Briefcase className="h-3 w-3 opacity-50" />
                        {j.company}
                      </span>
                      {j.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3 opacity-50" />
                          {j.location}
                        </span>
                      )}
                      <span className="tabular-nums text-[#5DD5E3]">
                        {j.scores?.ensemble ?? '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Materials preview for current / first step */}
          {steps[running ? idx : 0]?.cover_note && (
            <section className="glass rounded-[24px] p-4 md:p-5">
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#5DD5E3]" />
                <h2 className="text-[14px] font-semibold text-white/90">
                  Tailored materials
                  <span className="ml-2 font-normal text-white/35">
                    {(steps[running ? idx : 0] || {}).title}
                  </span>
                </h2>
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/40 p-3 text-[11px] leading-relaxed text-white/55">
                {(steps[running ? idx : 0] || {}).cover_note}
              </pre>
              {!!(steps[running ? idx : 0] || {}).keyword_inject?.length && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {((steps[running ? idx : 0] || {}).keyword_inject || []).map((k) => (
                    <span
                      key={k}
                      className="rounded-md bg-[#E8C547]/12 px-2 py-0.5 text-[10px] text-[#E8C547]"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Trust log from parent Search lifecycle (single car truth surface) */}
          {seedOneClickResult && (
            <ApplyTrustPanel
              res={seedOneClickResult}
              title="Apply trust log"
              honesty={seedOneClickResult.honesty}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
  tone,
}: {
  label: string
  value: string
  accent?: boolean
  tone?: 'ok' | 'bad'
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.08] bg-black/30 px-3 py-2.5',
        accent && 'border-[#20B8CD]/30',
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[16px] font-semibold tabular-nums text-white/90',
          tone === 'ok' && 'text-[#5DD5E3]',
          tone === 'bad' && 'text-[#E85D5D]',
          accent && 'text-[#5DD5E3]',
        )}
      >
        {value}
      </div>
    </div>
  )
}
