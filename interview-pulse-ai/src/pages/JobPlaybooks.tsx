/**
 * AI auto-apply playbooks under Jobs hub (localhost).
 * Each ends with real Playwright one-click apply (fill + optional submit).
 */

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ApplyTrustPanel } from '@/modules/jobs'
import {
  fetchAutofillProfile,
  formPackInjectRows,
  isSyntheticJob,
  kitMatchTone,
  loadStoredFormPack,
  loadStrictSoft,
  oneClickAutoApply,
  runJobSearch,
  runNexusPipeline,
  saveStrictSoft,
  upsertTracked,
  type AppStatus,
  type FormPackInjectRow,
  type JobSearchProfile,
  type NexusResult,
  type OneClickResult,
  type RankedJob,
  type TrackedApplication,
} from '@/services/jobsearch'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Filter,
  Loader2,
  Shield,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

export type PlaybookProps = {
  jobs: RankedJob[]
  profile: JobSearchProfile
  apiOk: boolean
  onNeedSearch: () => void
  onToast: (msg: string) => void
  onErr: (msg: string) => void
  onTracker: (fn: (prev: TrackedApplication[]) => TrackedApplication[]) => void
  /**
   * Kit soft-match ranking (default true = cold before soft).
   * When omitted, playbooks use loadStrictSoft() / localStorage.
   */
  strictSoft?: boolean
  onStrictSoftChange?: (strict: boolean) => void
}

function Shell({
  title,
  source,
  blurb,
  children,
}: {
  title: string
  source: string
  blurb: string
  children: ReactNode
}) {
  return (
    <div className="jobs-result-enter flex flex-col gap-4">
      <div className="jobs-command overflow-hidden">
        <div className="border-b border-[rgba(232,234,237,0.1)] px-5 py-5 md:px-6">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-medium text-[#e8eaed]">{title}</h2>
            <Badge tone="indigo">{source}</Badge>
          </div>
          <p className="max-w-xl text-[14px] leading-relaxed text-[#9aa0a6]">{blurb}</p>
          <p className="mt-2 text-[12px] text-[#80868b]">
            Forms fill when the ATS allows. Login and CAPTCHA stay with you.
          </p>
        </div>
        <div className="flex flex-col gap-5 p-5 md:p-6">{children}</div>
      </div>
    </div>
  )
}

function NeedJobs({ onNeedSearch, n }: { onNeedSearch: () => void; n: number }) {
  if (n > 0) return null
  return (
    <div className="glass rounded-2xl px-4 py-8 text-center text-[13px] text-white/45">
      No live jobs loaded. Run <strong className="text-white/70">Search</strong> first.
      <div className="mt-3">
        <Button size="sm" onClick={onNeedSearch}>
          Go to Search
        </Button>
      </div>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms))
}

function ContactWarn({ profile }: { profile: JobSearchProfile }) {
  const missing: string[] = []
  if (!profile.email?.trim()) missing.push('email')
  if (!profile.phone?.trim()) missing.push('phone')
  const nameIsEmail = Boolean(profile.name?.includes('@'))
  if (!missing.length && !nameIsEmail) return null
  return (
    <div className="rounded-xl border border-[#E8C547]/30 bg-[#E8C547]/10 px-3 py-2 text-[11px] text-[#E8C547]">
      {missing.length > 0 && (
        <>
          Add <strong>{missing.join(' and ')}</strong> under Search →{' '}
          <strong>Phone, resume &amp; more</strong> so forms fill correctly.
        </>
      )}
      {nameIsEmail && (
        <span className={missing.length ? ' mt-1 block' : ''}>
          Display name looks like an email — set a real name on your account for first/last name fields.
        </span>
      )}
    </div>
  )
}

/** Power-user kit ranking toggle: strict soft demotes same-board packs below cold ATS. */
export function StrictSoftToggle({
  strictSoft,
  onChange,
  className,
}: {
  strictSoft: boolean
  onChange: (strict: boolean) => void
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-white/50',
        className,
      )}
      title={
        strictSoft
          ? 'Soft same-board kit matches rank after cold ATS (safer). Uncheck to prefer soft packs before cold.'
          : 'Soft same-board kit matches rank before cold ATS. Re-check for safer default.'
      }
    >
      <input
        type="checkbox"
        checked={strictSoft}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[#E8C547]"
      />
      <span className="text-white/70">Strict soft kit</span>
      <span className="text-white/30">
        {strictSoft ? '(cold before soft)' : '(soft before cold)'}
      </span>
    </label>
  )
}

