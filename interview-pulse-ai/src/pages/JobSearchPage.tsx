import { Button } from '@/components/ui/button'
import {
  ApplicationsPanel,
  ApplyLegend,
  ApplyTrustPanel,
  HitlClaimGate,
  JobCard,
  JobHubShell,
  JobsCoach,
  hubModeFromHash,
  isPlaybookMode,
  setHubHash,
  useJobLabHealth,
  type ClaimJob,
  type ClaimPreview,
  type CoachPhase,
  type FlowNextAction,
  type FlowStep,
  type JourneyStep,
  type JobHubMode,
} from '@/modules/jobs'
import { fetchApplyMetrics } from '@/services/jobsearch-metrics'
import {
  buildApplyQueue,
  confirmApply,
  extractSkillsFromResume,
  isJobSearchLabHost,
  isLinkedInSourcedJob,
  isSyntheticJob,
  loadTracker,
  browserApplyOne,
  oneClickAutoApply,
  prepareApplyPacket,
  resolveApplyUrl,
  runJobSearch,
  runMarvelApply,
  buildExtensionStore,
  downloadJson,
  downloadTrackerCsv,
  countKitTonesFromResults,
  createFormStorePickCache,
  FORM_PACK_STORAGE_KEY,
  formatFormPackMatch,
  formatKitMatchCounts,
  formPackInjectRows,
  kitMatchTone,
  kitMatchToneChipClass,
  kitMatchToneTextClass,
  allowKitFillFromPick,
  loadStoredFormPack,
  loadStrictSoft,
  preindexFormStoreUrls,
  rankJobsForApply,
  runTailorRTBatch,
  saveStrictSoft,
  upsertTracked,
  type KitMatchTone,
  type OneClickResult,
  type ApplyPacket,
  type ApplyQueueResult,
  type AppStatus,
  type ExtensionStoreResult,
  type JobSearchRunResult,
  type MarvelResult,
  type RankedJob,
  type TailorRTResult,
  type TrackedApplication,
} from '@/services/jobsearch'
import { AutoApplyPage } from '@/pages/AutoApplyPage'
import { ApplyMetricsPage } from '@/pages/ApplyMetricsPage'
import { AutofillPlaybook, StrictSoftToggle } from '@/pages/JobPlaybooks'
import { NightScoutPage } from '@/pages/NightScoutPage'
import { saveFormPackSecure } from '@/services/piiKit'
import {
  isAllowedKnowledgeFile,
  looksLikeBinaryGarbage,
  nameFromResumeFilename,
  parseUploadedFile,
  sanitizeResumeText,
} from '@/services/parser'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  Linkedin,
  Loader2,
  Radar,
  RefreshCw,
  Rocket,
  Search,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type RemoteFilter = 'all' | 'remote' | 'hybrid' | 'onsite'
type SortKey = 'score' | 'title' | 'company' | 'source'
type HubMode = JobHubMode

const STATUS_OPTS: AppStatus[] = [
  'shortlisted',
  'applied',
  'interview',
  'offer',
  'rejected',
  'skipped',
]

// v4: skills/summary no longer ship with baked-in demo defaults (were sticky forever)
const PREFS_KEY = 'ip_jobsearch_prefs_v4'

type LabPrefs = {
  title: string
  skills: string
  summary: string
  remote: RemoteFilter
  locationMode: 'all' | 'us' | 'custom'
  locationCustom: string
  excludeLinkedIn: boolean
  useLive: boolean
  includeSeed: boolean
  minScore: number
  limit: number
  email: string
  phone: string
  linkedinUrl: string
  portfolioUrl: string
  yearsExperience: string
}

function loadPrefs(): Partial<LabPrefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}

