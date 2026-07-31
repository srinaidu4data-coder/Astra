import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  extractSkillsFromResume,
  isJobSearchLabHost,
  isSyntheticJob,
  jobsearchHealth,
  loadTracker,
  resolveApplyUrl,
  runJobSearch,
  upsertTracked,
  type AppStatus,
  type JobSearchRunResult,
  type NextStep,
  type RankedJob,
  type TrackedApplication,
} from '@/services/jobsearch'
import { isAllowedKnowledgeFile, parseUploadedFile } from '@/services/parser'
import { useAppStore } from '@/stores/app-store'
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Loader2,
  Radar,
  Search,
  UploadCloud,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type RemoteFilter = 'all' | 'remote' | 'hybrid' | 'onsite'
type WizardStep = 1 | 2 | 3 | 4

const STATUS_OPTS: AppStatus[] = [
  'shortlisted',
  'applied',
  'interview',
  'offer',
  'rejected',
  'skipped',
]

const PREFS_KEY = 'ip_jobsearch_prefs_v2'

const PIPELINE_STAGES = [
  { id: 'expand', label: 'Expand queries' },
  { id: 'harvest', label: 'Harvest live boards' },
  { id: 'rank', label: 'Rank by fit (IR ensemble)' },
  { id: 'review', label: 'Quality review' },
  { id: 'done', label: 'Done' },
] as const

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

type PipelineTick = { stage: string; ms?: number; jobs?: number; ranked?: number; live?: number; seed?: number }

/**
 * Product flow: Resume → Filters → Search → Live results & apply
 * Live boards first. Practice market is opt-in and clearly labeled.
 */