function usePlaybookStrictSoft(p: PlaybookProps): [boolean, (v: boolean) => void] {
  const [local, setLocal] = useState(() =>
    p.strictSoft !== undefined ? p.strictSoft : loadStrictSoft(),
  )
  useEffect(() => {
    if (p.strictSoft !== undefined) setLocal(p.strictSoft)
  }, [p.strictSoft])
  const set = (v: boolean) => {
    setLocal(v)
    saveStrictSoft(v)
    p.onStrictSoftChange?.(v)
  }
  return [local, set]
}

/** Shared kit-ranking control for apply playbooks (persists via load/saveStrictSoft). */
function KitRankOpts({ p }: { p: PlaybookProps }) {
  const [strictSoft, setStrictSoft] = usePlaybookStrictSoft(p)
  return <StrictSoftToggle strictSoft={strictSoft} onChange={setStrictSoft} />
}

﻿function OneClickResults({ res }: { res: OneClickResult }) {
  const materials = res.materials || []
  const injectPreview = materials
    .flatMap((m) => m.keyword_inject || [])
    .filter(Boolean)
    .slice(0, 8)
  return (
    <div className="flex flex-col gap-3">
      <ApplyTrustPanel res={res} title="Apply trust log" />
      {injectPreview.length > 0 && (
        <div className="jobs-command flex flex-wrap gap-1 px-3 py-2">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-[#80868b]">Keywords</span>
          {injectPreview.map((k) => (
            <span
              key={k}
              className="rounded-md bg-[#8ab4f8]/15 px-1.5 py-0.5 text-[10px] text-[#8ab4f8]"
            >
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function markFromOneClick(
  res: OneClickResult,
  jobs: RankedJob[],
  onTracker: PlaybookProps['onTracker'],
) {
  for (const row of res.browser?.results || []) {
    if (
      row.submitted ||
      row.status === 'filled' ||
      row.status === 'submitted' ||
      row.status === 'opened_manual'
    ) {
      const job =
        jobs.find((j) => j.id === row.job_id) ||
        ({
          id: String(row.job_id || ''),
          title: row.title || '',
          company: row.company || '',
          apply_url: row.url,
        } as RankedJob)
      onTracker((prev) => upsertTracked(job, 'applied' as AppStatus, prev))
    }
  }
}

async function runRealApply(
  p: PlaybookProps,
  opts: {
    min_score?: number
    budget?: number
    submit?: boolean
    /** Kit ranking; defaults to playbook prop or loadStrictSoft() */
    strict_soft?: boolean
  },
): Promise<OneClickResult | null> {
  if (!p.jobs.length) {
    p.onNeedSearch()
    return null
  }
  const submit = opts.submit !== false
  if (submit) {
    const ok = window.confirm(
      `AI will fill and SUBMIT up to ${opts.budget ?? 5} applications via headless browser.\n\nContinue?`,
    )
    if (!ok) return null
  }
  const strictSoft =
    opts.strict_soft !== undefined
      ? opts.strict_soft
      : p.strictSoft !== undefined
        ? p.strictSoft
        : loadStrictSoft()
  const r = await oneClickAutoApply({
    profile: p.profile,
    jobs: p.jobs.filter((j) => !isSyntheticJob(j)),
    min_score: opts.min_score ?? 0,
    budget: opts.budget ?? 5,
    submit,
    headless: true,
    forge: true,
    strict_gate: opts.min_score != null && opts.min_score >= 70,
    strict_soft: strictSoft,
  })
  if (!r.ok) {
    p.onErr(r.message || r.error || 'Auto apply failed')
    return r
  }
  markFromOneClick(r, p.jobs, p.onTracker)
  p.onToast(
    `Applied · filled ${r.summary?.filled ?? 0} · submitted ${r.summary?.submitted ?? 0}`,
  )
  return r
}

function NexusResultView({ res }: { res: NexusResult }) {
  return (
    <div className="glass max-h-56 overflow-y-auto rounded-2xl">
      {(res.materials || []).map((m) => (
        <div
          key={String(m.job_id)}
          className="flex flex-col gap-1 border-b border-white/[0.04] px-3 py-2 text-[12px]"
        >
          <div className="flex items-center gap-2">
            <span className="rounded bg-[#7C5CFF]/25 px-1.5 text-[10px] font-bold text-[#B8A6FF]">
              {m.nexus_grade}
              {m.tailor_rt_grade ? ` · RT ${m.tailor_rt_grade}` : ''}
            </span>
            <span className="min-w-0 flex-1 truncate text-white/85">
              {m.title} · {m.company}
            </span>
            <span className="tabular-nums text-[#5DD5E3]">{m.nexus_score_5}</span>
          </div>
          {!!m.keyword_inject?.length && (
            <div className="flex flex-wrap gap-1 pl-0.5">
              {m.keyword_inject.slice(0, 6).map((k) => (
                <span
                  key={k}
                  className="rounded bg-[#20B8CD]/12 px-1.5 py-0.5 text-[10px] text-[#5DD5E3]/90"
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** ── Nexus ── */
export function NexusPlaybook(p: PlaybookProps) {
  const [busy, setBusy] = useState(false)
  // Live board IR scores are often 30–55 — default 0 so Evaluate always produces a shortlist
  const [minScore, setMinScore] = useState(0)
  const [res, setRes] = useState<NexusResult | null>(null)
  const [applyRes, setApplyRes] = useState<OneClickResult | null>(null)

  const evaluate = async () => {
    if (!p.jobs.length) return p.onNeedSearch()
    setBusy(true)
    try {
      const r = await runNexusPipeline({
        profile: p.profile,
        jobs: p.jobs,
        min_score: minScore,
        min_grade: minScore >= 70 ? 'B' : 'F',
        budget: 12,
        mode: 'dry_run',
        forge: true,
      })
      if (!r.ok) return p.onErr(r.error || 'Nexus failed')
      setRes(r)
      const n = r.stats?.materials ?? r.stats?.passed_gate ?? 0
      const soft = Boolean(r.stats?.soft_fallback || (r.warnings && r.warnings.length))
      p.onToast(
        soft
          ? `Nexus · ${n} best-available roles (gate soft-fallback)`
          : `Nexus · ${n} ready for apply`,
      )
    } finally {
      setBusy(false)
    }
  }

  const apply = async (submit: boolean) => {
    setBusy(true)
    try {
      // Soft gate on apply — don't re-kill the shortlist
      const r = await runRealApply(p, { min_score: 0, budget: 8, submit })
      if (r) setApplyRes(r)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="Astra Apply Nexus"
      source="best-of-breed"
      blurb="Grade & tailor your shortlist, then one-click browser auto-apply. Scores are relative fit — use min 0 on thin markets."
    >
      <NeedJobs onNeedSearch={p.onNeedSearch} n={p.jobs.length} />
      <ContactWarn profile={p.profile} />
      <KitRankOpts p={p} />
      <div className="flex flex-wrap gap-2">
        <select
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="h-9 rounded-lg border border-white/10 bg-black/40 px-2 text-[12px] text-white/80"
        >
          {[0, 30, 45, 55, 65, 75].map((n) => (
            <option key={n} value={n}>
              Min score {n === 0 ? 'any (recommended)' : n}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={busy || !p.apiOk || !p.jobs.length} onClick={() => void evaluate()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Evaluate
        </Button>
        <Button
          size="sm"
          className="font-bold bg-gradient-to-r from-[#E85D5D] to-[#E8C547] text-[#0C0C0C]"
          disabled={busy || !p.apiOk || !p.jobs.length}
          onClick={() => void apply(true)}
        >
          <Zap className="h-3.5 w-3.5" />
          Auto Apply (submit)
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || !p.jobs.length} onClick={() => void apply(false)}>
          Fill only
        </Button>
      </div>
      {res && <NexusResultView res={res} />}
      {applyRes && <OneClickResults res={applyRes} />}
    </Shell>
  )
}

/** ── career-ops ── */
export function CareerOpsPlaybook(p: PlaybookProps) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<NexusResult | null>(null)
  const [applyRes, setApplyRes] = useState<OneClickResult | null>(null)

  const run = async () => {
    if (!p.jobs.length) return p.onNeedSearch()
    setBusy(true)
    try {
      // Prefer B+/75; soft_fallback returns best available when market is thin
      const r = await runNexusPipeline({
        profile: p.profile,
        jobs: p.jobs,
        min_score: 75,
        min_grade: 'B',
        budget: 15,
        mode: 'dry_run',
        forge: true,
      })
      if (!r.ok) return p.onErr(r.error || 'Eval failed')
      setRes(r)
      const n = r.stats?.materials ?? 0
      if (r.stats?.soft_fallback || (r.warnings && r.warnings.length)) {
        p.onToast(
          `career-ops · no B+/75 in this shortlist — using top ${n} relative fits (soft fallback)`,
        )
      } else {
        p.onToast(`career-ops · ${n} worth applying (B+/75+)`)
      }
    } finally {
      setBusy(false)
    }
  }

  const applyPassed = async () => {
    if (!res?.materials?.length) {
      p.onErr('Evaluate first — run Evaluate to build a shortlist')
      return
    }
    setBusy(true)
    try {
      // Prefer materials job ids; fall back to all live jobs if needed
      const ids = new Set((res.materials || []).map((m) => String(m.job_id)))
      let subset = p.jobs.filter((j) => ids.has(String(j.id)))
      if (!subset.length) subset = p.jobs.filter((j) => !isSyntheticJob(j)).slice(0, 8)
      const r = await oneClickAutoApply({
        profile: p.profile,
        jobs: subset,
        min_score: 0,
        budget: Math.min(10, subset.length),
        submit: true,
        headless: true,
        forge: true,
        strict_soft: p.strictSoft !== undefined ? p.strictSoft : loadStrictSoft(),
        strict_gate: false,
      })
      setApplyRes(r)
      if (!r.ok) return p.onErr(r.message || r.error || 'Apply failed')
      markFromOneClick(r, subset, p.onTracker)
      const manual = r.summary?.opened_manual ?? 0
      p.onToast(
        `Submitted ${r.summary?.submitted ?? 0} · filled ${r.summary?.filled ?? 0}` +
          (manual ? ` · ${manual} opened for you to finish` : ''),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="career-ops evaluate + apply"
      source="santifer/career-ops spirit"
      blurb="Prefer B+/75+ roles. On thin public boards we fall back to the best relative fits so Apply still works."
    >
      <NeedJobs onNeedSearch={p.onNeedSearch} n={p.jobs.length} />
      <ContactWarn profile={p.profile} />
      <KitRankOpts p={p} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !p.apiOk || !p.jobs.length} onClick={() => void run()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Filter className="h-3.5 w-3.5" />}
          Evaluate (strict)
        </Button>
        <Button
          size="sm"
          className="font-bold"
          disabled={busy || !res?.materials?.length}
          onClick={() => void applyPassed()}
        >
          <Zap className="h-3.5 w-3.5" />
          Auto Apply B+ only
        </Button>
      </div>
      {res && (
        <>
          <div className="text-[12px] text-white/50">
            Apply candidates: <strong className="text-[#5DD5E3]">{res.stats?.passed_gate ?? 0}</strong> ·
            skipped {res.stats?.skipped ?? 0}
          </div>
          <NexusResultView res={res} />
        </>
      )}
      {applyRes && <OneClickResults res={applyRes} />}
    </Shell>
  )
}

/** ── ApplyPilot 6-stage with real apply ── */
export function ApplyPilotPlaybook(p: PlaybookProps) {
  const [busy, setBusy] = useState(false)
  const [stageIx, setStageIx] = useState(-1)
  const [res, setRes] = useState<NexusResult | null>(null)
  const [applyRes, setApplyRes] = useState<OneClickResult | null>(null)
  const stageNames = ['discover', 'enrich', 'score', 'tailor', 'cover', 'apply']

  const run = async (submit: boolean) => {
    if (!p.jobs.length) return p.onNeedSearch()
    setBusy(true)
    setStageIx(0)
    setApplyRes(null)
    try {
      for (let i = 0; i < 5; i++) {
        setStageIx(i)
        await sleep(200)
      }
      const r = await runNexusPipeline({
        profile: p.profile,
        jobs: p.jobs,
        min_score: 55,
        budget: 10,
        mode: 'dry_run',
        forge: true,
      })
      if (!r.ok) return p.onErr(r.error || 'Pipeline failed')
      setRes(r)
      setStageIx(5)
      // Stage 6: real browser apply
      const ar = await oneClickAutoApply({
        profile: p.profile,
        jobs: p.jobs,
        min_score: 0,
        budget: 8,
        submit,
        headless: true,
        forge: true,
        strict_gate: false,
        strict_soft: p.strictSoft !== undefined ? p.strictSoft : loadStrictSoft(),
      })
      setApplyRes(ar)
      if (ar.ok) {
        markFromOneClick(ar, p.jobs, p.onTracker)
        p.onToast(
          `ApplyPilot complete · submitted ${ar.summary?.submitted ?? 0} · filled ${ar.summary?.filled ?? 0}`,
        )
      } else {
        p.onErr(ar.message || ar.error || 'Apply stage failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="ApplyPilot pipeline"
      source="Pickle-Pixel/ApplyPilot spirit"
      blurb="Stages 1–5 prepare materials; stage 6 runs Playwright auto-apply (fill + submit)."
    >
      <NeedJobs onNeedSearch={p.onNeedSearch} n={p.jobs.length} />
      <ContactWarn profile={p.profile} />
      <KitRankOpts p={p} />
      <div className="flex flex-wrap gap-1.5">
        {stageNames.map((s, i) => (
          <span
            key={s}
            className={cn(
              'rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide',
              i <= stageIx && (busy || res)
                ? 'bg-[#20B8CD]/25 text-[#5DD5E3]'
                : 'bg-white/[0.04] text-white/30',
            )}
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !p.apiOk || !p.jobs.length} onClick={() => void run(true)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
          Run full pipeline + submit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !p.jobs.length}
          onClick={() => void run(false)}
        >
          Pipeline fill-only
        </Button>
      </div>
      {res && <NexusResultView res={res} />}
      {applyRes && <OneClickResults res={applyRes} />}
    </Shell>
  )
}

/** ── AIHawk volume with real submit ── */
export function AIHawkPlaybook(p: PlaybookProps) {
  const [busy, setBusy] = useState(false)
  const [applyRes, setApplyRes] = useState<OneClickResult | null>(null)
  const live = useMemo(() => p.jobs.filter((j) => !isSyntheticJob(j)), [p.jobs])

  const run = async (submit: boolean) => {
    setBusy(true)
    try {
      const r = await runRealApply(p, { min_score: 45, budget: Math.min(12, live.length || 5), submit })
      if (r) setApplyRes(r)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="AIHawk campaign"
      source="AIHawk spirit"
      blurb="Higher volume auto-apply via Playwright. Prefer Search with LinkedIn allowed for more apply links."
    >
      <NeedJobs onNeedSearch={p.onNeedSearch} n={live.length} />
      <ContactWarn profile={p.profile} />
      <KitRankOpts p={p} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="font-bold bg-gradient-to-r from-[#E85D5D] to-[#20B8CD] text-[#0C0C0C]"
          disabled={busy || !p.apiOk || !live.length}
          onClick={() => void run(true)}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Volume Auto Apply (submit)
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || !live.length} onClick={() => void run(false)}>
          Volume fill-only
        </Button>
      </div>
      {applyRes && <OneClickResults res={applyRes} />}
    </Shell>
  )
}

/** ── HITL with browser apply on approve ── */
export function HitlPlaybook(p: PlaybookProps) {
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<
    Array<{
      id: string
      title: string
      company: string
      apply_url?: string
      grade?: string
      approved: boolean
      job?: RankedJob
    }>
  >([])
  const [applyRes, setApplyRes] = useState<OneClickResult | null>(null)

  const prepare = async () => {
    if (!p.jobs.length) return p.onNeedSearch()
    setBusy(true)
    try {
      const r = await runNexusPipeline({
        profile: p.profile,
        jobs: p.jobs,
        min_score: 50,
        budget: 12,
        mode: 'dry_run',
        forge: true,
      })
      if (!r.ok) return p.onErr(r.error || 'Prepare failed')
      setRows(
        (r.materials || []).map((m) => {
          const job = p.jobs.find((j) => String(j.id) === String(m.job_id))
          return {
            id: String(m.job_id || ''),
            title: m.title || '',
            company: m.company || '',
            apply_url: m.apply_url,
            grade: m.nexus_grade,
            approved: false,
            job,
          }
        }),
      )
      p.onToast(`HITL · ${r.materials?.length ?? 0} ready — approve then Auto Apply`)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, approved: !r.approved } : r)))
  }

  const approveAll = () => setRows((prev) => prev.map((r) => ({ ...r, approved: true })))

  const submitApproved = async () => {
    const approved = rows.filter((r) => r.approved)
    if (!approved.length) {
      p.onErr('Approve at least one job')
      return
    }
    if (!window.confirm(`Auto-apply (fill+submit) ${approved.length} approved job(s)?`)) return
    setBusy(true)
    try {
      const jobs = approved
        .map(
          (r) =>
            r.job ||
            ({
              id: r.id,
              title: r.title,
              company: r.company,
              apply_url: r.apply_url,
              scores: { ensemble: 70 },
              is_synthetic: false,
              source: 'freehire',
              text: r.title,
            } as RankedJob),
        )
        .filter(Boolean)
      const r = await oneClickAutoApply({
        profile: p.profile,
        jobs,
        min_score: 0,
        budget: jobs.length,
        submit: true,
        headless: true,
        forge: true,
        strict_gate: false,
        strict_soft: p.strictSoft !== undefined ? p.strictSoft : loadStrictSoft(),
      })
      setApplyRes(r)
      if (!r.ok) return p.onErr(r.message || r.error || 'Apply failed')
      markFromOneClick(r, jobs, p.onTracker)
      p.onToast(`HITL applied · submitted ${r.summary?.submitted ?? 0}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="HITL review → Auto Apply"
      source="Liam-Frost/AutoApply spirit"
      blurb="Prepare → approve checkboxes → Playwright applies only approved jobs."
    >
      <NeedJobs onNeedSearch={p.onNeedSearch} n={p.jobs.length} />
      <ContactWarn profile={p.profile} />
      <KitRankOpts p={p} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !p.apiOk || !p.jobs.length} onClick={() => void prepare()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
          Prepare queue
        </Button>
        <Button size="sm" variant="ghost" disabled={!rows.length} onClick={approveAll}>
          Approve all
        </Button>
        <Button
          size="sm"
          className="font-bold"
          disabled={busy || !rows.some((r) => r.approved)}
          onClick={() => void submitApproved()}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Auto Apply approved
        </Button>
      </div>
      {!!rows.length && (
        <div className="glass max-h-72 overflow-y-auto rounded-2xl">
          {rows.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-start gap-3 border-b border-white/[0.04] px-3 py-2.5"
            >
              <input
                type="checkbox"
                checked={r.approved}
                onChange={() => toggle(r.id)}
                className="mt-1 accent-[#20B8CD]"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-white/90">
                  {r.title}
                  {r.grade && <span className="ml-2 text-[10px] text-[#B8A6FF]">grade {r.grade}</span>}
                </div>
                <div className="text-[11px] text-white/40">{r.company}</div>
              </div>
            </label>
          ))}
        </div>
      )}
      {applyRes && <OneClickResults res={applyRes} />}
    </Shell>
  )
}

/** ── Autofill + apply ── */
export function AutofillPlaybook(p: PlaybookProps) {
  const [busy, setBusy] = useState(false)
  const [pack, setPack] = useState<Record<string, unknown> | null>(null)
  const [applyRes, setApplyRes] = useState<OneClickResult | null>(null)
  const [localJobs, setLocalJobs] = useState<RankedJob[]>([])
  // Editable contact overrides so Autofill works without bouncing to Search
  const [nameIn, setNameIn] = useState(p.profile.name || '')
  const [emailIn, setEmailIn] = useState(p.profile.email || '')
  const [phoneIn, setPhoneIn] = useState(p.profile.phone || '')
  /** Active Apply Kit job packs (Tailor RT injects) from astra_form_pack_v1 */
  const [kitRows, setKitRows] = useState<FormPackInjectRow[]>(() =>
    formPackInjectRows(loadStoredFormPack()),
  )

  useEffect(() => {
    setNameIn(p.profile.name || '')
    setEmailIn(p.profile.email || '')
    setPhoneIn(p.profile.phone || '')
  }, [p.profile.name, p.profile.email, p.profile.phone])

  // Re-read Apply Kit when storage changes (export from Search) or tab becomes visible
  useEffect(() => {
    const refresh = () => setKitRows(formPackInjectRows(loadStoredFormPack()))
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'astra_form_pack_v1' || e.key === null) refresh()
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const jobs = p.jobs.length ? p.jobs : localJobs
  const liveJobs = useMemo(() => jobs.filter((j) => !isSyntheticJob(j)), [jobs])
  const kitInjectTotal = useMemo(
    () => kitRows.reduce((n, r) => n + r.injects.length, 0),
    [kitRows],
  )

  const profileForPack = (): JobSearchProfile => ({
    ...p.profile,
    name: nameIn.trim() || p.profile.name,
    email: emailIn.trim() || p.profile.email,
    phone: phoneIn.trim() || p.profile.phone,
    // never send empty skills array issues
    skills: p.profile.skills?.length ? p.profile.skills : ['software'],
  })

  const fields = (pack?.fields || {}) as Record<string, string>
  const ready = (pack?.ready || {}) as {
    has_email?: boolean
    has_phone?: boolean
    has_name?: boolean
    can_fill?: boolean
  }

  const load = async () => {
    const email = emailIn.trim() || p.profile.email?.trim()
    if (!email) {
      p.onErr('Enter your email below, then Build pack.')
      return
    }
    setBusy(true)
    try {
      const r = await fetchAutofillProfile(profileForPack())
      if (!r.ok || !r.autofill_profile) {
        p.onErr(r.error || 'Autofill failed — is the API on :8787?')
        return
      }
      setPack(r.autofill_profile as Record<string, unknown>)
      const f = (r.autofill_profile as { fields?: Record<string, string> }).fields || {}
      // Sync derived name/phone back into editors when empty
      if (f.full_name && (!nameIn.trim() || nameIn === 'Candidate')) {
        setNameIn(f.full_name)
      }
      if (f.phone && !phoneIn.trim()) {
        setPhoneIn(f.phone)
      }
      const nameOk =
        f.first_name && f.first_name !== 'Candidate' && !String(f.first_name).includes('@')
      p.onToast(
        nameOk
          ? `Pack ready · ${f.first_name} ${f.last_name || ''} · ${f.email || email}`
          : `Pack built · check name fields (got ${f.first_name || '?'})`,
      )
    } finally {
      setBusy(false)
    }
  }

  /** Search live boards from this playbook when shortlist is empty. */
  const findJobs = async () => {
    if (!p.apiOk) {
      p.onErr('API offline — start START_JOBSEARCH_LAB.bat')
      return
    }
    setBusy(true)
    try {
      const profile = profileForPack()
      const res = await runJobSearch({
        profile,
        use_live: true,
        limit: 40,
        min_score: 0,
        include_seed: false,
      })
      const ranked = (res.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
      setLocalJobs(ranked)
      if (!ranked.length) {
        p.onErr('No live jobs found for this title. Try another target title on Search.')
        return
      }
      p.onToast(`Found ${ranked.length} live job(s) · ready to apply`)
    } catch (e) {
      p.onErr((e as Error).message || 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  /** One-shot: build pack + find jobs if needed. */
  const buildAndReady = async () => {
    await load()
    if (!liveJobs.length) {
      await findJobs()
    }
  }

  const copy = async () => {
    if (!pack) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(pack, null, 2))
      p.onToast('Autofill JSON copied')
    } catch {
      p.onErr('Clipboard blocked')
    }
  }

  const applyWithPack = async () => {
    if (!pack || !fields.email) {
      p.onErr('Build autofill pack first (needs a valid email).')
      return
    }
    let pool = liveJobs
    if (!pool.length) {
      setBusy(true)
      try {
        const profile = profileForPack()
        const res = await runJobSearch({
          profile,
          use_live: true,
          limit: 40,
          min_score: 0,
          include_seed: false,
        })
        pool = (res.ranked_jobs || []).filter((j) => !isSyntheticJob(j))
        setLocalJobs(pool)
      } catch (e) {
        p.onErr((e as Error).message || 'Could not load jobs')
        setBusy(false)
        return
      }
      setBusy(false)
    }
    if (!pool.length) {
      p.onErr('No live jobs to apply to. Change target title and try again.')
      return
    }
    setBusy(true)
    try {
      // Apply using corrected name/email/phone from the pack + local edits
      const enriched: PlaybookProps = {
        ...p,
        jobs: pool,
        profile: {
          ...p.profile,
          name: fields.full_name || nameIn.trim() || p.profile.name,
          email: fields.email || emailIn.trim() || p.profile.email,
          phone: fields.phone || phoneIn.trim() || p.profile.phone,
          linkedin_url: fields.linkedin_url || p.profile.linkedin_url,
          portfolio_url: fields.portfolio_url || p.profile.portfolio_url,
          location: fields.location || p.profile.location,
          resume_text: fields.resume_text || p.profile.resume_text,
          has_resume: Boolean(fields.resume_text || p.profile.resume_text),
          resume_filename: p.profile.resume_filename,
        },
      }
      const r = await runRealApply(
        {
          ...enriched,
          strictSoft: p.strictSoft !== undefined ? p.strictSoft : loadStrictSoft(),
        },
        {
          min_score: 0,
          budget: Math.min(5, pool.length),
          submit: true,
        },
      )
      if (r) setApplyRes(r)
    } finally {
      setBusy(false)
    }
  }

  // Highlight contact fields so user can see if pack is broken
  const highlightKeys = new Set([
    'first_name',
    'last_name',
    'full_name',
    'email',
    'phone',
    'linkedin_url',
    'location',
  ])

  const nameBad =
    !fields.first_name ||
    fields.first_name === 'Candidate' ||
    String(fields.first_name).includes('@')
  const packOk = Boolean(
    fields.email && fields.first_name && !nameBad && !String(fields.summary || '').includes('PK'),
  )

  return (
    <Shell
      title="Simplify autofill + apply"
      source="Simplify.jobs spirit"
      blurb="Fix contact fields here, build the ATS pack, find jobs, then auto-apply — no extra hops."
    >
      <KitRankOpts p={p} />
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-[11px] text-white/40">
          Full name
          <input
            className="mt-1 w-full rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/50"
            value={nameIn}
            onChange={(e) => setNameIn(e.target.value)}
            placeholder="Sri Naidu"
            autoComplete="name"
          />
        </label>
        <label className="block text-[11px] text-white/40">
          Email *
          <input
            className="mt-1 w-full rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/50"
            value={emailIn}
            onChange={(e) => setEmailIn(e.target.value)}
            placeholder="you@email.com"
            type="email"
            autoComplete="email"
          />
        </label>
        <label className="block text-[11px] text-white/40">
          Phone
          <input
            className="mt-1 w-full rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/50"
            value={phoneIn}
            onChange={(e) => setPhoneIn(e.target.value)}
            placeholder="+1 555 123 4567"
            type="tel"
            autoComplete="tel"
          />
        </label>
      </div>
      <p className="text-[11px] text-white/35">
        Resume file: <span className="text-white/60">{p.profile.resume_filename || 'none — upload on Search'}</span>
        {p.profile.has_resume ? ' · text OK' : ' · re-upload DOCX/PDF if parse failed'}
        {' · '}
        Shortlist: <span className="text-white/60">{liveJobs.length} live</span>
        {kitRows.length > 0 && (
          <>
            {' · '}
            Apply Kit:{' '}
            <span className="text-white/60">
              {kitRows.length} pack(s)
              {kitInjectTotal ? ` · ${kitInjectTotal} injects` : ''}
            </span>
          </>
        )}
      </p>
      {kitRows.length > 0 ? (
        <div
          className="rounded-2xl border border-[#20B8CD]/20 bg-[#20B8CD]/05 px-3 py-3 space-y-2"
          data-testid="autofill-kit-injects"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-[#5DD5E3]">
              Active Apply Kit · Tailor RT injects
            </p>
            <button
              type="button"
              className="text-[10px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
              onClick={() => setKitRows(formPackInjectRows(loadStoredFormPack()))}
            >
              Refresh from storage
            </button>
          </div>
          {kitRows.map((row) => (
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
      ) : (
        <p className="text-[11px] text-white/30">
          No Apply Kit in storage yet — export from Search (Apply Kit) to see Tailor RT injects here
          and in the Chrome extension.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="jobs-primary-cta font-bold" disabled={busy || !p.apiOk} onClick={() => void buildAndReady()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Build pack + find jobs
        </Button>
        <Button size="sm" disabled={busy || !p.apiOk} onClick={() => void load()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
          Build pack only
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || !p.apiOk} onClick={() => void findJobs()}>
          Find jobs
        </Button>
        <Button size="sm" variant="secondary" disabled={!pack} onClick={() => void copy()}>
          Copy JSON
        </Button>
        <Button
          size="sm"
          className="font-bold"
          disabled={busy || !p.apiOk || !pack || !fields.email}
          onClick={() => void applyWithPack()}
          title={!pack ? 'Build pack first' : !fields.email ? 'Pack needs email' : 'Apply'}
        >
          <Zap className="h-3.5 w-3.5" />
          Apply with pack
        </Button>
      </div>
      {!liveJobs.length && (
        <div className="glass rounded-2xl px-4 py-4 text-center text-[13px] text-white/45">
          No shortlist yet — click <strong className="text-white/70">Build pack + find jobs</strong> (runs
          live search for you).
        </div>
      )}
      {!!Object.keys(fields).length && (
        <>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span
              className={cn(
                'rounded-full px-2 py-0.5',
                packOk ? 'bg-[#20B8CD]/15 text-[#5DD5E3]' : 'bg-[#E85D5D]/15 text-[#E85D5D]',
              )}
            >
              {packOk ? 'Pack OK for fill' : 'Pack incomplete — fix name/email/phone above'}
            </span>
            {!fields.phone && (
              <span className="rounded-full bg-[#E8C547]/15 px-2 py-0.5 text-[#E8C547]">
                Phone empty — type it above
              </span>
            )}
            {nameBad && (
              <span className="rounded-full bg-[#E85D5D]/15 px-2 py-0.5 text-[#E85D5D]">
                Name wrong — type full name above and rebuild
              </span>
            )}
            {String(fields.summary || '').includes('PK') && (
              <span className="rounded-full bg-[#E85D5D]/15 px-2 py-0.5 text-[#E85D5D]">
                Resume binary — re-upload PDF/DOCX on Search
              </span>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(fields)
              .filter(([k]) => highlightKeys.has(k) || ['current_title', 'skills', 'summary'].includes(k))
              .map(([k, v]) => {
                const bad =
                  ((k === 'first_name' || k === 'full_name') &&
                    (String(v || '').includes('@') || v === 'Candidate')) ||
                  (k === 'summary' && String(v || '').includes('PK'))
                const empty = !String(v ?? '').trim()
                return (
                  <div
                    key={k}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-[11px]',
                      bad
                        ? 'border-[#E85D5D]/40 bg-[#E85D5D]/10'
                        : empty && (k === 'phone' || k === 'email')
                          ? 'border-[#E8C547]/30 bg-[#E8C547]/08'
                          : 'border-white/[0.06] bg-black/30',
                    )}
                  >
                    <div className="text-white/35">{k}</div>
                    <div className="truncate text-white/80">{String(v || '—')}</div>
                  </div>
                )
              })}
          </div>
        </>
      )}
      {applyRes && <OneClickResults res={applyRes} />}
    </Shell>
  )
}