function savePrefs(p: LabPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

function ScoreRing({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score || 0))
  const r = 18
  const c = 2 * Math.PI * r
  const off = c - (s / 100) * c
  // Google palette
  const tone =
    s >= 70 ? '#8ab4f8' : s >= 50 ? '#81c995' : s >= 30 ? '#fdd663' : '#5f6368'
  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <svg width="48" height="48" className="-rotate-90">
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="#3c4043"
          strokeWidth="3.5"
        />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-[12px] font-medium tabular-nums text-[#e8eaed]">
        {Math.round(s)}
      </span>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="inline-flex rounded-full border border-[rgba(232,234,237,0.12)] bg-[#131314] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
            value === o.value
              ? 'bg-[#8ab4f8]/20 text-[#8ab4f8]'
              : 'text-[#9aa0a6] hover:bg-[#282a2c] hover:text-[#e8eaed]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * World-class Job Search UX:
 * - Results-first command center (not a 4-step form gauntlet)
 * - Sticky filter bar + collapsible advanced panel
 * - Premium job cards with score ring, monogram, primary Apply
 * - In-list search, sort, source filters
 * - Polished loading overlay (keeps context)
 */
export function JobSearchPage() {
  const user = useAppStore((s) => s.user)
  const documents = useAppStore((s) => s.documents)
  const addDocument = useAppStore((s) => s.addDocument)
  const setActiveJobTitle = useAppStore((s) => s.setActiveJobTitle)
  const setRoute = useAppStore((s) => s.setRoute)
  const settings = useAppStore((s) => s.settings)

  const lab = isJobSearchLabHost()
  const { apiOk, connectivity } = useJobLabHealth(lab)
  const fileRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const prefs = useMemo(() => loadPrefs(), [])

  const resumes = useMemo(
    () => documents.filter((d) => d.type === 'resume'),
    [documents],
  )

  const [resumeId, setResumeId] = useState(resumes[0]?.id || '')
  const [resumeName, setResumeName] = useState(resumes[0]?.name || '')
  // Never seed binary DOCX junk into the form (old broken parse lives in document store)
  const [resumeText, setResumeText] = useState(
    () => sanitizeResumeText(resumes[0]?.text || ''),
  )

  const [title, setTitle] = useState(prefs.title || 'Software Engineer')
  // Empty by default — do not re-inject old demo skills/summary every visit
  const [skills, setSkills] = useState(
    typeof prefs.skills === 'string' ? prefs.skills : '',
  )
  const [summary, setSummary] = useState(
    typeof prefs.summary === 'string' ? prefs.summary : '',
  )
  // Live boards always on for the lab; practice market is the opt-in toggle.
  const useLive = prefs.useLive ?? true
  const [includeSeed, setIncludeSeed] = useState(prefs.includeSeed ?? false)
  const [remote, setRemote] = useState<RemoteFilter>(prefs.remote || 'all')
  const [locationMode, setLocationMode] = useState<'all' | 'us' | 'custom'>(
    prefs.locationMode || 'us',
  )
  const [locationCustom, setLocationCustom] = useState(prefs.locationCustom || '')
  // Include LinkedIn by default for broader discovery; auto-apply still prefers fillable ATS
  const [excludeLinkedIn, setExcludeLinkedIn] = useState(
    prefs.excludeLinkedIn ?? false,
  )
  const [minScore, setMinScore] = useState(prefs.minScore ?? 0)
  const [limit, setLimit] = useState(prefs.limit ?? 200)
  const [email, setEmail] = useState(prefs.email ?? user?.email ?? '')
  const [phone, setPhone] = useState(prefs.phone ?? '')
  const [linkedinUrl, setLinkedinUrl] = useState(prefs.linkedinUrl ?? '')
  const [portfolioUrl, setPortfolioUrl] = useState(prefs.portfolioUrl ?? '')
  const [yearsExperience, setYearsExperience] = useState(prefs.yearsExperience ?? '')

  const [busy, setBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [result, setResult] = useState<JobSearchRunResult | null>(null)
  const [tracker, setTracker] = useState<TrackedApplication[]>(() => loadTracker())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runFingerprint, setRunFingerprint] = useState('')
  const [showPractice, setShowPractice] = useState(false)
  /** Advanced stays closed by default — less noise */
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [queryFilter, setQueryFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'linkedin' | 'freehire' | 'other'>(
    'all',
  )
  // AI Apply Studio + Marvel
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyQueue, setApplyQueue] = useState<ApplyQueueResult | null>(null)
  const [activePacket, setActivePacket] = useState<ApplyPacket | null>(null)
  const [applyBudget, setApplyBudget] = useState(8)
  /** HITL studio panels stay closed until the user opens them — keeps the main path clean */
  const [studioOpen, setStudioOpen] = useState(false)
  const [marvel, setMarvel] = useState<MarvelResult | null>(null)
  const [marvelOpen, setMarvelOpen] = useState(false)
  const [marvelBusy, setMarvelBusy] = useState(false)
  const [marvelResumeText, setMarvelResumeText] = useState('')
  const [tailorRt, setTailorRt] = useState<TailorRTResult | null>(null)
  const [tailorRtOpen, setTailorRtOpen] = useState(false)
  const [tailorRtBusy, setTailorRtBusy] = useState(false)
  // Unified hub: Search + Auto Apply + Night Scout
  // Campaign UI lives on AutoApplyPage (Auto Apply tab) — not duplicated here.
  const [hubMode, setHubMode] = useState<HubMode>(() => hubModeFromHash())
  const [oneClickBusy, setOneClickBusy] = useState(false)
  const [oneClickResult, setOneClickResult] = useState<OneClickResult | null>(null)
  const [oneClickProgress, setOneClickProgress] = useState<string | null>(null)
  /** HITL claim gate before any Submit */
  const [hitlOpen, setHitlOpen] = useState(false)
  const [hitlPreview, setHitlPreview] = useState<ClaimPreview | null>(null)
  const hitlPendingRef = useRef<null | (() => void)>(null)
  const [weeklyCompleted, setWeeklyCompleted] = useState<number | null>(null)
  /** Multi-select for apply — max 4; seeded from top form-friendly after search */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  /** Kit soft ranking: true = cold ATS before soft same-board (default safer). */
  const [strictSoft, setStrictSoft] = useState(() => loadStrictSoft())
  const setStrictSoftPersist = useCallback((v: boolean) => {
    setStrictSoft(v)
    saveStrictSoft(v)
  }, [])
  /** Live pipeline log — each step the engine completes */
  type PipeStep = {
    id: string
    label: string
    detail?: string
    status: 'pending' | 'running' | 'done' | 'error' | 'skip'
    /** Apply Kit match strength for job rows (soft = amber warn) */
    kitTone?: KitMatchTone
  }
  const [pipeSteps, setPipeSteps] = useState<PipeStep[]>([])
  const [kitBusy, setKitBusy] = useState(false)
  /** Last exported Apply Kit (form packs + Tailor RT injects for UI chips) */
  const [applyKit, setApplyKit] = useState<ExtensionStoreResult | null>(() => loadStoredFormPack())
  /** Cancel sequential apply mid-flight */
  const cancelApplyRef = useRef(false)

  /** Upsert pipe step — never silent-no-op if step id is new (fixes race with keepPipe) */
  const setPipe = useCallback((id: string, patch: Partial<PipeStep> & { label?: string }) => {
    setPipeSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx < 0) {
        return [
          ...prev,
          {
            id,
            label: patch.label || id,
            detail: patch.detail,
            status: patch.status || 'pending',
            kitTone: patch.kitTone,
          },
        ]
      }
      return prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    })
  }, [])
  const [playbooksOpen, setPlaybooksOpen] = useState(() => {
    const m = hubModeFromHash()
    return !['search', 'auto', 'night'].includes(m)
  })
  const [toolsOpen, setToolsOpen] = useState(false)

  const hasResume = Boolean(resumeText.trim())
  const hasResults = Boolean(result)
  const effectiveEmail = (email.trim() || user?.email || '').trim()
  const hasEmail = Boolean(effectiveEmail)

  useEffect(() => {
    const onHash = () => {
      const m = hubModeFromHash()
      setHubMode(m)
      if (isPlaybookMode(m)) setPlaybooksOpen(true)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Night Scout → Search handoff (morning digest jobs)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ip_jobsearch_seed_from_night')
      if (!raw) return
      const seed = JSON.parse(raw) as {
        title?: string
        skills?: string
        jobs?: RankedJob[]
      }
      localStorage.removeItem('ip_jobsearch_seed_from_night')
      if (seed.title) setTitle(seed.title)
      if (seed.skills) setSkills(seed.skills)
      const jobs = (seed.jobs || []).filter((j) => j && j.id && j.title)
      if (jobs.length) {
        setResult({
          ok: true,
          agents: {},
          ranked_jobs: jobs,
          meta: {
            live_count: jobs.filter((j) => !isSyntheticJob(j)).length,
            total_returned: jobs.length,
            elapsed_ms: 0,
            note: 'Loaded from Night Scout morning digest',
          },
        })
        setToast(`Loaded ${jobs.length} jobs from Night Scout`)
        setHubMode('search')
      }
    } catch {
      /* ignore bad seed */
    }
  }, [])

  const switchHub = (mode: HubMode) => {
    setHubMode(mode)
    setHubHash(mode)
    if (isPlaybookMode(mode)) setPlaybooksOpen(true)
  }

  /**
   * Rank jobs for auto-apply: Apply Kit URL matches first (when present),
   * then public forms (Greenhouse/Lever…) over LinkedIn.
   */
  const rankForApply = (live: RankedJob[]) => {
    const kit = applyKit || loadStoredFormPack()
    return rankJobsForApply(live, {
      formStore: kit,
      strictSoft,
      resolveUrl: (j) => {
        const raw = String(j.apply_url || j.url || '').trim()
        return raw.startsWith('http') ? raw : resolveApplyUrl(j, excludeLinkedIn)
      },
    })
  }

  const MAX_APPLY_SELECT = 4

  const seedSelectionFromLive = useCallback(
    (live: RankedJob[]) => {
      const pure = live.filter((j) => !isSyntheticJob(j))
      if (!pure.length) {
        setSelectedIds(new Set())
        return
      }
      const top = rankJobsForApply(pure, {
        formStore: applyKit || loadStoredFormPack(),
        strictSoft,
        resolveUrl: (j) => {
          const raw = String(j.apply_url || j.url || '').trim()
          return raw.startsWith('http') ? raw : resolveApplyUrl(j, excludeLinkedIn)
        },
      })
        .slice(0, MAX_APPLY_SELECT)
        .map((j) => j.id)
      setSelectedIds(new Set(top))
    },
    [applyKit, strictSoft, excludeLinkedIn],
  )

  const toggleJobSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_APPLY_SELECT) next.add(id)
      return next
    })
  }, [])

  const applyLikelihood = (j: RankedJob): ClaimJob['likelihood'] => {
    if (isLinkedInSourcedJob(j) || j.is_linkedin) return 'manual'
    const u = String(j.apply_url || j.url || '').toLowerCase()
    if (/myworkdayjobs|workday\.com|linkedin\.com/.test(u)) return 'manual'
    if (
      /greenhouse|lever\.co|ashbyhq|ashby\.com|workable|smartrecruiters|jobvite|bamboohr|freshteam|boards\.eu\.greenhouse/.test(
        u,
      )
    ) {
      return 'form_fill'
    }
    return 'unknown'
  }

  /**
   * Auto-apply with live per-step status (sequential Playwright).
   * Each job updates the pipeline log as soon as it finishes.
   * HITL claim gate runs before any Submit path.
   * Prefer user multi-select; else top form-friendly roles (max 4).
   */
  const runOneClickAutoApply = async (opts?: {
    submit?: boolean
    jobs?: RankedJob[]
    keepPipe?: boolean
    skipHitl?: boolean
    /** When true, ignore selection and use opts.jobs / full live ranked */
    ignoreSelection?: boolean
  }) => {
    const liveAll = (opts?.jobs || result?.ranked_jobs || []).filter(
      (j) => !isSyntheticJob(j),
    )
    if (!liveAll.length) {
      setErr('No live jobs yet — search first, then pick roles and apply.')
      return false
    }
    if (!apiOk) {
      setErr('API offline — start START_JOBSEARCH_LAB.bat')
      return false
    }
    if (!effectiveEmail) {
      setErr('Add your email — required for form fill.')
      window.setTimeout(() => emailInputRef.current?.focus(), 80)
      return false
    }
    const submit = opts?.submit !== false
    let ranked: RankedJob[]
    if (opts?.jobs?.length && opts.ignoreSelection) {
      ranked = rankForApply(opts.jobs).slice(0, MAX_APPLY_SELECT)
    } else if (!opts?.ignoreSelection && selectedIds.size > 0) {
      const picked = liveAll.filter((j) => selectedIds.has(j.id))
      ranked = (picked.length ? picked : rankForApply(liveAll)).slice(
        0,
        MAX_APPLY_SELECT,
      )
    } else {
      ranked = rankForApply(liveAll).slice(0, MAX_APPLY_SELECT)
    }
    if (!ranked.length) {
      setErr('Select at least one role (checkbox) before apply.')
      return false
    }

    // Human-in-the-loop: show plain-language claims + job list before browser work
    if (!opts?.skipHitl) {
      const prof = currentProfile()
      const claimJobs: ClaimJob[] = ranked.map((j) => {
        const raw = String(j.apply_url || j.url || '').trim()
        const url = raw.startsWith('http') ? raw : resolveApplyUrl(j, excludeLinkedIn)
        return {
          id: j.id,
          title: j.title || 'Role',
          company: j.company,
          url,
          source: j.source,
          likelihood: applyLikelihood(j),
        }
      })
      const preview: ClaimPreview = {
        jobCount: ranked.length,
        willSubmit: submit,
        name: prof.name || undefined,
        email: prof.email || effectiveEmail,
        injects: (prof.skills || []).slice(0, 8),
        gaps: [],
        jobs: claimJobs,
        honesty:
          'We fill public ATS forms when possible. Login walls stay with you. We do not invent employers or degrees. “Manual” is normal for LinkedIn/Workday.',
      }
      setHitlPreview(preview)
      setHitlOpen(true)
      return await new Promise<boolean>((resolve) => {
        hitlPendingRef.current = () => {
          void runOneClickAutoApply({
            ...opts,
            jobs: ranked,
            ignoreSelection: true,
            skipHitl: true,
          }).then(resolve)
        }
        // stash cancel resolver on window-less ref via dual slot
        ;(hitlPendingRef as { current: unknown; cancel?: () => void }).cancel = () =>
          resolve(false)
      })
    }

    // Resolve apply URLs once; warm Apply Kit URL→pack index before Playwright loop
    const rankedUrls = ranked.map((j) => {
      const rawUrl = String(j.apply_url || j.url || '').trim()
      return rawUrl.startsWith('http') ? rawUrl : resolveApplyUrl(j, excludeLinkedIn)
    })
    const kitOnce = applyKit || loadStoredFormPack()
    const pickCache = createFormStorePickCache(kitOnce)
    const kitIndex = preindexFormStoreUrls(pickCache, rankedUrls)
    const kitCountLine = formatKitMatchCounts({
      matched: kitIndex.matched,
      id: kitIndex.idMatched,
      soft: kitIndex.softMatched,
    })
    const kitHeader =
      kitIndex.kitPacks > 0
        ? kitCountLine
          ? ` · ${kitCountLine}`
          : ` · Kit 0/${kitIndex.withUrl || ranked.length} match`
        : ''

    const jobSteps: PipeStep[] = ranked.map((j, i) => {
      const pick = kitIndex.picks[i]
      const matchMeta = pick
        ? {
            reason: pick.reason,
            score: pick.score,
            job_id: pick.job_id,
            title: pick.title,
            id_token: pick.id_token,
            match_kind: pick.match_kind,
          }
        : null
      const packLine = matchMeta ? formatFormPackMatch(matchMeta) : null
      const tone = kitMatchTone(matchMeta)
      const softWarn = tone === 'soft' ? ' · ⚠ soft board match' : ''
      return {
        id: `job-${i}`,
        label: `${i + 1}. ${j.title || 'Role'} @ ${j.company || 'Company'}`,
        detail: packLine ? `Queued · Kit ${packLine}${softWarn}` : 'Queued…',
        status: 'pending' as const,
        kitTone: tone,
      }
    })

    cancelApplyRef.current = false
    setOneClickBusy(true)
    setErr(null)
    setOneClickResult(null)
    // Atomic: keep search/rank steps + kit index + job rows (no race with setPipe)
    setPipeSteps((prev) => {
      const head = opts?.keepPipe
        ? prev.filter((s) => s.id === 'search' || s.id === 'rank' || s.id === 'apply')
        : []
      const softNote =
        kitIndex.softMatched > 0
          ? ` · ⚠ ${kitIndex.softMatched} soft (same-board only — verify pack)`
          : ''
      const kitStep: PipeStep = {
        id: 'kit-index',
        label: 'Apply Kit URL index',
        detail:
          kitIndex.kitPacks > 0
            ? `${kitIndex.matched} of ${kitIndex.withUrl} jobs matched` +
              (kitIndex.idMatched || kitIndex.softMatched
                ? ` · ${kitIndex.idMatched} id · ${kitIndex.softMatched} soft`
                : '') +
              ` · ${kitIndex.kitPacks} pack(s) in kit` +
              softNote
            : 'No Apply Kit in storage — export from Search for tailored packs',
        status: kitIndex.matched > 0 ? 'done' : kitIndex.kitPacks > 0 ? 'skip' : 'skip',
        kitTone:
          kitIndex.softMatched > 0
            ? 'soft'
            : kitIndex.idMatched > 0
              ? 'id'
              : 'none',
      }
      return [...head, kitStep, ...jobSteps]
    })
    setOneClickProgress(
      `Starting · ${ranked.length} role(s)${kitHeader}`,
    )
    window.setTimeout(() => {
      document.getElementById('pipeline-status')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }, 50)

    const base = currentProfile()
    const profile = {
      ...base,
      resume_text:
        base.resume_text ||
        `${base.name || 'Candidate'}\n${title}\n${effectiveEmail}\n${skills}`,
      has_resume: Boolean(base.resume_text),
      email: effectiveEmail,
    }

    const results: NonNullable<NonNullable<OneClickResult['browser']>['results']> = []
    let submitted = 0
    let filled = 0
    let manual = 0
    let cancelled = false

    try {
      for (let i = 0; i < ranked.length; i++) {
        if (cancelApplyRef.current) {
          cancelled = true
          for (let j = i; j < ranked.length; j++) {
            setPipe(`job-${j}`, {
              status: 'skip',
              detail: 'Cancelled',
              label: jobSteps[j]?.label,
            })
          }
          break
        }

        const job = ranked[i]!
        const url = rankedUrls[i] || ''

        setOneClickProgress(
          `Job ${i + 1} of ${ranked.length} · ${job.company || job.title || ''}${kitHeader}`,
        )
        setPipe(`job-${i}`, {
          status: 'running',
          label: jobSteps[i]!.label,
          detail: url.startsWith('http')
            ? `Opening · ${url.replace(/^https?:\/\//, '').slice(0, 56)}…`
            : 'No apply URL on this listing',
        })

        if (!url.startsWith('http')) {
          setPipe(`job-${i}`, {
            status: 'skip',
            detail: 'Skipped — no http apply URL',
          })
          results.push({
            job_id: job.id,
            title: job.title,
            company: job.company,
            status: 'skipped_no_url',
            submitted: false,
          })
          continue
        }

        let cover = ''
        let prepFromKit = false
        // Cache already warmed by preindexFormStoreUrls
        const cachedPick = pickCache.pick(url)
        // strictSoft: soft same-board packs must not supply fill materials (sibling mis-fill)
        const allowKitPick = allowKitFillFromPick(cachedPick, strictSoft)
        try {
          setPipe(`job-${i}`, {
            status: 'running',
            detail: 'Preparing cover note…',
          })
          const prep = await prepareApplyPacket({
            profile,
            job: { ...job, apply_url: url },
            form_store: kitOnce,
            prefer_form_store: allowKitPick,
            form_store_pick: allowKitPick ? cachedPick : null,
            pick_cache: pickCache,
          })
          prepFromKit = prep.source === 'form_store'
          // Thin prepare cover only when no kit pack — kit pack applied server-side via form_store
          if (prep.ok && prep.packet?.cover_note && !prepFromKit) {
            cover = prep.packet.cover_note
          }
          if (prepFromKit && prep.form_pack_match) {
            const prepTone = kitMatchTone(prep.form_pack_match)
            const prepLine = formatFormPackMatch(prep.form_pack_match) || 'URL match'
            setPipe(`job-${i}`, {
              status: 'running',
              kitTone: prepTone,
              detail:
                `Kit pack · ${prepLine}` +
                (prepTone === 'soft' ? ' · ⚠ soft — verify pack' : ''),
            })
          } else if (cachedPick && !allowKitPick) {
            setPipe(`job-${i}`, {
              status: 'running',
              kitTone: 'soft',
              detail:
                'Soft kit demoted · cold fill (strict soft) — sibling pack not applied',
            })
          }
        } catch {
          /* non-fatal */
        }

        if (cancelApplyRef.current) {
          cancelled = true
          setPipe(`job-${i}`, { status: 'skip', detail: 'Cancelled' })
          break
        }

        setPipe(`job-${i}`, {
          status: 'running',
          detail: submit
            ? 'Browser open → fill form → click Submit…'
            : 'Browser open → fill form (no submit)…',
        })

        // Stamp strict_soft so server materialize also skips soft sibling packs
        const slim = pickCache.slimStore(url)
        const storeForFill = slim
          ? { ...slim, strict_soft: strictSoft }
          : kitOnce
            ? { ...kitOnce, strict_soft: strictSoft }
            : null

        const r = await browserApplyOne({
          profile,
          url,
          submit,
          headless: true,
          cover_note: cover,
          // Slim single-pack body when URL matches (else full kit / none)
          form_store: storeForFill,
          use_form_store: true,
          job_id: job.id,
          title: job.title,
          company: job.company,
        })

        const fields = r.filled_fields || []
        const st =
          r.status ||
          (r.submitted ? 'submitted' : fields.length ? 'filled' : 'error')
        const packLine = formatFormPackMatch(r.form_pack_match)
        const resultTone = kitMatchTone(r.form_pack_match)
        const softSkipped = Boolean(
          r.form_pack_match?.soft_skipped ||
            r.form_pack_match?.preferred === 'strict_soft_skip',
        )
        const softSuffix = softSkipped
          ? ' · soft kit skipped (strict)'
          : resultTone === 'soft'
            ? ' · ⚠ soft pack'
            : ''
        results.push({
          job_id: job.id,
          title: job.title,
          company: job.company,
          url: r.url || url,
          status: st,
          submitted: Boolean(r.submitted),
          filled_fields: fields,
          error: r.error || r.message,
          ats: r.ats,
          form_pack_match: r.form_pack_match,
        })

        if (r.submitted || st === 'submitted') {
          submitted++
          setTracker((prev) => upsertTracked(job, 'applied', prev))
          setPipe(`job-${i}`, {
            status: 'done',
            kitTone: resultTone,
            detail:
              `✓ Submitted · ${fields.length ? fields.join(', ') : 'form'} · ${r.ats || 'ats'}` +
              (packLine ? ` · ${packLine}` : '') +
              softSuffix,
          })
        } else if (
          st === 'submit_quality_rejected' ||
          st === 'filled_submit_failed' ||
          st === 'submit_click_failed'
        ) {
          filled++
          setTracker((prev) => upsertTracked(job, 'shortlisted', prev))
          setPipe(`job-${i}`, {
            status: 'error',
            kitTone: resultTone,
            detail:
              (r.error ||
                (st === 'submit_click_failed'
                  ? `Filled ${fields.join(', ') || 'form'} — submit control not found`
                  : `Submit clicked but fill too thin (${fields.length} fields) — not counted`)) +
              (packLine ? ` · ${packLine}` : '') +
              softSuffix,
          })
        } else if (st === 'duplicate') {
          setPipe(`job-${i}`, {
            status: 'skip',
            kitTone: resultTone,
            detail:
              `Skipped · duplicate URL (already counted recently)` +
              (packLine ? ` · ${packLine}` : '') +
              softSuffix,
          })
        } else if (fields.length > 0 || st === 'filled') {
          filled++
          setTracker((prev) => upsertTracked(job, 'shortlisted', prev))
          setPipe(`job-${i}`, {
            status: 'done',
            kitTone: resultTone,
            detail:
              `✓ Filled ${fields.join(', ')} · ${r.ats || ''}` +
              (packLine ? ` · ${packLine}` : '') +
              softSuffix,
          })
        } else if (st === 'opened_manual' || r.ok) {
          manual++
          setTracker((prev) => upsertTracked(job, 'shortlisted', prev))
          setPipe(`job-${i}`, {
            status: 'skip',
            kitTone: resultTone,
            detail:
              `↗ Opened for you · ${r.ats || 'login wall'} — finish in browser` +
              (packLine ? ` · ${packLine}` : '') +
              softSuffix,
          })
        } else {
          setPipe(`job-${i}`, {
            status: 'error',
            kitTone: resultTone,
            detail: r.error || r.message || 'Failed',
          })
        }
      }

      const kitTones = countKitTonesFromResults(results)
      // Prefer post-apply tones; fall back to preindex if results lack match meta
      const softN =
        kitTones.soft > 0 || kitTones.id > 0 ? kitTones.soft : kitIndex.softMatched
      const idN =
        kitTones.soft > 0 || kitTones.id > 0 ? kitTones.id : kitIndex.idMatched
      const matchedN =
        kitTones.matched > 0 ? kitTones.matched : kitIndex.matched
      const kitDone = formatKitMatchCounts({
        matched: matchedN,
        id: idN,
        soft: softN,
      })
      const kitDoneSuffix = kitDone ? ` · ${kitDone}` : ''

      const messageBase = cancelled
        ? `Cancelled · submitted ${submitted} · filled ${filled} · opened ${manual}`
        : submitted > 0
          ? `Done · submitted ${submitted} · filled ${filled}` +
            (manual ? ` · ${manual} need you` : '')
          : filled > 0
            ? `Done · filled ${filled} forms` + (manual ? ` · ${manual} opened` : '')
            : manual > 0
              ? `Done · opened ${manual} for manual finish`
              : 'Done · nothing completed'
      const message = messageBase + kitDoneSuffix

      const aggregated: OneClickResult = {
        ok: submitted + filled + manual > 0,
        message,
        honesty:
          'Each line is one real browser attempt. Submitted = filled + Submit. Opened = needs your login.' +
          (softN > 0
            ? ` Soft kit match (${softN}) = same board only — confirm tailored materials.`
            : ''),
        use_form_store: true,
        form_store_source: kitOnce?.job_packs?.length
          ? String((kitOnce as { source?: string }).source || 'apply_kit')
          : null,
        form_store_packs: kitOnce?.job_packs?.length ?? 0,
        summary: {
          eligible: ranked.length,
          attempted: results.length,
          filled: filled + submitted,
          submitted,
          opened_manual: manual,
          acted: submitted + filled + manual,
          kit_matched: matchedN,
          kit_id: idN,
          kit_soft: softN,
        },
        browser: { results, filled: filled + submitted, submitted },
      }
      setOneClickResult(aggregated)
      setOneClickProgress(message)
      setToast(message)
      window.setTimeout(() => {
        document
          .getElementById('apply-results')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
      return aggregated.ok
    } catch (e) {
      setErr((e as Error).message || 'Auto apply failed')
      setOneClickProgress('Failed')
      return false
    } finally {
      setOneClickBusy(false)
      cancelApplyRef.current = false
    }
  }

  /**
   * Tailor RT: multi-agent resume tailor + validator loop for top shortlist jobs.
   * Analyze JD → ground evidence → tailor → validate (retry). GitHub-inspired.
   */
  const runTailorRTForShortlist = async () => {
    const live = (result?.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
    if (!live.length) {
      setErr('Search first — Tailor RT needs a live shortlist.')
      return
    }
    if (!apiOk) {
      setErr('API offline — start START_JOBSEARCH_LAB.bat')
      return
    }
    if (!effectiveEmail) {
      setErr('Add email first so validator can mark contact ready.')
      return
    }
    setTailorRtBusy(true)
    setErr(null)
    try {
      const batch = await runTailorRTBatch({
        profile: currentProfile(),
        jobs: live.slice(0, 8),
        limit: 5,
      })
      if (!batch.ok && batch.error) {
        setErr(batch.error)
        return
      }
      setTailorRt(batch)
      setTailorRtOpen(true)
      const top = batch.results?.[0]
      setToast(
        `Tailor RT · ${batch.passed_n ?? 0}/${batch.count ?? 0} passed validation` +
          (top
            ? ` · best grade ${top.grade || '?'} (${top.overall_score ?? 0}) for ${top.job?.title || 'role'}`
            : ''),
      )
      // Surface best tailored resume into form for apply kit
      if (top?.forged_resume && !looksLikeBinaryGarbage(top.forged_resume)) {
        setMarvelResumeText(top.forged_resume.slice(0, 8000))
      }
    } catch (e) {
      setErr((e as Error).message || 'Tailor RT failed')
    } finally {
      setTailorRtBusy(false)
    }
  }

  /** Build AI form pack + download JSON for Chrome extension (Astra Apply Kit). */
  const exportApplyKit = async () => {
    if (!email.trim()) {
      setErr('Add email first — form pack needs contact fields.')
      return
    }
    setKitBusy(true)
    setErr(null)
    try {
      const live = (result?.ranked_jobs || []).filter((j) => !isSyntheticJob(j)).slice(0, 8)
      const store = await buildExtensionStore({
        profile: currentProfile(),
        jobs: live,
        forge_top: Math.min(3, live.length || 0),
        strict_soft: strictSoft,
      })
      if (!store.ok) {
        setErr(store.message || store.error || 'Form pack failed')
        return
      }
      setApplyKit(store)
      downloadJson(store, 'astra-apply-kit.json')
      // PII hygiene: truncate resume blobs in localStorage (full text only in download)
      try {
        saveFormPackSecure(store)
      } catch {
        /* ignore */
      }
      const injectN = formPackInjectRows(store, 99).reduce((n, r) => n + r.injects.length, 0)
      setToast(
        `Apply Kit ready · ${store.job_packs?.length ?? 0} tailored job pack(s)` +
          (injectN ? ` · ${injectN} keyword injects` : '') +
          `. Load extension from interview-pulse-ai/extension/astra-apply-kit and Import JSON.`,
      )
    } catch (e) {
      setErr((e as Error).message || 'Export failed')
    } finally {
      setKitBusy(false)
    }
  }

  /**
   * Full product lifecycle: Discover live jobs → Auto Apply top matches.
   * This is the primary Auto Apply entry — not a buried secondary control.
   */
  const runFullLifecycle = async () => {
    if (!apiOk) {
      setErr('API offline — start START_JOBSEARCH_LAB.bat')
      return
    }
    if (!effectiveEmail) {
      setErr('Add your email first — required to fill applications.')
      window.setTimeout(() => emailInputRef.current?.focus(), 80)
      return
    }
    if (!email.trim() && user?.email) setEmail(user.email)
    switchHub('search')
    cancelApplyRef.current = false
    setOneClickBusy(true)
    setErr(null)
    setOneClickResult(null)
    setPipeSteps([
      {
        id: 'search',
        label: '1. Search live boards',
        detail: 'Querying freehire / Remotive / LinkedIn…',
        status: 'running',
      },
      {
        id: 'rank',
        label: '2. Rank by form-fillability',
        detail: 'Waiting…',
        status: 'pending',
      },
      {
        id: 'apply',
        label: '3. Apply top matches (one at a time)',
        detail: 'Waiting…',
        status: 'pending',
      },
    ])
    setOneClickProgress('1/3 · Searching live boards…')
    try {
      const data = await run({ silentToast: true })
      if (!data) {
        setPipe('search', { status: 'error', detail: 'Search failed — check API' })
        setOneClickBusy(false)
        setOneClickProgress('Search failed')
        return
      }
      const live = (data.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
      setPipe('search', {
        status: 'done',
        detail: `Found ${live.length} live role${live.length === 1 ? '' : 's'}`,
      })
      if (!live.length) {
        setErr('No live jobs found. Try Anywhere or turn LinkedIn on.')
        setPipe('rank', { status: 'skip', detail: 'No jobs to rank' })
        setPipe('apply', { status: 'skip', detail: 'No jobs to apply' })
        setOneClickBusy(false)
        setOneClickProgress('No jobs found')
        return
      }
      setOneClickProgress('2/3 · Ranking for auto-fill…')
      const kitForRank = applyKit || loadStoredFormPack()
      const kitPackN = kitForRank?.job_packs?.length ?? 0
      setPipe('rank', {
        status: 'running',
        detail:
          kitPackN > 0
            ? `Prefer Apply Kit URL matches (${kitPackN} pack), then public forms…`
            : 'Prefer Freshteam / Greenhouse / public forms over LinkedIn…',
      })
      const ranked = rankForApply(live)
      const top4 = ranked.slice(0, MAX_APPLY_SELECT)
      seedSelectionFromLive(live)
      const pickPreview = createFormStorePickCache(kitForRank)
      let kitTop = 0
      for (const j of top4) {
        const raw = String(j.apply_url || j.url || '').trim()
        const u = raw.startsWith('http') ? raw : resolveApplyUrl(j, excludeLinkedIn)
        if (u.startsWith('http') && pickPreview.pick(u)) kitTop++
      }
      setPipe('rank', {
        status: 'done',
        detail:
          `Order: ${top4
            .map((j) => j.company || j.title)
            .filter(Boolean)
            .join(' → ')}` +
          (kitPackN > 0 ? ` · ${kitTop}/${top4.length} kit-matched first` : ''),
      })
      const n = Math.min(MAX_APPLY_SELECT, ranked.length)
      setPipe('apply', {
        status: 'running',
        detail: `Starting ${n} sequential browser apply attempts (selected / top form-friendly)…`,
      })
      setOneClickProgress(`3/3 · Applying ${n} jobs…`)
      // Lifecycle: apply the ranked shortlist (same as pre-selected checkboxes)
      await runOneClickAutoApply({
        submit: true,
        jobs: top4,
        ignoreSelection: true,
        keepPipe: true,
      })
      setPipe('apply', {
        status: cancelApplyRef.current ? 'skip' : 'done',
        detail: cancelApplyRef.current ? 'Stopped by user' : 'All attempts finished',
      })
    } catch (e) {
      setErr((e as Error).message || 'Lifecycle failed')
      setOneClickBusy(false)
      setOneClickProgress('Failed')
      setPipe('search', {
        status: 'error',
        detail: (e as Error).message,
      })
    }
  }

  const cancelPipeline = () => {
    cancelApplyRef.current = true
    setOneClickProgress('Cancelling after current job…')
    setToast('Cancel requested — finishes current job then stops')
  }

  const filterFingerprint = useMemo(
    () =>
      JSON.stringify({
        title,
        skills,
        remote,
        locationMode,
        locationCustom,
        excludeLinkedIn,
        useLive,
        includeSeed,
        minScore,
        limit,
      }),
    [
      title,
      skills,
      remote,
      locationMode,
      locationCustom,
      excludeLinkedIn,
      useLive,
      includeSeed,
      minScore,
      limit,
    ],
  )

  const filtersDirty = Boolean(
    result && runFingerprint && filterFingerprint !== runFingerprint,
  )

  const resolvedLocation = useMemo(() => {
    if (locationMode === 'us') return 'us'
    if (locationMode === 'custom') {
      const c = locationCustom.trim().toLowerCase()
      if (!c) return 'all'
      if (['united states', 'usa', 'u.s.', 'u.s.a.', 'us', 'america'].includes(c)) {
        return 'us'
      }
      return locationCustom.trim()
    }
    return 'all'
  }, [locationMode, locationCustom])

  useEffect(() => {
    savePrefs({
      title,
      skills,
      summary,
      remote,
      locationMode,
      locationCustom,
      excludeLinkedIn,
      useLive,
      includeSeed,
      minScore,
      limit,
      email,
      phone,
      linkedinUrl,
      portfolioUrl,
      yearsExperience,
    })
  }, [
    title,
    skills,
    summary,
    remote,
    locationMode,
    locationCustom,
    excludeLinkedIn,
    useLive,
    includeSeed,
    minScore,
    limit,
    email,
    phone,
    linkedinUrl,
    portfolioUrl,
    yearsExperience,
  ])

  // Purge binary already in state OR hydrate first good resume from store
  useEffect(() => {
    if (resumeText && looksLikeBinaryGarbage(resumeText)) {
      setResumeText('')
      setErr(
        'Resume text was unreadable (broken DOCX). Re-upload as PDF or .txt.',
      )
      return
    }
    if (resumeText || !resumes[0]) return
    const doc = resumes[0]
    const clean = sanitizeResumeText(doc.text || '')
    setResumeId(doc.id)
    setResumeName(doc.name)
    setResumeText(clean)
    if (!clean && doc.text) {
      setErr(
        `Resume “${doc.name}” could not be read as text. Re-upload as PDF or .txt.`,
      )
    }
  }, [resumes, resumeText])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(t)
  }, [toast])

  const applyResumeText = useCallback((name: string, text: string, id?: string) => {
    if (looksLikeBinaryGarbage(text)) {
      setErr(
        `Resume “${name}” could not be read as text (often a broken DOCX parse). Re-upload as PDF or .txt.`,
      )
      return
    }
    if (id) setResumeId(id)
    setResumeName(name)
    setResumeText(text)
    const extracted = extractSkillsFromResume(text)
    if (extracted.length) {
      setSkills((prev) => {
        const set = new Set(
          prev
            .split(/[,;\n]/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
        extracted.forEach((s) => set.add(s))
        return Array.from(set).join(', ')
      })
    }
    // Guess person name from filename (Sri_Naidu_SAP_….docx) when account name missing
    const guessed = nameFromResumeFilename(name)
    if (guessed && (!user?.name || user.name.includes('@'))) {
      // only toast — user name lives on account; pack will use resume_filename
    }
    setToast(`Resume ready · ${name}${guessed ? ` · detected ${guessed}` : ''}`)
  }, [user?.name])

  const onPickResumeDoc = (id: string) => {
    const d = resumes.find((x) => x.id === id)
    if (d) applyResumeText(d.name, d.text, d.id)
  }

  const onUploadResume = async (files: FileList | null) => {
    if (!files?.length) return
    setUploadBusy(true)
    setErr(null)
    try {
      const file = files[0]!
      if (!isAllowedKnowledgeFile(file)) {
        setErr('Use PDF, DOCX, MD, or TXT.')
        return
      }
      const doc = await parseUploadedFile(file, 'resume')
      addDocument(doc)
      applyResumeText(doc.name, doc.text, doc.id)
    } catch (e) {
      setErr((e as Error).message || 'Upload failed')
    } finally {
      setUploadBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const run = async (opts?: {
    exclude_linkedin?: boolean
    silentToast?: boolean
  }): Promise<JobSearchRunResult | null> => {
    if (!apiOk) {
      setErr('API offline. Start copilot_api.py or START_JOBSEARCH_LAB.bat.')
      return null
    }
    const excludeLi = opts?.exclude_linkedin ?? excludeLinkedIn
    setBusy(true)
    setErr(null)
    if (!opts?.silentToast) setToast(null)
    try {
      const skillList = skills
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const skillsFinal =
        skillList.length > 0
          ? skillList
          : title.toLowerCase().includes('sap')
            ? ['sap', 'fico', 's4hana']
            : ['software']

      const data = await runJobSearch({
        profile: {
          name: user?.name || user?.email || 'Candidate',
          target_title: title.trim() || 'Software Engineer',
          summary: summary.trim(),
          skills: skillsFinal,
          remote_ok: remote === 'remote' || remote === 'all',
          resume_text: resumeText.slice(0, 8000) || undefined,
          has_resume: hasResume,
        },
        use_live: useLive,
        remote,
        location: resolvedLocation,
        exclude_linkedin: excludeLi,
        include_seed: includeSeed,
        limit,
        min_score: minScore,
      })
      setResult(data)
      // Fingerprint must match the LI flag we actually sent
      setRunFingerprint(
        JSON.stringify({
          title,
          skills,
          remote,
          locationMode,
          locationCustom,
          excludeLinkedIn: excludeLi,
          useLive,
          includeSeed,
          minScore,
          limit,
        }),
      )
      setShowPractice(false)
      setQueryFilter('')
      setSourceFilter('all')
      setSortKey('score')
      // Pre-check top form-friendly roles (max 4) so "how to use" is obvious
      const liveJobsList = (data.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
      seedSelectionFromLive(liveJobsList)
      const live = Number(data.meta?.live_count ?? liveJobsList.length)
      // Seamless: land on results; nudge qualify if contact missing
      window.setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
      if (live > 0 && !(email.trim() || user?.email)) {
        emailInputRef.current?.focus()
      }
      const liN = (data.ranked_jobs || []).filter(
        (j) => j.source === 'linkedin' || j.is_linkedin,
      ).length
      const ms = Number(data.meta?.elapsed_ms ?? 0)
      const cacheHit = Boolean(data.cache?.served_from_cache)
      const grade = data.product?.grade || data.enterprise?.grade
      if (!opts?.silentToast) {
        setToast(
          live > 0
            ? `Found ${live} live roles` +
                (liN ? ` · ${liN} from LinkedIn` : '') +
                (ms ? ` · ${(ms / 1000).toFixed(1)}s` : '') +
                (cacheHit ? ' · cache hit' : '') +
                (grade === 'enterprise' && !cacheHit ? ' · enterprise' : '')
            : 'No live matches — try Anywhere or allow LinkedIn',
        )
      }
      return data
    } catch (e) {
      setErr((e as Error).message || 'Search failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  const markStatus = (job: RankedJob, status: AppStatus) => {
    setTracker((prev) => upsertTracked(job, status, prev))
    setToast(`${status} · ${job.title}`)
  }

  /** Single lab profile for Search / playbooks / Tailor RT / apply — never put email in name. */
  const currentProfile = useCallback(() => {
    const skillList = skills
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const guessed = resumeName ? nameFromResumeFilename(resumeName) : null
    const safeResume =
      resumeText && !looksLikeBinaryGarbage(resumeText)
        ? resumeText.slice(0, 8000)
        : undefined
    const safeSummary =
      summary.trim() && !looksLikeBinaryGarbage(summary)
        ? summary.trim()
        : undefined
    return {
      name:
        (user?.name && !user.name.includes('@') ? user.name : '') ||
        guessed ||
        '',
      target_title: title.trim() || 'Software Engineer',
      summary: safeSummary,
      skills:
        skillList.length > 0
          ? skillList
          : title.toLowerCase().includes('sap')
            ? ['sap', 'fico', 's4hana']
            : ['software'],
      resume_text: safeResume,
      has_resume: Boolean(safeResume),
      resume_filename: resumeName || undefined,
      email: effectiveEmail || undefined,
      phone: phone.trim() || undefined,
      linkedin_url: linkedinUrl.trim() || undefined,
      portfolio_url: portfolioUrl.trim() || undefined,
      years_experience: yearsExperience.trim() || undefined,
      location: resolvedLocation,
    }
  }, [
    skills,
    user,
    title,
    summary,
    resumeText,
    resumeName,
    effectiveEmail,
    phone,
    linkedinUrl,
    portfolioUrl,
    yearsExperience,
    resolvedLocation,
  ])

  const openApply = (job: RankedJob) => {
    if (isSyntheticJob(job)) {
      setToast('Practice listing — opening Indeed search')
    }
    window.open(resolveApplyUrl(job, excludeLinkedIn), '_blank', 'noopener,noreferrer')
    // Opening is not a submit — track as shortlisted so pipeline stays honest
    if (!isSyntheticJob(job)) markStatus(job, 'shortlisted')
  }

  const runApplyStudio = async () => {
    if (!result?.ranked_jobs?.length) {
      setErr('Run a search first — Apply Studio ranks your shortlist.')
      return
    }
    setApplyBusy(true)
    setErr(null)
    try {
      const live = (result.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
      const q = await buildApplyQueue({
        profile: currentProfile(),
        jobs: live.length ? live : result.ranked_jobs,
        budget: applyBudget,
      })
      if (!q.ok) {
        setErr(q.error || 'Apply queue failed')
        return
      }
      setApplyQueue(q)
      setStudioOpen(true)
      setActivePacket(q.queue?.[0] || null)
      setToast(
        `Apply queue ready · ${q.stats?.queued ?? 0} roles` +
          (q.stats?.ready_to_apply ? ` · ${q.stats.ready_to_apply} ready` : '') +
          (q.elapsed_ms ? ` · ${Math.round(q.elapsed_ms)}ms` : ''),
      )
    } catch (e) {
      setErr((e as Error).message || 'Apply Studio failed')
    } finally {
      setApplyBusy(false)
    }
  }

  const runMarvel = async () => {
    if (!result?.ranked_jobs?.length) {
      setErr('Run a search first — Marvel Apply needs a shortlist.')
      return
    }
    setMarvelBusy(true)
    setErr(null)
    try {
      const live = (result.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
      const m = await runMarvelApply({
        profile: currentProfile(),
        jobs: live.length ? live : result.ranked_jobs,
        budget: applyBudget,
        forge_top: Math.min(5, applyBudget),
        inject_budget: 8,
      })
      if (!m.ok) {
        setErr(m.error || 'Marvel Apply failed')
        return
      }
      setMarvel(m)
      setMarvelOpen(true)
      const heroResume = m.hero?.forge?.forged_resume || m.queue?.[0]?.resume_forge?.forged_resume || ''
      setMarvelResumeText(heroResume)
      // also seed apply studio from marvel queue
      if (m.queue?.length) {
        setApplyQueue({
          ok: true,
          queue: m.queue,
          stats: {
            queued: m.stats?.queued,
            ready_to_apply: m.queue.filter((q) => q.action === 'apply_now').length,
          },
          honesty: m.honesty,
          version: m.version,
        })
        setActivePacket(m.queue[0] || null)
        setStudioOpen(true)
      }
      setToast(
        `Marvel ${m.codename || ''} · ${m.stats?.queued ?? 0} queue · ${m.stats?.forged ?? 0} resumes forged` +
          (m.elapsed_ms ? ` · ${(m.elapsed_ms / 1000).toFixed(1)}s` : ''),
      )
    } catch (e) {
      setErr((e as Error).message || 'Marvel failed')
    } finally {
      setMarvelBusy(false)
    }
  }

  const openPacketForJob = async (job: RankedJob) => {
    if (isSyntheticJob(job)) {
      setToast('Practice listings cannot use AI Apply')
      return
    }
    setApplyBusy(true)
    try {
      // Prefer Apply Kit URL match (same strict_soft policy as sequential / single fill)
      const kit = applyKit || loadStoredFormPack()
      const rawUrl = String(job.apply_url || job.url || '').trim()
      const applyUrl = rawUrl.startsWith('http')
        ? rawUrl
        : resolveApplyUrl(job, excludeLinkedIn)
      const storeForPrep = kit
        ? {
            ...kit,
            strict_soft:
              kit.strict_soft !== undefined ? kit.strict_soft !== false : strictSoft,
          }
        : null
      const res = await prepareApplyPacket({
        profile: currentProfile(),
        job: { ...job, apply_url: applyUrl || job.apply_url },
        form_store: storeForPrep,
        prefer_form_store: true,
      })
      if (!res.ok || !res.packet) {
        setErr(res.error || 'Could not prepare materials')
        return
      }
      setActivePacket(res.packet)
      setStudioOpen(true)
      setToolsOpen(true)
      const packLine = formatFormPackMatch(res.form_pack_match)
      const softSkip =
        res.form_pack_match?.soft_skipped ||
        res.form_pack_match?.preferred === 'strict_soft_skip'
      const srcBit =
        res.source === 'form_store'
          ? ' · kit pack'
          : softSkip
            ? ' · soft kit skipped · cold prep'
            : storeForPrep?.job_packs?.length
              ? ' · prepared'
              : ''
      setToast(
        `Materials ready · ${job.title}${srcBit}` +
          (packLine && res.source === 'form_store' ? ` · ${packLine}` : ''),
      )
      window.setTimeout(() => {
        document.getElementById('apply-studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
    } finally {
      setApplyBusy(false)
    }
  }

  /** Per-job Playwright fill (optional submit) — missing piece for card-level apply */
  const fillOneJob = async (job: RankedJob, submit: boolean) => {
    if (isSyntheticJob(job)) {
      setToast('Practice listings cannot auto-fill')
      return
    }
    if (!hasEmail) {
      setFiltersOpen(true)
      setErr('Add email first — required to fill forms.')
      return
    }
    if (!apiOk) {
      setErr('API offline — start the lab API.')
      return
    }
    const url = resolveApplyUrl(job, excludeLinkedIn)
    if (!url.startsWith('http')) {
      setErr('No apply URL on this role')
      return
    }
    setApplyBusy(true)
    setErr(null)
    setToast(submit ? `Filling + submit · ${job.company}…` : `Filling form · ${job.company}…`)
    try {
      // Prefer URL-matched Apply Kit materials over generic prepare when available
      const kit = applyKit || loadStoredFormPack()
      // Align fill with lab policy (export stamp or current Strict soft toggle)
      const storeForFill = kit
        ? { ...kit, strict_soft: kit.strict_soft !== undefined ? kit.strict_soft !== false : strictSoft }
        : null
      const prep = await prepareApplyPacket({
        profile: currentProfile(),
        job: { ...job, apply_url: url },
        form_store: storeForFill,
        prefer_form_store: true,
      })
      if (prep.ok && prep.packet) {
        setActivePacket(prep.packet)
      }
      const r = await browserApplyOne({
        profile: currentProfile(),
        url,
        submit,
        headless: true,
        // Empty cover when kit matched → server materialize uses pack as authoritative
        cover_note:
          prep.source === 'form_store' ? '' : prep.packet?.cover_note || '',
        form_store: storeForFill,
        use_form_store: true,
        job_id: job.id,
        title: job.title,
        company: job.company,
      })
      const filled = (r.filled_fields || []).length
      const packLine = formatFormPackMatch(r.form_pack_match)
      const softSkip = Boolean(
        r.form_pack_match?.soft_skipped ||
          r.form_pack_match?.preferred === 'strict_soft_skip' ||
          prep.form_pack_match?.soft_skipped ||
          prep.form_pack_match?.preferred === 'strict_soft_skip',
      )
      const softBit = softSkip ? ' · soft kit skipped' : ''
      const kitBit =
        prep.source === 'form_store' ? ' · kit pack' : softSkip ? '' : ''
      if (r.submitted) {
        markStatus(job, 'applied')
        setToast(
          `Submitted · ${job.company}` +
            kitBit +
            (packLine ? ` · ${packLine}` : '') +
            softBit,
        )
      } else if (filled > 0) {
        markStatus(job, 'shortlisted')
        setToast(
          `Filled ${filled} field(s) · ${job.company}${submit ? ' (submit blocked)' : ''}` +
            kitBit +
            (packLine ? ` · ${packLine}` : '') +
            softBit,
        )
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
        markStatus(job, 'shortlisted')
        setToast(
          (r.error || r.message || r.status === 'opened_manual'
            ? `Opened apply page · finish manually · ${job.company}`
            : `Opened apply page · ${job.company}`) +
            softBit,
        )
      }
    } catch (e) {
      setErr((e as Error).message || 'Fill failed')
    } finally {
      setApplyBusy(false)
    }
  }

  const applyWithPacket = async (packet: ApplyPacket, opts?: { fill?: boolean; submit?: boolean }) => {
    if (packet.is_synthetic || packet.action === 'blocked_practice') {
      setToast('Blocked — practice listing')
      return
    }
    const url = packet.apply_url || ''
    if (!url) {
      setErr('No apply URL on this packet')
      return
    }
    const job =
      result?.ranked_jobs?.find((j) => j.id === packet.job_id) ||
      ({
        id: String(packet.job_id || ''),
        title: packet.title || '',
        company: packet.company || '',
        apply_url: url,
        scores: { ensemble: Number(packet.ensemble_fit ?? 0) },
      } as RankedJob)

    if (opts?.fill) {
      await fillOneJob(job, Boolean(opts.submit))
      return
    }

    // Default: open + copy cover note for paste
    if (packet.cover_note) {
      try {
        await navigator.clipboard.writeText(
          [packet.subject_line, '', packet.cover_note, '', ...(packet.star_bullets || [])]
            .filter(Boolean)
            .join('\n'),
        )
      } catch {
        /* clipboard blocked */
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    markStatus(job, 'applied')
    void confirmApply({ job_id: String(packet.job_id || ''), status: 'applied' })
    setToast(`Opened apply · cover copied · ${packet.company}`)
  }

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast(`Copied ${label}`)
    } catch {
      setToast('Copy failed — select text manually')
    }
  }

  const sendToMock = (job: RankedJob) => {
    setActiveJobTitle(`${job.title} @ ${job.company}`)
    setRoute('practice')
  }

  const sendJdToKnowledge = (job: RankedJob) => {
    const text = [
      `${job.title} at ${job.company}`,
      job.location || '',
      isSyntheticJob(job) ? '(practice / synthetic listing)' : '',
      `Apply: ${resolveApplyUrl(job, excludeLinkedIn)}`,
      '',
      job.text || '',
      `Skills: ${(job.skills || []).join(', ')}`,
    ].join('\n')
    addDocument({
      id: `job_${job.id}_${Date.now()}`,
      name: `${job.company} — ${job.title}`,
      type: 'job',
      text: text.slice(0, 12000),
      uploadedAt: new Date().toISOString(),
      sizeBytes: text.length,
    })
    setActiveJobTitle(job.title)
    setToast('JD saved to Knowledge')
  }

  const trackerById = useMemo(() => {
    const m = new Map<string, TrackedApplication>()
    tracker.forEach((t) => m.set(t.job_id, t))
    return m
  }, [tracker])

  const rankedJobsRef = result?.ranked_jobs
  const allRanked = useMemo(() => rankedJobsRef || [], [rankedJobsRef])
  const liveJobs = useMemo(
    () => allRanked.filter((j) => !isSyntheticJob(j)),
    [allRanked],
  )
  const practiceJobs = useMemo(
    () => allRanked.filter((j) => isSyntheticJob(j)),
    [allRanked],
  )

  const baseList = showPractice
    ? allRanked
    : liveJobs.length
      ? liveJobs
      : allRanked

  const displayed = useMemo(() => {
    let list = [...baseList]
    const q = queryFilter.trim().toLowerCase()
    if (q) {
      list = list.filter((j) =>
        `${j.title} ${j.company} ${j.location || ''} ${j.source || ''}`
          .toLowerCase()
          .includes(q),
      )
    }
    if (sourceFilter === 'linkedin') {
      list = list.filter((j) => j.source === 'linkedin' || j.is_linkedin)
    } else if (sourceFilter === 'freehire') {
      list = list.filter((j) => j.source === 'freehire')
    } else if (sourceFilter === 'other') {
      list = list.filter(
        (j) => j.source !== 'linkedin' && j.source !== 'freehire' && !j.is_linkedin,
      )
    }
    list.sort((a, b) => {
      if (sortKey === 'score') {
        return (b.scores?.ensemble || 0) - (a.scores?.ensemble || 0)
      }
      if (sortKey === 'title') return (a.title || '').localeCompare(b.title || '')
      if (sortKey === 'company') return (a.company || '').localeCompare(b.company || '')
      return (a.source || '').localeCompare(b.source || '')
    })
    return list
  }, [baseList, queryFilter, sourceFilter, sortKey])

  const serverWarnings = result?.warnings || result?.next_steps?.warnings || []
  const elapsed = Number(result?.meta?.elapsed_ms || 0)
  const appliedCount = tracker.filter((t) => t.status === 'applied').length
  const shortlistCount = tracker.filter((t) => t.status === 'shortlisted').length

  // Same filter as liveJobs — single source (no second allocation)
  const liveSeed = liveJobs

  // Enterprise progressive flow: Discover → Qualify → Apply (hooks before any early return)
  const stepSearchDone = hasResults && liveSeed.length > 0
  const stepProfileDone = hasEmail
  const stepApplyReady = stepSearchDone && stepProfileDone && apiOk

  const selectedCount = selectedIds.size

  // Journey strip: Search → Pick → Apply → Truth (matches coach steps)
  const journey: JourneyStep[] = useMemo(
    () => [
      {
        id: 'search',
        label: 'Search',
        done: stepSearchDone,
        active: hubMode === 'search' && !stepSearchDone && !oneClickBusy,
        onClick: () => switchHub('search'),
      },
      {
        id: 'pick',
        label: 'Pick roles',
        done: stepSearchDone && selectedCount > 0,
        active: stepSearchDone && !oneClickBusy && !oneClickResult && hubMode === 'search',
        onClick: stepSearchDone ? () => switchHub('search') : undefined,
      },
      {
        id: 'apply',
        label: 'Apply',
        done: appliedCount > 0 || Boolean(oneClickResult?.summary?.submitted),
        active: hubMode === 'auto' || oneClickBusy || hitlOpen,
        // Same car: stay on Search and run selected apply (not a second engine)
        onClick: () => {
          switchHub('search')
          if (stepApplyReady && selectedCount > 0) {
            void runOneClickAutoApply({ submit: true })
          }
        },
      },
      {
        id: 'truth',
        label: 'Truth',
        done: Boolean(oneClickResult?.browser?.results?.length),
        active: Boolean(oneClickResult) && !oneClickBusy,
        onClick: () => {
          switchHub('search')
          window.setTimeout(
            () =>
              document.getElementById('apply-results')?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              }),
            80,
          )
        },
      },
    ],
    [
      stepSearchDone,
      selectedCount,
      hubMode,
      oneClickResult,
      hitlOpen,
      appliedCount,
      oneClickBusy,
      switchHub,
    ],
  )

  const coachPhase: CoachPhase = useMemo(() => {
    if (!apiOk) return 'offline'
    if (oneClickBusy) return 'applying'
    if (busy) return 'searching'
    if (oneClickResult) return 'truth'
    if (!title.trim() && !stepSearchDone) return 'start'
    if (!hasEmail) return 'need_email'
    if (!stepSearchDone) return 'ready_search'
    if (stepSearchDone && selectedCount === 0) return 'pick_jobs'
    if (stepSearchDone && selectedCount > 0 && !oneClickResult) return 'ready_apply'
    if (stepSearchDone) return 'pick_jobs'
    return 'idle'
  }, [
    apiOk,
    oneClickBusy,
    busy,
    oneClickResult,
    title,
    stepSearchDone,
    hasEmail,
    selectedCount,
  ])

  useEffect(() => {
    if (!apiOk) return
    void fetchApplyMetrics().then((m) => {
      if (m.ok) {
        setWeeklyCompleted(
          m.applications_completed_this_week ?? m.kpi?.weekly_completed ?? 0,
        )
      }
    })
  }, [apiOk, oneClickResult])

  const flowSteps: FlowStep[] = useMemo(
    () => [
      {
        id: 'search',
        label: 'Search',
        detail: stepSearchDone
          ? `${liveSeed.length} live · ${selectedCount} selected`
          : 'Type a title, then Search',
        done: stepSearchDone,
        active: hubMode === 'search' && !hasResults,
        onClick: () => switchHub('search'),
      },
      {
        id: 'profile',
        label: 'Contact',
        detail: stepProfileDone ? 'Email ready for forms' : 'Add contact email',
        done: stepProfileDone,
        active: hubMode === 'search' && (filtersOpen || (hasResults && !hasEmail)),
        onClick: () => {
          switchHub('search')
          setFiltersOpen(true)
          window.setTimeout(() => emailInputRef.current?.focus(), 100)
        },
      },
      {
        id: 'apply',
        label: 'Apply',
        detail: appliedCount > 0
          ? `${appliedCount} applied`
          : stepApplyReady && selectedCount > 0
            ? `Apply ${selectedCount} selected`
            : 'Pick roles, then apply',
        done: appliedCount > 0,
        active: hubMode === 'auto' || oneClickBusy || Boolean(oneClickResult),
        onClick: () => {
          switchHub('search')
          if (stepApplyReady && selectedCount > 0) {
            void runOneClickAutoApply({ submit: true })
          }
        },
      },
    ],
    [
      stepSearchDone,
      liveSeed.length,
      selectedCount,
      hubMode,
      hasResults,
      stepProfileDone,
      filtersOpen,
      hasEmail,
      appliedCount,
      stepApplyReady,
      oneClickBusy,
      oneClickResult,
    ],
  )

  /** Progressive nudge — one clear next action (coach already teaches the loop) */
  const nextAction: FlowNextAction | null = useMemo(() => {
    if (!lab) return null
    if (busy || oneClickBusy) return null
    if (hubMode === 'search') {
      if (stepSearchDone && !stepProfileDone) {
        return {
          stage: 'Need email',
          title: 'Add email before apply',
          detail: 'Required on employer forms.',
          cta: 'Focus email',
          onClick: () => {
            window.setTimeout(() => emailInputRef.current?.focus(), 80)
          },
          tone: 'warn' as const,
        }
      }
      if (stepApplyReady && selectedCount > 0 && !oneClickResult) {
        return {
          stage: 'Ready',
          title: `Apply ${selectedCount} selected role${selectedCount === 1 ? '' : 's'}`,
          detail: 'Shows claim sheet first, then browser form-fill. LinkedIn often stays manual.',
          cta: `Apply selected (${selectedCount})`,
          onClick: () => void runOneClickAutoApply({ submit: true }),
          tone: 'ready' as const,
          secondaryCta: 'Clear picks',
          onSecondary: () => setSelectedIds(new Set()),
        }
      }
      if (stepSearchDone && selectedCount === 0 && !oneClickResult) {
        return {
          stage: 'Pick',
          title: 'Check roles to apply',
          detail: 'Use the Pick checkbox on each card (max 4).',
          cta: 'Select top form-friendly',
          onClick: () => seedSelectionFromLive(liveSeed),
          tone: 'warn' as const,
        }
      }
      if (oneClickResult) {
        return {
          stage: 'Truth',
          title: 'Read outcomes (trust log)',
          detail: 'Submitted · filled · manual · skipped — real attempts only.',
          cta: 'Jump to truth',
          onClick: () => {
            document.getElementById('apply-results')?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          },
          tone: 'done' as const,
        }
      }
    }
    if (hubMode === 'auto' && stepSearchDone && stepProfileDone && !oneClickResult) {
      return {
        stage: 'Apply',
        title:
          selectedCount > 0
            ? `${selectedCount} selected from Search`
            : `${liveSeed.length} shortlisted from Search`,
        detail: 'Same claim sheet + browser path as Search.',
        cta:
          selectedCount > 0
            ? `Apply selected (${selectedCount})`
            : 'Apply form-friendly (up to 4)',
        onClick: () => void runOneClickAutoApply({ submit: true }),
        tone: 'ready' as const,
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lab,
    hubMode,
    busy,
    oneClickBusy,
    stepSearchDone,
    stepProfileDone,
    stepApplyReady,
    selectedCount,
    oneClickResult,
    liveSeed.length,
  ])

  if (!lab) {
    return (
      <div className="mx-auto max-w-lg glass rounded-[28px] p-10 text-center">
        <Radar className="mx-auto mb-4 h-8 w-8 text-white/30" />
        <h2 className="text-[17px] font-medium text-white/90">Job Search</h2>
        <p className="mt-2 text-[13px] text-white/40">
          Open{' '}
          <a className="text-[#5DD5E3] underline" href="http://127.0.0.1:5173/#/jobsearch">
            http://127.0.0.1:5173/#/jobsearch
          </a>
        </p>
      </div>
    )
  }

  const shellBanner = (
    <>
      {err && (
        <div className="flex items-start gap-3 rounded-xl border border-[#E85D5D]/30 bg-[#E85D5D]/[0.08] px-4 py-3 text-[13px] text-[#E85D5D]">
          <span className="flex-1 whitespace-pre-wrap">{err}</span>
          <button type="button" onClick={() => setErr(null)} className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {toast && !busy && (
        <div className="flex items-center gap-2 rounded-xl border border-[#20B8CD]/25 bg-[#20B8CD]/[0.08] px-4 py-2.5 text-[13px] text-[#5DD5E3]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1">{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="opacity-50 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  )

  return (
    <JobHubShell
      hubMode={hubMode}
      onSwitch={switchHub}
      playbooksOpen={playbooksOpen}
      onTogglePlaybooks={() => setPlaybooksOpen((o) => !o)}
      liveCount={liveSeed.length}
      appliedCount={appliedCount}
      shortlistCount={shortlistCount}
      apiOk={apiOk}
      connectivity={connectivity}
      flowSteps={flowSteps}
      journey={journey}
      weeklyCompleted={weeklyCompleted}
      onOpenMetrics={() => {
        setPlaybooksOpen(true)
        switchHub('metrics')
      }}
      // Simplest Next rail: coach owns primary CTA — suppress duplicate FlowNext banner
      nextAction={
        hubMode === 'search' || hubMode === 'auto' ? null : nextAction
      }
      coach={
        hubMode === 'search' || hubMode === 'auto' ? (
          <JobsCoach
            phase={coachPhase}
            selectedCount={selectedCount}
            liveCount={liveSeed.length}
            primaryLabel={
              coachPhase === 'offline'
                ? undefined
                : coachPhase === 'need_email'
                  ? 'Focus email'
                  : coachPhase === 'ready_search' || coachPhase === 'start'
                    ? 'Search live boards'
                    : coachPhase === 'pick_jobs' && selectedCount === 0
                      ? 'Select top form-friendly'
                      : coachPhase === 'ready_apply'
                        ? `Apply selected (${selectedCount})`
                        : coachPhase === 'truth'
                          ? 'Jump to trust log'
                          : undefined
            }
            primaryDisabled={
              coachPhase === 'offline' ||
              (coachPhase === 'ready_search' && !apiOk) ||
              (coachPhase === 'ready_apply' && (!apiOk || !hasEmail))
            }
            onPrimary={
              coachPhase === 'need_email'
                ? () => window.setTimeout(() => emailInputRef.current?.focus(), 80)
                : coachPhase === 'ready_search' || coachPhase === 'start'
                  ? () => void run()
                  : coachPhase === 'pick_jobs' && selectedCount === 0
                    ? () => seedSelectionFromLive(liveSeed)
                    : coachPhase === 'ready_apply'
                      ? () => void runOneClickAutoApply({ submit: true })
                      : coachPhase === 'truth'
                        ? () => {
                            switchHub('search')
                            window.setTimeout(
                              () =>
                                document
                                  .getElementById('apply-results')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                              80,
                            )
                          }
                        : undefined
            }
            secondaryLabel={
              coachPhase === 'start' || coachPhase === 'ready_search'
                ? 'Search only (no apply)'
                : coachPhase === 'ready_apply'
                  ? 'Advanced options'
                  : coachPhase === 'truth'
                    ? 'Dismiss & pick more'
                    : undefined
            }
            onSecondary={
              coachPhase === 'start' || coachPhase === 'ready_search'
                ? () => {
                    // Focus search — do not surprise-apply
                    window.setTimeout(() => {
                      document
                        .querySelector<HTMLInputElement>('[data-testid="run-search"]')
                        ?.focus()
                    }, 40)
                  }
                : coachPhase === 'ready_apply'
                  ? () => {
                      setPlaybooksOpen(true)
                      switchHub('metrics')
                    }
                  : coachPhase === 'truth'
                    ? () => {
                        setOneClickResult(null)
                        switchHub('search')
                      }
                    : undefined
            }
          />
        ) : null
      }
      banner={shellBanner}
    >
      <HitlClaimGate
        open={hitlOpen}
        preview={
          hitlPreview || {
            jobCount: 0,
            willSubmit: true,
          }
        }
        onCancel={() => {
          setHitlOpen(false)
          const cancel = (hitlPendingRef as { cancel?: () => void }).cancel
          hitlPendingRef.current = null
          cancel?.()
        }}
        onConfirm={() => {
          setHitlOpen(false)
          const fn = hitlPendingRef.current
          hitlPendingRef.current = null
          ;(hitlPendingRef as { cancel?: () => void }).cancel = undefined
          fn?.()
        }}
      />
      {hubMode === 'auto' && (
        <AutoApplyPage
          embedded
          seedJobs={liveSeed}
          seedTitle={title}
          seedSkills={skills}
          seedResume={sanitizeResumeText(resumeText) || undefined}
          seedEmail={effectiveEmail || email}
          seedPhone={phone}
          onSwitchSearch={() => switchHub('search')}
          seedOneClickResult={oneClickResult}
          onApplyLifecycle={() => void runFullLifecycle()}
        />
      )}

      {hubMode === 'night' && (
        <NightScoutPage
          embedded
          onSwitchSearch={() => switchHub('search')}
          onSwitchAuto={() => switchHub('auto')}
        />
      )}

      {(() => {
        const pb = {
          jobs: liveSeed,
          profile: currentProfile(),
          apiOk,
          onNeedSearch: () => switchHub('search'),
          onToast: (m: string) => setToast(m),
          onErr: (m: string) => setErr(m),
          onTracker: setTracker,
          strictSoft,
          onStrictSoftChange: setStrictSoftPersist,
        }
        // Advanced only: form pack + metrics (Marvel/Nexus/AIHawk marketing stack removed)
        if (hubMode === 'autofill') return <AutofillPlaybook {...pb} />
        if (hubMode === 'metrics') return <ApplyMetricsPage />
        return null
      })()}

      {hubMode === 'search' && (
        <div className="jobs-result-enter flex flex-col gap-4">
      {/* Live pipeline status — every step as it finishes */}
      {(oneClickBusy || pipeSteps.length > 0) && (
        <div
          id="pipeline-status"
          className="jobs-command overflow-hidden border-[#20B8CD]/25"
        >
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
            {oneClickBusy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#5DD5E3]" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#20B8CD]" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white/90">
                {oneClickBusy ? 'Pipeline running' : 'Pipeline finished'}
              </p>
              <p className="text-[12px] text-white/40">
                {oneClickProgress || '—'}
              </p>
            </div>
            {oneClickBusy ? (
              <Button size="sm" variant="ghost" onClick={cancelPipeline}>
                Stop
              </Button>
            ) : (
              pipeSteps.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-white/35 hover:text-white/70"
                  onClick={() => {
                    setPipeSteps([])
                    setOneClickProgress(null)
                    setOneClickResult(null)
                  }}
                >
                  Dismiss
                </button>
              )
            )}
          </div>
          <ol className="max-h-64 divide-y divide-white/[0.04] overflow-y-auto">
            {pipeSteps.map((s) => (
              <li
                key={s.id}
                data-kit-tone={s.kitTone || undefined}
                className={cn(
                  'flex items-start gap-3 px-4 py-2.5 text-[12px]',
                  s.kitTone === 'soft' && 'border-l-2 border-l-[#E8C547]/70 bg-[#E8C547]/[0.06]',
                  s.kitTone === 'id' && 'border-l-2 border-l-[#20B8CD]/50 bg-[#20B8CD]/[0.04]',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    s.status === 'running' && 'bg-[#20B8CD]/20 text-[#5DD5E3]',
                    s.status === 'done' &&
                      (s.kitTone === 'soft'
                        ? 'bg-[#E8C547]/30 text-[#E8C547]'
                        : 'bg-[#20B8CD] text-[#0c0c0c]'),
                    s.status === 'error' && 'bg-[#E85D5D]/25 text-[#E85D5D]',
                    s.status === 'skip' && 'bg-white/10 text-white/40',
                    s.status === 'pending' &&
                      (s.kitTone === 'soft'
                        ? 'bg-[#E8C547]/20 text-[#E8C547]'
                        : s.kitTone === 'id'
                          ? 'bg-[#20B8CD]/20 text-[#5DD5E3]'
                          : 'bg-white/[0.06] text-white/30'),
                  )}
                >
                  {s.status === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : s.status === 'done' ? (
                    s.kitTone === 'soft' ? '!' : '✓'
                  ) : s.status === 'error' ? (
                    '!'
                  ) : s.status === 'skip' ? (
                    '–'
                  ) : (
                    '·'
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'font-medium',
                      s.status === 'running' ? 'text-[#5DD5E3]' : 'text-white/85',
                    )}
                  >
                    {s.label}
                    {s.kitTone === 'soft' && (
                      <span
                        className="ml-2 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#E8C547] bg-[#E8C547]/15"
                        title="Same-board soft pack match — materials may be for a sibling job"
                      >
                        soft kit
                      </span>
                    )}
                    {s.kitTone === 'id' && (
                      <span
                        className="ml-2 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#5DD5E3] bg-[#20B8CD]/15"
                        title="Job-id / path token match — high confidence kit pack"
                      >
                        id kit
                      </span>
                    )}
                  </p>
                  {s.detail && (
                    <p
                      className={cn(
                        'mt-0.5 break-words text-[11px]',
                        s.kitTone && s.kitTone !== 'none'
                          ? kitMatchToneTextClass(s.kitTone)
                          : 'text-white/35',
                      )}
                    >
                      {s.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {filtersDirty && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E8C547]/25 bg-[#E8C547]/[0.07] px-4 py-3 text-[13px] text-[#E8C547]">
          <span className="flex-1">Criteria changed — shortlist may be stale.</span>
          <Button size="sm" onClick={() => void run()} disabled={busy || !apiOk}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh results
          </Button>
        </div>
      )}

      {/* ── Usable search form: everything you need visible ── */}
      <section className={cn('jobs-command overflow-hidden', !hasResults && 'jobs-command-primary')}>
        <div className="space-y-4 p-5 md:p-6">
          {/* Row 1: Role + email — Material outlined fields */}
          <div className="grid gap-5 md:grid-cols-[1fr_minmax(200px,260px)]">
            <label className="min-w-0">
              <span className="jobs-label mb-2 block">Job title</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0a6]" />
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter = Search only (never surprise-apply)
                    if (e.key === 'Enter' && !busy && apiOk) void run()
                  }}
                  placeholder="Software Engineer"
                  className="field !pl-10 h-12 text-[16px]"
                  autoComplete="organization-title"
                />
              </div>
            </label>
            <label className="min-w-0">
              <span className="jobs-label mb-2 block">
                Email <span className="text-[#80868b]">for applications</span>
              </span>
              <input
                ref={emailInputRef}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@email.com"
                className={cn(
                  'field h-12 text-[15px]',
                  !hasEmail && 'border-[#fdd663]',
                )}
                autoComplete="email"
              />
            </label>
          </div>

          {/* Row 2: Skills + summary */}
          <div className="grid gap-5 md:grid-cols-2">
            <label className="min-w-0">
              <span className="jobs-label mb-2 flex items-center justify-between">
                Skills
                {skills.trim() ? (
                  <button
                    type="button"
                    className="text-[12px] font-medium text-[#8ab4f8] hover:underline"
                    onClick={() => setSkills('')}
                  >
                    Clear
                  </button>
                ) : null}
              </span>
              <input
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className="field h-12 text-[15px]"
                placeholder="python, react, typescript…"
                autoComplete="off"
              />
            </label>
            <label className="min-w-0">
              <span className="jobs-label mb-2 flex items-center justify-between">
                Summary
                {summary.trim() ? (
                  <button
                    type="button"
                    className="text-[12px] font-medium text-[#8ab4f8] hover:underline"
                    onClick={() => setSummary('')}
                  >
                    Clear
                  </button>
                ) : null}
              </span>
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="field h-12 text-[15px]"
                placeholder="One line about you (optional)"
                autoComplete="off"
              />
            </label>
          </div>

          {/* Row 3: location chips + actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={locationMode === 'us' ? 'us' : 'all'}
                onChange={(v) => {
                  if (v === 'us') setLocationMode('us')
                  else if (locationMode === 'us') setLocationMode('all')
                }}
                options={[
                  { value: 'us', label: 'US' },
                  { value: 'all', label: 'Anywhere' },
                ]}
              />
              <Segmented
                value={remote === 'remote' ? 'remote' : 'all'}
                onChange={(v) => setRemote(v === 'remote' ? 'remote' : 'all')}
                options={[
                  { value: 'all', label: 'All modes' },
                  { value: 'remote', label: 'Remote' },
                ]}
              />
              <button
                type="button"
                onClick={() => {
                  const nextExclude = !excludeLinkedIn
                  setExcludeLinkedIn(nextExclude)
                  if (result && apiOk && !busy) {
                    void run({ exclude_linkedin: nextExclude })
                  }
                }}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-medium transition',
                  !excludeLinkedIn
                    ? 'border-[#20B8CD]/45 bg-[#20B8CD]/15 text-[#5DD5E3]'
                    : 'border-white/[0.08] bg-black/40 text-white/45 hover:text-white/70',
                )}
              >
                <Linkedin className="h-3.5 w-3.5" />
                LinkedIn {excludeLinkedIn ? 'off' : 'on'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <Button
                size="lg"
                className={cn(
                  'h-11 min-w-[120px]',
                  !hasResults && 'jobs-primary-cta',
                )}
                variant={hasResults ? 'secondary' : undefined}
                disabled={busy || oneClickBusy || !apiOk}
                onClick={() => void run()}
                data-testid="run-search"
              >
                {busy && !oneClickBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {busy && !oneClickBusy ? 'Searching…' : 'Search'}
              </Button>
              {hasResults && hasEmail ? (
                <Button
                  size="lg"
                  className="jobs-primary-cta h-11 min-w-[160px]"
                  disabled={
                    oneClickBusy ||
                    busy ||
                    !apiOk ||
                    selectedCount === 0 ||
                    liveJobs.length === 0
                  }
                  onClick={() => void runOneClickAutoApply({ submit: true })}
                  data-testid="run-apply-selected"
                >
                  {oneClickBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {oneClickBusy
                    ? oneClickProgress || 'Applying…'
                    : `Apply selected (${selectedCount})`}
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-11 min-w-[160px]"
                  variant="secondary"
                  disabled={busy || oneClickBusy || !apiOk || !hasEmail}
                  onClick={() => void runFullLifecycle()}
                  data-testid="run-lifecycle"
                  title="Optional: search then immediately try form-fill on up to 4 form-friendly roles"
                >
                  {oneClickBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {oneClickBusy
                    ? oneClickProgress || 'Working…'
                    : 'Search & try form-fill'}
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.05] pt-3">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] transition',
                filtersOpen
                  ? 'bg-white/[0.05] text-[#5DD5E3]'
                  : 'text-white/40 hover:bg-white/[0.04] hover:text-[#5DD5E3]',
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {filtersOpen ? 'Hide more options' : 'Phone, resume & more'}
              {filtersOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            {hasResume && (
              <span className="text-[11px] text-[#5DD5E3]/80">
                Resume · {resumeName || 'attached'}
              </span>
            )}
            {filtersDirty && (
              <span className="text-[11px] text-[#E8C547]">Criteria changed — re-search</span>
            )}
          </div>
        </div>

        {/* Advanced: phone, resume, limits only */}
        {filtersOpen && (
          <div className="border-t border-white/[0.06] bg-black/20 p-4 md:p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
                  Contact for form fill
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-white/40">Phone</span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="field h-10 text-[13px]"
                      placeholder="+1 555…"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-white/40">Years experience</span>
                    <input
                      value={yearsExperience}
                      onChange={(e) => setYearsExperience(e.target.value)}
                      className="field h-10 text-[13px]"
                      placeholder="5"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-white/40">LinkedIn URL</span>
                    <input
                      value={linkedinUrl}
                      onChange={(e) => setLinkedinUrl(e.target.value)}
                      className="field h-10 text-[13px]"
                      placeholder="https://linkedin.com/in/…"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-white/40">Portfolio</span>
                    <input
                      value={portfolioUrl}
                      onChange={(e) => setPortfolioUrl(e.target.value)}
                      className="field h-10 text-[13px]"
                      placeholder="https://…"
                    />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                    Work mode
                  </span>
                  <select
                    value={remote}
                    onChange={(e) => setRemote(e.target.value as RemoteFilter)}
                    className="field h-10 !py-0 text-[13px]"
                  >
                    <option value="all">All</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="onsite">Onsite</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                    Region
                  </span>
                  <select
                    value={locationMode}
                    onChange={(e) =>
                      setLocationMode(e.target.value as 'all' | 'us' | 'custom')
                    }
                    className="field h-10 !py-0 text-[13px]"
                  >
                    <option value="us">US only</option>
                    <option value="all">Anywhere</option>
                    <option value="custom">Custom city…</option>
                  </select>
                </label>
                {locationMode === 'custom' && (
                  <label className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                      City / region
                    </span>
                    <input
                      value={locationCustom}
                      onChange={(e) => setLocationCustom(e.target.value)}
                      className="field h-10 text-[13px]"
                      placeholder="Chicago, Texas…"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                    Min score
                  </span>
                  <select
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    className="field h-10 !py-0 text-[13px]"
                  >
                    <option value={0}>Any</option>
                    <option value={40}>40+</option>
                    <option value={55}>55+</option>
                    <option value={70}>70+</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                    Max results
                  </span>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="field h-10 !py-0 text-[13px]"
                  >
                    {[50, 100, 200, 300].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="md:col-span-2 flex flex-wrap items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-white/50">
                  <input
                    type="checkbox"
                    checked={includeSeed}
                    onChange={(e) => setIncludeSeed(e.target.checked)}
                    className="accent-[#E8C547]"
                  />
                  <span className="text-[#E8C547]/90">Practice market</span>
                  <span className="text-white/30">(synthetic drills only)</span>
                </label>
                <div className="mx-1 h-4 w-px bg-white/10" />
                <FileText className="h-4 w-4 shrink-0 text-[#5DD5E3]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-white/80">
                    {hasResume ? resumeName || 'Resume attached' : 'Resume optional'}
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,application/pdf"
                  className="hidden"
                  onChange={(e) => void onUploadResume(e.target.files)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={uploadBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="h-3.5 w-3.5" />
                  )}
                  Upload
                </Button>
                {resumes.length > 0 && (
                  <select
                    value={resumeId}
                    onChange={(e) => onPickResumeDoc(e.target.value)}
                    className="h-8 rounded-lg border border-white/[0.08] bg-[#141414] px-2 text-[11px] text-white/70"
                  >
                    <option value="">Knowledge…</option>
                    {resumes.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Loading (keep previous results under a light overlay feel) ── */}
      {busy && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#20B8CD]/25 bg-[#20B8CD]/08 px-4 py-3 text-[13px] text-[#5DD5E3]">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>
            Searching live boards
            {title ? ` for “${title}”` : ''}…
          </span>
          <span className="ml-auto text-[11px] text-white/35">usually 4–12s</span>
        </div>
      )}

      {/* ── Empty: short title chips (coach above teaches the loop) ── */}
      {!hasResults && !busy && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] text-white/40">
          <span className="text-white/55">Quick start titles: </span>
          {['Software Engineer', 'React Developer', 'Python Engineer'].map((t, i) => (
            <button
              key={t}
              type="button"
              className="text-[#5DD5E3]/90 underline-offset-2 hover:underline"
              onClick={() => setTitle(t)}
            >
              {t}
              {i < 2 ? ' · ' : ''}
            </button>
          ))}
          <span className="mt-1 block text-[12px] text-white/30">
            Primary button is <strong className="font-medium text-white/50">Search</strong>. After results,
            check roles and use <strong className="font-medium text-white/50">Apply selected</strong>.
          </span>
        </div>
      )}

      {/* ── Results (stay visible while re-searching) ── */}
      {hasResults && (
        <div
          ref={resultsRef}
          className={cn(
            'jobs-result-enter flex flex-col gap-4',
            busy && !oneClickBusy && 'pointer-events-none opacity-50 transition-opacity',
          )}
        >
          {/* Sticky action rail */}
          <div className="jobs-sticky-actions">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold tracking-tight text-white/95">
                  Results
                  <span className="ml-2 font-normal tabular-nums text-white/40">
                    {displayed.length}
                  </span>
                </h2>
              </div>

              {practiceJobs.length > 0 && (
                <div className="flex rounded-lg border border-white/[0.08] p-0.5">
                  <button
                    type="button"
                    onClick={() => setShowPractice(false)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium',
                      !showPractice
                        ? 'bg-[#20B8CD] text-[#0C0C0C]'
                        : 'text-white/40 hover:text-white/70',
                    )}
                  >
                    Live {liveJobs.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPractice(true)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium',
                      showPractice
                        ? 'bg-[#E8C547] text-[#0C0C0C]'
                        : 'text-white/40 hover:text-white/70',
                    )}
                  >
                    + Practice {practiceJobs.length}
                  </button>
                </div>
              )}

              {elapsed > 0 && (
                <span className="text-[11px] tabular-nums text-white/30">
                  {(elapsed / 1000).toFixed(1)}s
                </span>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  data-testid="auto-apply"
                  onClick={() => {
                    if (!effectiveEmail) {
                      setErr('Add your email above before applying.')
                      window.setTimeout(() => emailInputRef.current?.focus(), 80)
                      return
                    }
                    if (selectedCount === 0) {
                      setErr('Check at least one role (Pick) before apply.')
                      return
                    }
                    void runOneClickAutoApply({ submit: true })
                  }}
                  disabled={
                    oneClickBusy ||
                    busy ||
                    liveJobs.length === 0 ||
                    !apiOk ||
                    selectedCount === 0
                  }
                  className="jobs-primary-cta"
                >
                  {oneClickBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  {oneClickBusy
                    ? oneClickProgress || 'Applying…'
                    : `Apply selected (${selectedCount})`}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={liveJobs.length === 0}
                  onClick={() => seedSelectionFromLive(liveJobs)}
                  title="Pre-check up to 4 form-friendly roles"
                >
                  Select top 4
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={selectedCount === 0}
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear picks
                </Button>
                <StrictSoftToggle
                  strictSoft={strictSoft}
                  onChange={setStrictSoftPersist}
                  className="!py-1.5"
                />
                <Button
                  size="sm"
                  onClick={() => switchHub('auto')}
                  disabled={liveJobs.length === 0}
                  variant="secondary"
                >
                  <Rocket className="h-3.5 w-3.5" />
                  More options
                </Button>
                <button
                  type="button"
                  onClick={() => setToolsOpen((o) => !o)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] transition',
                    toolsOpen
                      ? 'bg-white/[0.06] text-white/70'
                      : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70',
                  )}
                >
                  Tools
                  {toolsOpen ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
                  <input
                    value={queryFilter}
                    onChange={(e) => setQueryFilter(e.target.value)}
                    placeholder="Filter list…"
                    className="h-9 w-36 rounded-xl border border-white/[0.08] bg-black/40 pl-8 pr-3 text-[12px] text-white/80 outline-none focus:border-[#20B8CD]/40 md:w-48"
                  />
                </div>
                <select
                  value={sourceFilter}
                  onChange={(e) =>
                    setSourceFilter(e.target.value as typeof sourceFilter)
                  }
                  className="h-9 rounded-xl border border-white/[0.08] bg-black/40 px-2.5 text-[12px] text-white/70"
                >
                  <option value="all">All sources</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="freehire">freehire</option>
                  <option value="other">Other</option>
                </select>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="h-9 rounded-xl border border-white/[0.08] bg-black/40 px-2.5 text-[12px] text-white/70"
                >
                  <option value="score">Sort: score</option>
                  <option value="title">Sort: title</option>
                  <option value="company">Sort: company</option>
                  <option value="source">Sort: source</option>
                </select>
              </div>
            </div>

            {toolsOpen && (
              <div className="mt-2.5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-2.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={oneClickBusy || liveJobs.length === 0}
                  onClick={() => void runOneClickAutoApply({ submit: false })}
                >
                  Fill only (no submit)
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={applyBusy || liveJobs.length === 0 || !apiOk}
                  onClick={() => {
                    setStudioOpen(true)
                    void runApplyStudio()
                  }}
                >
                  HITL queue
                </Button>
                {/* Marvel marketing pipeline removed — use Apply tab */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={tailorRtBusy || liveJobs.length === 0 || !apiOk}
                  onClick={() => void runTailorRTForShortlist()}
                  title="Multi-agent: Analyze JD → Tailor resume → Validate (RT loop)"
                  data-testid="tailor-rt"
                >
                  {tailorRtBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Tailor RT
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={kitBusy || !apiOk}
                  onClick={() => void exportApplyKit()}
                  title="AI-tailored resume + answers for Chrome extension autofill"
                  data-testid="export-apply-kit"
                >
                  {kitBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  Export Apply Kit
                </Button>
              </div>
            )}
          </div>

          {/* Compact kit line — not a second product wall */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] text-white/40">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-[#5DD5E3]/80" />
              <span className="min-w-0 flex-1">
                Chrome autofill kit ·{' '}
                <code className="text-[11px] text-white/30">extension/astra-apply-kit</code>
                {applyKit?.job_packs?.length
                  ? ` · ${applyKit.job_packs.length} pack(s) ready`
                  : ''}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={kitBusy || !apiOk}
                onClick={() => void exportApplyKit()}
                data-testid="export-apply-kit"
              >
                {kitBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Export kit
              </Button>
            </div>
            {!!applyKit?.job_packs?.length && (
              <div className="mt-2 space-y-2 border-t border-white/[0.05] pt-2">
                {formPackInjectRows(applyKit, 4).map((row) => (
                  <div key={row.jobId || row.title} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {row.active && (
                        <span className="rounded bg-[#20B8CD]/25 px-1.5 py-0.5 text-[10px] font-bold text-[#5DD5E3]">
                          active
                        </span>
                      )}
                      {row.grade && (
                        <span className="rounded bg-[#7C5CFF]/25 px-1.5 py-0.5 font-bold text-[#B8A6FF]">
                          {row.grade}
                        </span>
                      )}
                      <span className="min-w-0 truncate text-white/70">
                        {row.title}
                        {row.company ? ` · ${row.company}` : ''}
                      </span>
                      {row.rtPassed === true && (
                        <span className="text-[10px] text-[#20B8CD]">RT ok</span>
                      )}
                      {row.rtPassed === false && (
                        <span className="text-[10px] text-[#E8C547]">RT gaps</span>
                      )}
                    </div>
                    {row.injects.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.injects.map((k) => (
                          <span
                            key={k}
                            className="rounded-md bg-[#20B8CD]/15 px-1.5 py-0.5 text-[10px] text-[#5DD5E3]"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-white/30">
                        No new keyword injects (profile already covered JD)
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {serverWarnings.length > 0 && (
            <div className="rounded-2xl border border-[#E8C547]/25 bg-[#E8C547]/08 px-4 py-3 text-[12px] text-[#E8C547]/90">
              <ul className="space-y-1">
                {serverWarnings.slice(0, 3).map((w) => (
                  <li key={w}>· {w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Trust UI */}
          {oneClickResult && (
            <div className="relative">
              <button
                type="button"
                className="absolute right-3 top-3 z-10 text-[#80868b] hover:text-[#e8eaed]"
                onClick={() => setOneClickResult(null)}
                aria-label="Dismiss results"
              >
                <X className="h-4 w-4" />
              </button>
              <ApplyTrustPanel res={oneClickResult} title="Apply trust log" />
            </div>
          )}

          {/* ── Tailor RT: multi-agent validate loop ── */}
          {tailorRt && tailorRtOpen && (
            <section className="glass overflow-hidden rounded-[24px] border border-[#20B8CD]/35">
              <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-[#20B8CD]/15 via-[#7C5CFF]/10 to-transparent px-4 py-3 md:px-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#20B8CD]/25">
                  <Sparkles className="h-4 w-4 text-[#5DD5E3]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-white/95">
                    Tailor RT · Analyze → Tailor → Validate
                  </h3>
                  <p className="text-[11px] text-white/40">
                    GARY / ApplyPilot / Tailr patterns · evidence-grounded · never fabricates
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={tailorRtBusy}
                  onClick={() => void runTailorRTForShortlist()}
                >
                  {tailorRtBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Re-run
                </Button>
                <button
                  type="button"
                  onClick={() => setTailorRtOpen(false)}
                  className="text-white/35 hover:text-white/70"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-3 border-b border-white/[0.05] px-4 py-2.5 text-[11px] text-white/45 md:px-5">
                <span>
                  Variants <strong className="text-white/80">{tailorRt.count ?? 0}</strong>
                </span>
                <span>
                  Passed{' '}
                  <strong className="text-[#5DD5E3]">{tailorRt.passed_n ?? 0}</strong>
                </span>
                {tailorRt.elapsed_ms != null && (
                  <span className="text-white/30">
                    {(tailorRt.elapsed_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {(tailorRt.results || []).map((r, i) => (
                  <div
                    key={String(r.job?.id || i)}
                    className="border-b border-white/[0.04] px-4 py-3 md:px-5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-bold',
                          r.passed
                            ? 'bg-[#20B8CD]/20 text-[#5DD5E3]'
                            : 'bg-[#E85D5D]/15 text-[#E85D5D]',
                        )}
                      >
                        {r.passed ? 'PASS' : 'FAIL'} · {r.grade || '?'} ·{' '}
                        {r.overall_score ?? 0}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-white/90">
                        {r.job?.title} @ {r.job?.company}
                      </span>
                      {r.forged_resume && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void navigator.clipboard.writeText(r.forged_resume || '')
                            setToast('Tailored resume copied')
                          }}
                        >
                          Copy resume
                        </Button>
                      )}
                    </div>
                    {!!r.suggestions?.length && (
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-white/40">
                        {r.suggestions.slice(0, 3).map((s) => (
                          <li key={s}>→ {s}</li>
                        ))}
                      </ul>
                    )}
                    {!!r.agents?.evidence?.unsupported_must?.length && (
                      <p className="mt-1 text-[10px] text-[#E8C547]/80">
                        Honest gaps:{' '}
                        {r.agents.evidence.unsupported_must.slice(0, 6).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {marvelResumeText && (
                <div className="border-t border-white/[0.06] px-4 py-3 md:px-5">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-white/40">
                    <span>Best tailored resume preview</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResumeText(marvelResumeText.slice(0, 8000))
                        setToast('Applied tailored text to Search resume field')
                      }}
                    >
                      Use as resume
                    </Button>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-[11px] text-white/65">
                    {marvelResumeText.slice(0, 1800)}
                    {marvelResumeText.length > 1800 ? '…' : ''}
                  </pre>
                </div>
              )}
              <p className="border-t border-white/[0.04] px-4 py-2.5 text-[11px] leading-relaxed text-white/30">
                Agents never invent employers or degrees. Open Tools → Tailor RT after Search.
                Form packs and auto-apply now use the same validator-gated tailor.
              </p>
            </section>
          )}

          {/* ── Marvel Apply command center ── */}
          {marvel && marvelOpen && (
            <section className="glass overflow-hidden rounded-[24px] border border-[#7C5CFF]/35">
              <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-[#7C5CFF]/15 via-[#20B8CD]/10 to-transparent px-4 py-3 md:px-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#7C5CFF]/25">
                  <Sparkles className="h-4 w-4 text-[#B8A6FF]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-white/95">
                    Marvel Apply · {marvel.codename || 'Prometheus'}
                  </h3>
                  <p className="text-[11px] text-white/40">
                    19-engine SOTA match + Resume Forge · human-in-the-loop · never auto-submits
                  </p>
                </div>
                <Button size="sm" variant="secondary" disabled={marvelBusy} onClick={() => void runMarvel()}>
                  {marvelBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Re-run
                </Button>
                <button type="button" onClick={() => setMarvelOpen(false)} className="text-white/35 hover:text-white/70">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-3 border-b border-white/[0.05] px-4 py-2.5 text-[11px] text-white/45 md:px-5">
                <span>
                  Ranked <strong className="text-white/80">{marvel.stats?.marvel_ranked ?? 0}</strong>
                </span>
                <span>
                  Queue <strong className="text-[#5DD5E3]">{marvel.stats?.queued ?? 0}</strong>
                </span>
                <span>
                  Forged <strong className="text-[#B8A6FF]">{marvel.stats?.forged ?? 0}</strong>
                </span>
                <span>
                  Pareto <strong className="text-white/70">{marvel.stats?.pareto_count ?? 0}</strong>
                </span>
                <span>
                  Ising <strong className="text-white/70">{marvel.stats?.ising_selected ?? 0}</strong>
                </span>
                {marvel.control?.pid_suggested_budget != null && (
                  <span>
                    PID budget <strong className="text-white/70">{marvel.control.pid_suggested_budget}</strong>
                  </span>
                )}
                {marvel.elapsed_ms != null && (
                  <span className="text-white/30">{(marvel.elapsed_ms / 1000).toFixed(1)}s</span>
                )}
              </div>
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="max-h-[380px] overflow-y-auto border-b border-white/[0.06] p-3 lg:border-b-0 lg:border-r">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-white/30">
                    Engines ({marvel.engines?.length ?? 0})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(marvel.engines || []).map((e) => (
                      <span
                        key={e}
                        className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/45"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 mb-2 text-[10px] uppercase tracking-wide text-white/30">
                    Top marvel scores
                  </div>
                  <div className="space-y-1.5">
                    {(marvel.ranked_jobs || []).slice(0, 8).map((j, i) => (
                      <div
                        key={j.id}
                        className="flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-[11px]"
                      >
                        <span className="text-[#B8A6FF] tabular-nums w-5">#{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-white/80">{j.title}</span>
                        <span className="tabular-nums text-[#5DD5E3]">
                          {(j.scores as { marvel?: number })?.marvel ?? j.scores?.ensemble ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="max-h-[380px] overflow-y-auto p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-white/30">
                      Forged resume (edit before use)
                    </span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[10px] text-[#B8A6FF]"
                      onClick={() => void copyText(marvelResumeText, 'forged resume')}
                    >
                      <Copy className="h-3 w-3" /> Copy all
                    </button>
                  </div>
                  <textarea
                    value={marvelResumeText}
                    onChange={(e) => setMarvelResumeText(e.target.value)}
                    className="h-48 w-full resize-y rounded-xl border border-white/[0.08] bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/60 outline-none focus:border-[#7C5CFF]/40"
                    placeholder="Run Marvel Apply to forge a tailored working resume…"
                  />
                  {!!marvel.queue?.[0]?.resume_forge?.injects?.length && (
                    <div className="mt-2">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-white/30">
                        Keyword injects (authenticity-constrained)
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {marvel.queue[0].resume_forge!.injects!.map((k) => (
                          <span
                            key={k}
                            className="rounded-md bg-[#7C5CFF]/15 px-2 py-0.5 text-[10px] text-[#B8A6FF]"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-3 text-[10px] leading-relaxed text-white/25">
                    {marvel.honesty}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {marvel.queue?.[0]?.apply_url && (
                      <Button
                        size="sm"
                        onClick={() => {
                          if (marvel.queue?.[0]) void applyWithPacket(marvel.queue[0])
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Apply #1 with forged pack
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (marvelResumeText) {
                          setResumeText(marvelResumeText.slice(0, 8000))
                          setToast('Forged resume loaded into profile for re-rank')
                        }
                      }}
                    >
                      Use as my resume text
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── AI Apply Studio ── */}
          {(applyQueue || activePacket) && studioOpen && (
            <section
              id="apply-studio"
              className="glass overflow-hidden rounded-[24px] border border-[#20B8CD]/25"
            >
              <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-[#20B8CD]/10 to-transparent px-4 py-3 md:px-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#20B8CD]/20">
                  <Zap className="h-4 w-4 text-[#5DD5E3]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-white/95">AI Apply Studio</h3>
                  <p className="text-[11px] text-white/40">
                    Cover note · STAR bullets · ATS keywords · open or browser-fill
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-white/45">
                  Budget
                  <select
                    value={applyBudget}
                    onChange={(e) => setApplyBudget(Number(e.target.value))}
                    className="h-7 rounded-md border border-white/10 bg-[#141414] px-1.5 text-[11px] text-white/80"
                  >
                    {[5, 8, 10, 12, 15].map((n) => (
                      <option key={n} value={n}>
                        {n}/day
                      </option>
                    ))}
                  </select>
                </label>
                <Button size="sm" variant="secondary" disabled={applyBusy} onClick={() => void runApplyStudio()}>
                  {applyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Rebuild
                </Button>
                <button
                  type="button"
                  onClick={() => setStudioOpen(false)}
                  className="text-white/35 hover:text-white/70"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {applyQueue?.stats && (
                <div className="flex flex-wrap gap-3 border-b border-white/[0.05] px-4 py-2.5 text-[11px] text-white/45 md:px-5">
                  <span>
                    Queued <strong className="text-white/80">{applyQueue.stats.queued ?? 0}</strong>
                  </span>
                  <span>
                    Ready <strong className="text-[#5DD5E3]">{applyQueue.stats.ready_to_apply ?? 0}</strong>
                  </span>
                  <span>
                    Threshold τ=
                    <strong className="text-white/70">{applyQueue.secretary_threshold ?? '—'}</strong>
                  </span>
                  <span className="text-white/30">
                    MMR · secretary · EV · Thompson · Bayes · ATS · knapsack
                  </span>
                </div>
              )}

              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                {/* Queue list */}
                <div className="max-h-[420px] overflow-y-auto border-b border-white/[0.06] lg:border-b-0 lg:border-r">
                  {(applyQueue?.queue || []).length === 0 && (
                    <p className="p-4 text-[12px] text-white/40">
                      No live roles in queue. Run search with live results, then rebuild.
                    </p>
                  )}
                  {(applyQueue?.queue || []).map((p) => {
                    const active = activePacket?.job_id === p.job_id
                    return (
                      <button
                        key={String(p.job_id)}
                        type="button"
                        onClick={() => setActivePacket(p)}
                        className={cn(
                          'flex w-full items-start gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition',
                          active ? 'bg-[#20B8CD]/12' : 'hover:bg-white/[0.03]',
                        )}
                      >
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[11px] font-semibold text-[#5DD5E3]">
                          {p.queue_rank ?? '·'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-white/90">{p.title}</div>
                          <div className="truncate text-[11px] text-white/40">
                            {p.company} · pri {p.apply_priority ?? '—'} ·{' '}
                            <span
                              className={cn(
                                p.action === 'apply_now' && 'text-[#5DD5E3]',
                                p.action === 'strengthen' && 'text-[#E8C547]',
                                p.action === 'blocked_practice' && 'text-[#E85D5D]',
                              )}
                            >
                              {p.action_label || p.action}
                            </span>
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-white/35">
                          {Math.round((p.readiness || 0) * 100)}%
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Packet detail */}
                <div className="max-h-[420px] overflow-y-auto p-4 md:p-5">
                  {!activePacket ? (
                    <p className="text-[12px] text-white/40">Select a role from the queue.</p>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[15px] font-semibold text-white/95">{activePacket.title}</h4>
                        <p className="text-[12px] text-white/45">
                          {activePacket.company} · fit {activePacket.ensemble_fit} · EV{' '}
                          {activePacket.expected_value} · P̂ {activePacket.p_response_proxy}
                        </p>
                      </div>

                      {!!activePacket.checklist?.length && (
                        <div className="flex flex-wrap gap-1.5">
                          {activePacket.checklist.map((c) => (
                            <span
                              key={c.id}
                              className={cn(
                                'rounded-md px-2 py-0.5 text-[10px]',
                                c.done
                                  ? 'bg-[#20B8CD]/15 text-[#5DD5E3]'
                                  : 'bg-white/[0.04] text-white/30',
                              )}
                            >
                              {c.done ? '✓' : '○'} {c.label}
                            </span>
                          ))}
                        </div>
                      )}

                      {!!activePacket.keyword_inject?.length && (
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-wide text-white/30">
                            ATS keywords to add
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {activePacket.keyword_inject.map((k) => (
                              <span
                                key={k}
                                className="rounded-md bg-[#E8C547]/12 px-2 py-0.5 text-[10px] text-[#E8C547]"
                              >
                                {k}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-white/30">
                            Cover note
                          </span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[10px] text-[#5DD5E3]"
                            onClick={() =>
                              void copyText(activePacket.cover_note || '', 'cover note')
                            }
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </button>
                        </div>
                        <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/40 p-3 text-[11px] leading-relaxed text-white/55">
                          {activePacket.cover_note}
                        </pre>
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-white/30">
                            STAR bullets
                          </span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[10px] text-[#5DD5E3]"
                            onClick={() =>
                              void copyText(
                                (activePacket.star_bullets || []).join('\n\n'),
                                'bullets',
                              )
                            }
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </button>
                        </div>
                        <ul className="space-y-2">
                          {(activePacket.star_bullets || []).map((b, i) => (
                            <li
                              key={i}
                              className="rounded-lg border border-white/[0.05] bg-black/30 px-3 py-2 text-[11px] text-white/50"
                            >
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          disabled={
                            activePacket.action === 'blocked_practice' ||
                            !activePacket.apply_url ||
                            applyBusy
                          }
                          onClick={() => void applyWithPacket(activePacket, { fill: true, submit: false })}
                        >
                          {applyBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Zap className="h-3.5 w-3.5" />
                          )}
                          Browser fill
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            activePacket.action === 'blocked_practice' || !activePacket.apply_url
                          }
                          onClick={() => void applyWithPacket(activePacket)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open &amp; copy
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={applyBusy || !activePacket.apply_url}
                          onClick={() => void applyWithPacket(activePacket, { fill: true, submit: true })}
                        >
                          Fill + submit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void copyText(activePacket.subject_line || '', 'subject')
                          }
                        >
                          Copy subject
                        </Button>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/25">
                        {activePacket.honesty ||
                          'You submit. We prepare. p_response is a transparent proxy, not hire odds.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {liveJobs.length === 0 && !showPractice && (
            <div className="glass rounded-[24px] px-6 py-12 text-center">
              <Filter className="mx-auto h-7 w-7 text-white/25" />
              <p className="mt-3 text-[15px] font-medium text-white/80">No live openings matched</p>
              <p className="mx-auto mt-1.5 max-w-sm text-[12px] text-white/40">
                Try Anywhere, turn on LinkedIn, or relax work mode — public boards are thin for some niches.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setLocationMode('all')
                    setFiltersOpen(true)
                  }}
                >
                  Open filters
                </Button>
                {practiceJobs.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setShowPractice(true)}>
                    Show practice
                  </Button>
                )}
              </div>
            </div>
          )}

          {displayed.length === 0 && liveJobs.length > 0 && (
            <div className="glass rounded-[20px] px-6 py-10 text-center text-[13px] text-white/40">
              No roles match this list filter.
              <button
                type="button"
                className="ml-2 text-[#5DD5E3] underline"
                onClick={() => {
                  setQueryFilter('')
                  setSourceFilter('all')
                }}
              >
                Clear
              </button>
            </div>
          )}

          <ApplicationsPanel
            tracker={tracker}
            appliedCount={appliedCount}
            shortlistCount={shortlistCount}
            onToast={setToast}
          />

          {/* Selection hint + legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(232,234,237,0.08)] bg-[#1e1f20] px-3 py-2">
            <p className="text-[12px] text-[#9aa0a6]">
              <strong className="font-medium text-[#e8eaed]">
                {selectedCount}/{MAX_APPLY_SELECT} selected
              </strong>
              {' — '}
              check <span className="text-[#8ab4f8]">Pick</span> on a card to include it in
              apply
            </p>
            <ApplyLegend />
          </div>

          {/* Job cards — shared enterprise module */}
          <div className="flex flex-col gap-3">
            {displayed.map((j, idx) => (
              <div key={j.id} className="jobs-card">
                <JobCard
                  job={j}
                  index={idx}
                  expanded={expandedId === j.id}
                  tracked={trackerById.get(j.id)}
                  excludeLinkedIn={excludeLinkedIn}
                  applyBusy={applyBusy}
                  apiOk={apiOk}
                  statusOpts={STATUS_OPTS}
                  selected={selectedIds.has(j.id)}
                  selectDisabled={
                    selectedCount >= MAX_APPLY_SELECT && !selectedIds.has(j.id)
                  }
                  onToggleSelect={
                    isSyntheticJob(j) ? undefined : () => toggleJobSelect(j.id)
                  }
                  onToggleExpand={() =>
                    setExpandedId(expandedId === j.id ? null : j.id)
                  }
                  onOpenApply={() => openApply(j)}
                  onShortlist={() => markStatus(j, 'shortlisted')}
                  onMaterials={() => void openPacketForJob(j)}
                  onFillForm={() => void fillOneJob(j, false)}
                  onMarkStatus={(st) => markStatus(j, st)}
                  onSaveJd={() => sendJdToKnowledge(j)}
                  onMock={() => sendToMock(j)}
                  ScoreRing={ScoreRing}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
      )}
    </JobHubShell>
  )
}