export function JobSearchPage() {
  const user = useAppStore((s) => s.user)
  const documents = useAppStore((s) => s.documents)
  const addDocument = useAppStore((s) => s.addDocument)
  const setActiveJobTitle = useAppStore((s) => s.setActiveJobTitle)
  const setRoute = useAppStore((s) => s.setRoute)
  const settings = useAppStore((s) => s.settings)

  const lab = isJobSearchLabHost()
  const fileRef = useRef<HTMLInputElement>(null)
  const prefs = useMemo(() => loadPrefs(), [])

  const resumes = useMemo(
    () => documents.filter((d) => d.type === 'resume'),
    [documents],
  )

  const [step, setStep] = useState<WizardStep>(1)
  const [resumeId, setResumeId] = useState(resumes[0]?.id || '')
  const [resumeName, setResumeName] = useState(resumes[0]?.name || '')
  const [resumeText, setResumeText] = useState(resumes[0]?.text || '')

  const [title, setTitle] = useState(prefs.title || 'SAP FICO Consultant')
  const [skills, setSkills] = useState(
    prefs.skills || 'sap, fico, s4hana, tax, controlling, vertex',
  )
  const [summary, setSummary] = useState(
    prefs.summary ||
      settings.jobContext ||
      'SAP FICO / S/4HANA finance — GL, AR/AP, tax, controlling',
  )
  const [useLive, setUseLive] = useState(prefs.useLive ?? true)
  const [includeSeed, setIncludeSeed] = useState(prefs.includeSeed ?? false)
  const [remote, setRemote] = useState<RemoteFilter>(prefs.remote || 'all')
  const [locationMode, setLocationMode] = useState<'all' | 'us' | 'custom'>(
    prefs.locationMode || 'us',
  )
  const [locationCustom, setLocationCustom] = useState(
    prefs.locationCustom || '',
  )
  const [excludeLinkedIn, setExcludeLinkedIn] = useState(
    prefs.excludeLinkedIn ?? true,
  )
  const [minScore, setMinScore] = useState(prefs.minScore ?? 0)
  const [limit, setLimit] = useState(prefs.limit ?? 200)

  const [busy, setBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [result, setResult] = useState<JobSearchRunResult | null>(null)
  const [apiOk, setApiOk] = useState(false)
  const [connectivity, setConnectivity] = useState('Checking…')
  const [productHonesty, setProductHonesty] = useState('')
  const [tracker, setTracker] = useState<TrackedApplication[]>(() => loadTracker())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runFingerprint, setRunFingerprint] = useState('')
  const [showPractice, setShowPractice] = useState(false)

  const hasResume = Boolean(resumeText.trim())

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

  const filtersDirty = Boolean(result && runFingerprint && filterFingerprint !== runFingerprint)

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
  ])

  useEffect(() => {
    if (!lab) return
    const ping = () => {
      void jobsearchHealth().then((h) => {
        setApiOk(Boolean(h.ok && (h.enabled ?? h.lab_enabled) !== false))
        if (h.honesty) setProductHonesty(h.honesty)
        if (!h.ok) {
          setConnectivity(
            h.error ||
              'API offline. Run START_JOBSEARCH_LAB.bat or: cd src && python copilot_api.py',
          )
          return
        }
        const fh = h.connectivity?.freehire
        setConnectivity(
          fh?.ok
            ? `Online · freehire OK · v${h.version || '1'}`
            : `Online · boards limited · v${h.version || '1'}`,
        )
      })
    }
    ping()
    const id = window.setInterval(ping, 10_000)
    return () => window.clearInterval(id)
  }, [lab])

  useEffect(() => {
    if (resumeText || !resumes[0]) return
    setResumeId(resumes[0].id)
    setResumeName(resumes[0].name)
    setResumeText(resumes[0].text)
  }, [resumes, resumeText])

  useEffect(() => {
    if (hasResume && step === 1) setStep(2)
  }, [hasResume, step])

  const applyResumeText = useCallback((name: string, text: string, id?: string) => {
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
    setMsg(`Resume ready: ${name}`)
    setStep(2)
  }, [])

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

  const run = async () => {
    if (!apiOk) {
      setErr('API is offline. Start copilot_api.py (or START_JOBSEARCH_LAB.bat), then retry.')
      return
    }
    setBusy(true)
    setStep(3)
    setErr(null)
    setMsg(null)
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
        exclude_linkedin: excludeLinkedIn,
        include_seed: includeSeed,
        limit,
        min_score: minScore,
      })
      setResult(data)
      setRunFingerprint(filterFingerprint)
      setShowPractice(false)
      setStep(4)
      const live = Number(data.meta?.live_count ?? 0)
      const seed = Number(data.meta?.seed_count ?? 0)
      const ms = Number(data.meta?.elapsed_ms ?? 0)
      setMsg(
        live > 0
          ? `${live} live role${live === 1 ? '' : 's'}` +
              (seed ? ` · ${seed} practice` : '') +
              (ms ? ` · ${(ms / 1000).toFixed(1)}s` : '') +
              (resolvedLocation === 'us' ? ' · US' : '') +
              (excludeLinkedIn ? ' · non-LinkedIn' : '') +
              '.'
          : seed
            ? `No live matches · ${seed} practice roles (opt-in). Broaden filters for real openings.`
            : 'No matches. Broaden location or work mode, or allow LinkedIn.',
      )
    } catch (e) {
      setErr((e as Error).message || 'Search failed')
      setStep(2)
    } finally {
      setBusy(false)
    }
  }

  const markStatus = (job: RankedJob, status: AppStatus) => {
    setTracker((prev) => upsertTracked(job, status, prev))
    setMsg(`${status}: ${job.title} @ ${job.company}`)
  }

  const openApply = (job: RankedJob) => {
    if (isSyntheticJob(job)) {
      setMsg('Practice listing — opening Indeed search, not a real apply URL.')
    }
    const url = resolveApplyUrl(job, excludeLinkedIn)
    window.open(url, '_blank', 'noopener,noreferrer')
    if (!isSyntheticJob(job)) {
      markStatus(job, 'applied')
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
    setMsg('JD saved to Knowledge.')
  }

  const trackerById = useMemo(() => {
    const m = new Map<string, TrackedApplication>()
    tracker.forEach((t) => m.set(t.job_id, t))
    return m
  }, [tracker])

  const allRanked: RankedJob[] = result?.ranked_jobs || []
  const liveJobs = useMemo(() => allRanked.filter((j) => !isSyntheticJob(j)), [allRanked])
  const practiceJobs = useMemo(() => allRanked.filter((j) => isSyntheticJob(j)), [allRanked])
  const ranked = showPractice ? allRanked : liveJobs.length ? liveJobs : allRanked

  const nextSteps: NextStep[] =
    (result?.next_steps?.steps as NextStep[] | undefined) ||
    ((result?.agents?.next_steps as { steps?: NextStep[] } | undefined)?.steps) ||
    []
  const pipelineLog = (result?.pipeline || []) as PipelineTick[]
  const runFilters = (result?.filters || {}) as Record<string, unknown>
  const serverWarnings = result?.warnings || result?.next_steps?.warnings || []

  const goStep = (s: WizardStep) => {
    if (busy && s !== 3) return
    if (s === 4 && !result) return
    setStep(s)
  }

  const stepsMeta: { id: WizardStep; label: string; done: boolean }[] = [
    { id: 1, label: 'Resume', done: hasResume },
    { id: 2, label: 'Filters', done: step > 2 || Boolean(result) },
    { id: 3, label: 'Search', done: Boolean(result) && !busy && !filtersDirty },
    { id: 4, label: 'Apply', done: tracker.some((t) => t.status === 'applied') },
  ]

  if (!lab) {
    return (
      <div className="mx-auto max-w-lg glass rounded-[28px] p-10 text-center">
        <Radar className="mx-auto mb-4 h-8 w-8 text-white/30" />
        <h2 className="text-[17px] font-medium text-white/90">Job Search</h2>
        <p className="mt-2 text-[13px] text-white/40">
          Available on localhost. Open{' '}
          <a className="text-[#5DD5E3] underline" href="http://127.0.0.1:5173/#/jobsearch">
            http://127.0.0.1:5173/#/jobsearch
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <nav className="glass flex flex-wrap items-center gap-2 rounded-[20px] px-4 py-3">
        {stepsMeta.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => goStep(s.id)}
            disabled={busy && s.id !== 3}
            className={
              step === s.id
                ? 'flex items-center gap-1.5 rounded-full bg-[#20B8CD] px-3 py-1.5 text-[12px] font-medium text-[#0C0C0C]'
                : s.done
                  ? 'flex items-center gap-1.5 rounded-full bg-[#20B8CD]/15 px-3 py-1.5 text-[12px] text-[#5DD5E3]'
                  : 'flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/40'
            }
          >
            {s.done && step !== s.id ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">
                {i + 1}
              </span>
            )}
            {s.label}
          </button>
        ))}
        <span
          className={`ml-auto text-[11px] ${apiOk ? 'text-[#20B8CD]' : 'text-[#E85D5D]'}`}
        >
          {connectivity}
        </span>
      </nav>

      {productHonesty && step <= 2 && (
        <p className="px-1 text-[11px] leading-relaxed text-white/35">{productHonesty}</p>
      )}

      {err && (
        <div className="rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D] whitespace-pre-wrap">
          {err}
        </div>
      )}
      {msg && !busy && (
        <div className="rounded-[14px] border border-[#20B8CD]/30 bg-[#20B8CD]/10 px-4 py-3 text-[13px] text-[#5DD5E3]">
          {msg}
        </div>
      )}
      {filtersDirty && step === 4 && (
        <div className="rounded-[14px] border border-[#E8C547]/35 bg-[#E8C547]/10 px-4 py-3 text-[13px] text-[#E8C547]">
          Filters changed since last search.{' '}
          <button type="button" className="underline font-medium" onClick={() => void run()}>
            Re-run
          </button>{' '}
          so results match the form.
        </div>
      )}

      {/* STEP 1 */}
      {step === 1 && (
        <section className="glass rounded-[28px] p-6 md:p-8">
          <h2 className="flex items-center gap-2 text-[17px] font-medium text-white/95">
            <FileText className="h-4 w-4 text-[#5DD5E3]" />
            Resume
            {hasResume ? <Badge tone="emerald">ready</Badge> : <Badge tone="amber">optional</Badge>}
          </h2>
          <p className="mt-1 text-[13px] text-white/40">
            Improves ranking. You can skip and still search live boards.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,application/pdf"
              className="hidden"
              onChange={(e) => void onUploadResume(e.target.files)}
            />
            <Button disabled={uploadBusy} onClick={() => fileRef.current?.click()}>
              {uploadBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              Upload resume
            </Button>
            <Button variant="secondary" onClick={() => setStep(2)}>
              {hasResume ? 'Continue →' : 'Skip for now →'}
            </Button>
          </div>
          {resumes.length > 0 && (
            <label className="mt-4 flex max-w-md flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Or pick from Knowledge</span>
              <select
                value={resumeId}
                onChange={(e) => onPickResumeDoc(e.target.value)}
                className="h-10 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/90"
              >
                <option value="">— select —</option>
                {resumes.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hasResume && (
            <p className="mt-3 text-[12px] text-[#5DD5E3]">
              Active: <strong>{resumeName}</strong> · {resumeText.length.toLocaleString()} chars
            </p>
          )}
        </section>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <section className="glass rounded-[28px] p-6 md:p-8">
          <h2 className="flex items-center gap-2 text-[17px] font-medium text-white/95">
            <Search className="h-4 w-4 text-[#5DD5E3]" />
            Profile & filters
          </h2>
          <p className="mt-1 text-[13px] text-white/40">
            Live boards only by default. Filters are applied once on the server.
          </p>

          {hasResume && (
            <p className="mt-3 text-[12px] text-white/45">
              Resume: <span className="text-[#5DD5E3]">{resumeName || 'attached'}</span>
              {' · '}
              <button type="button" className="underline text-white/50" onClick={() => setStep(1)}>
                change
              </button>
            </p>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Target title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Skills</span>
              <input
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
              />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Summary</span>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={2}
                className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Work mode</span>
              <select
                value={remote}
                onChange={(e) => setRemote(e.target.value as RemoteFilter)}
                className="h-10 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/90"
              >
                <option value="all">All</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">Onsite</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Location</span>
              <select
                value={locationMode}
                onChange={(e) =>
                  setLocationMode(e.target.value as 'all' | 'us' | 'custom')
                }
                className="h-10 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/90"
              >
                <option value="us">Only US</option>
                <option value="all">Anywhere</option>
                <option value="custom">Custom city…</option>
              </select>
            </label>
            {locationMode === 'custom' && (
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-[11px] uppercase text-white/35">City / region</span>
                <input
                  value={locationCustom}
                  onChange={(e) => setLocationCustom(e.target.value)}
                  placeholder="Chicago, Texas…"
                  className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-white/90"
                />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Min score</span>
              <select
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="h-10 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/90"
              >
                <option value={0}>Any</option>
                <option value={20}>20+</option>
                <option value={40}>40+</option>
                <option value={55}>55+</option>
                <option value={70}>70+</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase text-white/35">Max results</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="h-10 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/90"
              >
                {[50, 100, 200, 300, 400].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px] text-white/60">
              <input
                type="checkbox"
                checked={useLive}
                onChange={(e) => setUseLive(e.target.checked)}
                className="accent-[#20B8CD]"
              />
              Live boards (freehire · Remotive · Arbeitnow)
            </label>
            <label className="flex items-center gap-2 text-[13px] text-white/60">
              <input
                type="checkbox"
                checked={excludeLinkedIn}
                onChange={(e) => setExcludeLinkedIn(e.target.checked)}
                className="accent-[#20B8CD]"
              />
              Non-LinkedIn only
            </label>
            <label className="flex items-start gap-2 text-[13px] text-white/50">
              <input
                type="checkbox"
                checked={includeSeed}
                onChange={(e) => setIncludeSeed(e.target.checked)}
                className="mt-0.5 accent-[#E8C547]"
              />
              <span>
                <span className="text-[#E8C547]">Practice market</span>
                {' — '}
                synthetic roles for ranking drills only. Off by default. Never mixed in as real
                jobs without this.
              </span>
            </label>
          </div>

          {locationMode === 'us' && excludeLinkedIn && (
            <p className="mt-3 text-[12px] text-[#5DD5E3]/90">
              Preset: <strong>US + non-LinkedIn</strong>
              {includeSeed ? ' + practice market' : ' · live only'}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="lg" disabled={busy || !apiOk || (!useLive && !includeSeed)} onClick={() => void run()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
              Search jobs
            </Button>
            {!apiOk && (
              <span className="self-center text-[12px] text-[#E85D5D]">
                Wait for green status or start the API
              </span>
            )}
            {result && (
              <Button variant="secondary" onClick={() => setStep(4)}>
                Back to results
              </Button>
            )}
          </div>
        </section>
      )}

      {/* STEP 3 — honest progress (no fake timed stages) */}
      {step === 3 && (
        <section className="glass rounded-[28px] p-6 md:p-8">
          <h2 className="flex items-center gap-2 text-[17px] font-medium text-white/95">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#5DD5E3]" />
            ) : (
              <Radar className="h-4 w-4 text-[#5DD5E3]" />
            )}
            Searching
          </h2>
          <p className="mt-1 text-[13px] text-white/40">
            Expand → harvest public boards → rank → review. Usually 4–12 seconds.
          </p>

          <ol className="mt-5 space-y-2">
            {PIPELINE_STAGES.map((st) => {
              const tick = pipelineLog.find((p) => p.stage === st.id)
              const done = Boolean(tick) || (!busy && Boolean(result))
              return (
                <li
                  key={st.id}
                  className={
                    busy && !done
                      ? 'flex items-center gap-3 rounded-xl border border-[#20B8CD]/25 bg-[#20B8CD]/08 px-4 py-2.5 text-[13px] text-[#5DD5E3]'
                      : done
                        ? 'flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 text-[13px] text-white/70'
                        : 'flex items-center gap-3 rounded-xl border border-white/[0.04] px-4 py-2.5 text-[13px] text-white/30'
                  }
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#20B8CD]" />
                  ) : busy ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0" />
                  )}
                  <span className="flex-1">{st.label}</span>
                  {tick?.ms != null && (
                    <span className="text-[11px] text-white/35">{tick.ms}ms</span>
                  )}
                  {tick?.jobs != null && (
                    <span className="text-[11px] text-white/35">{tick.jobs}</span>
                  )}
                  {tick?.ranked != null && (
                    <span className="text-[11px] text-white/35">{tick.ranked} ranked</span>
                  )}
                </li>
              )
            })}
          </ol>

          {!busy && result && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => setStep(4)}>View results →</Button>
              <Button variant="secondary" onClick={() => void run()}>
                Re-run
              </Button>
            </div>
          )}
        </section>
      )}

      {/* STEP 4 */}
      {step === 4 && result && (
        <>
          <section className="glass rounded-[20px] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-medium text-white/90">
                  Results
                  <span className="ml-2 text-white/40">
                    {liveJobs.length} live
                    {practiceJobs.length ? ` · ${practiceJobs.length} practice` : ''}
                  </span>
                </h2>
                <p className="mt-1 text-[11px] text-white/40">
                  Filters used:{' '}
                  <strong className="text-white/55">
                    location={String(runFilters.location ?? '—')}
                  </strong>
                  {' · '}
                  remote=<strong className="text-white/55">{String(runFilters.remote ?? '—')}</strong>
                  {' · '}
                  linkedin=
                  <strong className="text-white/55">
                    {runFilters.exclude_linkedin ? 'excluded' : 'allowed'}
                  </strong>
                  {' · '}
                  practice=
                  <strong className="text-white/55">
                    {runFilters.include_seed ? 'on' : 'off'}
                  </strong>
                  {typeof result.meta?.elapsed_ms === 'number' && (
                    <> · {(Number(result.meta.elapsed_ms) / 1000).toFixed(1)}s</>
                  )}
                </p>
                <p className="text-[11px] text-white/35">
                  Sources:{' '}
                  {(
                    (result.agents?.harvester as { sources?: string[] } | undefined)?.sources ||
                    (result.stages?.harvest as { sources?: string[] } | undefined)?.sources ||
                    []
                  ).join(', ') || '—'}
                  {' · '}
                  Fit scores are relative similarity, not hire odds.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setStep(2)}>
                  Edit filters
                </Button>
                <Button size="sm" disabled={busy || !apiOk} onClick={() => void run()}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Re-run
                </Button>
              </div>
            </div>

            {pipelineLog.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {pipelineLog.map((p) => (
                  <span
                    key={`${p.stage}-${p.ms}`}
                    className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] text-white/45"
                  >
                    {p.stage}
                    {p.ms != null ? ` ${p.ms}ms` : ''}
                    {p.live != null ? ` · live ${p.live}` : ''}
                  </span>
                ))}
              </div>
            )}
          </section>

          {serverWarnings.length > 0 && (
            <div className="rounded-[14px] border border-[#E8C547]/30 bg-[#E8C547]/08 px-4 py-3 text-[12px] text-[#E8C547]">
              <ul className="list-disc space-y-1 pl-4">
                {serverWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {liveJobs.length === 0 && (
            <div className="glass rounded-[20px] px-5 py-6 text-center">
              <p className="text-[14px] text-white/80">No live openings matched</p>
              <p className="mt-2 text-[12px] text-white/40">
                Public boards are thin for some niches (e.g. SAP on non-LinkedIn). Try Anywhere,
                allow LinkedIn links, or turn on Practice market for ranking drills only.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setLocationMode('all')
                    setStep(2)
                  }}
                >
                  Open filters
                </Button>
                {practiceJobs.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setShowPractice(true)}>
                    Show {practiceJobs.length} practice roles
                  </Button>
                )}
              </div>
            </div>
          )}

          {nextSteps.length > 0 && liveJobs.length > 0 && (
            <section className="glass rounded-[20px] px-5 py-4">
              <h3 className="text-[13px] font-medium text-white/85">
                Next steps
                {result.next_steps?.headline ? (
                  <span className="ml-2 font-normal text-white/40">
                    — {result.next_steps.headline}
                  </span>
                ) : null}
              </h3>
              <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {nextSteps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-[12px] text-white/50">
                    {s.status === 'done' ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#20B8CD]" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/25" />
                    )}
                    <span>
                      <span className="text-white/70">{s.title}</span>
                      {s.detail ? ` — ${s.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
              {tracker.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {STATUS_OPTS.map((st) => {
                    const n = tracker.filter((t) => t.status === st).length
                    if (!n) return null
                    return (
                      <Badge key={st} tone={st === 'applied' ? 'indigo' : 'default'}>
                        {st}: {n}
                      </Badge>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {liveJobs.length > 0 && practiceJobs.length > 0 && (
            <div className="flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={() => setShowPractice(false)}
                className={
                  !showPractice
                    ? 'rounded-full bg-[#20B8CD] px-3 py-1 text-[11px] font-medium text-[#0C0C0C]'
                    : 'rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-white/50'
                }
              >
                Live ({liveJobs.length})
              </button>
              <button
                type="button"
                onClick={() => setShowPractice(true)}
                className={
                  showPractice
                    ? 'rounded-full bg-[#E8C547] px-3 py-1 text-[11px] font-medium text-[#0C0C0C]'
                    : 'rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-white/50'
                }
              >
                + Practice ({practiceJobs.length})
              </button>
            </div>
          )}

          {ranked.length > 0 && (
            <section className="glass overflow-hidden rounded-[28px]">
              <div className="max-h-[70vh] divide-y divide-white/[0.05] overflow-y-auto">
                {ranked.map((j) => {
                  const tracked = trackerById.get(j.id)
                  const open = expandedId === j.id
                  const synth = isSyntheticJob(j)
                  return (
                    <div
                      key={j.id}
                      className={
                        synth
                          ? 'border-l-2 border-[#E8C547]/50 bg-[#E8C547]/[0.03] px-5 py-4 md:px-6'
                          : 'px-5 py-4 md:px-6'
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[14px] font-medium text-white/90">{j.title}</span>
                            {synth ? (
                              <Badge tone="amber">practice</Badge>
                            ) : (
                              <Badge tone="emerald">live</Badge>
                            )}
                          </div>
                          <div className="text-[12px] text-white/40">
                            {j.company}
                            {j.location ? ` · ${j.location}` : ''}
                            {j.country ? ` · ${String(j.country).toUpperCase()}` : ''}
                            {j.work_mode ? ` · ${j.work_mode}` : ''}
                            {j.source ? ` · ${j.source}` : ''}
                            {tracked ? ` · ${tracked.status}` : ''}
                          </div>
                        </div>
                        <Badge
                          tone={
                            synth
                              ? 'amber'
                              : j.verdict === 'strong'
                                ? 'emerald'
                                : j.verdict === 'good'
                                  ? 'indigo'
                                  : 'default'
                          }
                        >
                          {j.scores?.ensemble ?? '—'}
                        </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => openApply(j)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          {synth ? 'Search Indeed' : 'Apply'}
                        </Button>
                        {!excludeLinkedIn && j.linkedin_url && !synth && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              window.open(j.linkedin_url, '_blank', 'noopener,noreferrer')
                            }
                          >
                            LinkedIn
                          </Button>
                        )}
                        {j.indeed_url && !synth && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              window.open(j.indeed_url, '_blank', 'noopener,noreferrer')
                            }
                          >
                            Indeed
                          </Button>
                        )}
                        {!synth && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => markStatus(j, 'shortlisted')}
                          >
                            Shortlist
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => sendJdToKnowledge(j)}>
                          Save JD
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => sendToMock(j)}>
                          Prep mock
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedId(open ? null : j.id)}
                        >
                          {open ? 'Less' : 'More'}
                        </Button>
                      </div>

                      {open && (
                        <div className="mt-3 space-y-2 rounded-[14px] border border-white/[0.06] bg-white/[0.03] p-3">
                          {synth && (
                            <p className="text-[11px] text-[#E8C547]">
                              Synthetic practice listing — not a real job. Use for ranking /
                              mock prep only.
                            </p>
                          )}
                          {!!j.gap_skills?.length && (
                            <p className="text-[11px] text-white/40">
                              Gaps: {j.gap_skills.join(', ')}
                            </p>
                          )}
                          {j.text && (
                            <p className="max-h-24 overflow-y-auto text-[11px] text-white/35">
                              {j.text.slice(0, 400)}
                              {j.text.length > 400 ? '…' : ''}
                            </p>
                          )}
                          {!synth && (
                            <div className="flex flex-wrap gap-1">
                              {STATUS_OPTS.map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() => markStatus(j, st)}
                                  className={
                                    tracked?.status === st
                                      ? 'rounded bg-[#20B8CD]/20 px-2 py-0.5 text-[10px] text-[#5DD5E3]'
                                      : 'rounded bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/40'
                                  }
                                >
                                  {st}
                                </button>
                              ))}
                            </div>
                          )}
                          <a
                            href={resolveApplyUrl(j, excludeLinkedIn)}
                            target="_blank"
                            rel="noreferrer"
                            className="block break-all text-[11px] text-[#5DD5E3]/80 hover:underline"
                          >
                            {resolveApplyUrl(j, excludeLinkedIn)}
                          </a>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
