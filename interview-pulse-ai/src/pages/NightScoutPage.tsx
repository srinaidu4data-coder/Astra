/**
 * Night Scout — searches while you sleep; morning digest ready when you wake.
 * Multi-tenant ready (X-Tenant-Id); worker fleet + SQLite WAL / Postgres path.
 */

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  fetchMorningDigest,
  isJobSearchLabHost,
  listNightSchedules,
  nightHealth,
  runNightScheduleNow,
  saveNightSchedule,
  type MorningDigest,
  type NightSchedule,
} from '@/services/jobsearch'
import { sanitizeResumeText } from '@/services/parser'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'
import {
  ExternalLink,
  Loader2,
  Moon,
  RefreshCw,
  Save,
  Sun,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'

export type NightScoutPageProps = {
  embedded?: boolean
  onSwitchSearch?: () => void
  onSwitchAuto?: () => void
}

export function NightScoutPage({
  embedded = false,
  onSwitchSearch,
  onSwitchAuto,
}: NightScoutPageProps = {}) {
  const lab = isJobSearchLabHost()
  const setRoute = useAppStore((s) => s.setRoute)
  const documents = useAppStore((s) => s.documents)
  // Never ship binary DOCX junk into night schedules
  const resumeText = sanitizeResumeText(
    documents.find((d) => d.type === 'resume')?.text || '',
  )

  const [title, setTitle] = useState('')
  const [skills, setSkills] = useState('')
  const [location, setLocation] = useState('us')
  const [remote, setRemote] = useState('all')
  const [runHour, setRunHour] = useState(2)
  const [wakeHour, setWakeHour] = useState(7)
  const [enabled, setEnabled] = useState(true)
  const [scheduleId, setScheduleId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [workerOk, setWorkerOk] = useState(false)
  const [morning, setMorning] = useState<MorningDigest | null>(null)
  const [schedules, setSchedules] = useState<NightSchedule[]>([])

  const refresh = async () => {
    const [h, s, m] = await Promise.all([
      nightHealth(),
      listNightSchedules(),
      fetchMorningDigest(),
    ])
    setWorkerOk(Boolean(h.ok))
    if (s.ok && s.schedules) {
      setSchedules(s.schedules)
      const first = s.schedules[0]
      if (first) {
        // Keep schedule id / hours for run-now; do not overwrite Role/Skills
        // with saved defaults (user wants empty fields until they type).
        setScheduleId(first.id)
        setLocation(first.location || 'us')
        setRemote(first.remote || 'all')
        setRunHour(first.run_hour_local ?? 2)
        setWakeHour(first.wake_hour_local ?? 7)
        setEnabled(first.enabled !== false)
      }
    }
    setMorning(m)
  }

  useEffect(() => {
    if (!lab) return
    void refresh()
    const t = window.setInterval(() => void fetchMorningDigest().then(setMorning), 30_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lab])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [toast])

  const save = async () => {
    if (!title.trim()) {
      setErr('Enter a role (e.g. SAP Consultant) before saving.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await saveNightSchedule({
        id: scheduleId,
        name: 'Night Scout',
        enabled,
        target_title: title.trim(),
        skills: skills
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        resume_text: resumeText.slice(0, 8000),
        location,
        remote,
        exclude_linkedin: false,
        include_seed: false,
        limit_jobs: 100,
        run_hour_local: runHour,
        wake_hour_local: wakeHour,
        build_apply_plan: true,
      })
      if (!res.ok) {
        setErr(res.error || 'Save failed')
        return
      }
      setScheduleId(res.schedule?.id)
      setToast(
        `Night Scout saved · runs nightly at ${String(runHour).padStart(2, '0')}:00 · ready by ${String(wakeHour).padStart(2, '0')}:00`,
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const runNow = async () => {
    if (!title.trim()) {
      setErr('Enter a role before running Night Scout.')
      return
    }
    let id = scheduleId
    if (!id) {
      setBusy(true)
      try {
        const res = await saveNightSchedule({
          name: 'Night Scout',
          enabled,
          target_title: title.trim(),
          skills: skills
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
          resume_text: resumeText.slice(0, 8000),
          location,
          remote,
          limit_jobs: 100,
          run_hour_local: runHour,
          wake_hour_local: wakeHour,
          build_apply_plan: true,
        })
        id = res.schedule?.id
        if (id) setScheduleId(id)
      } finally {
        setBusy(false)
      }
    }
    if (!id) {
      setErr('Save a schedule first')
      return
    }
    return runNowWithId(id)
  }

  const runNowWithId = async (id: string) => {
    setRunning(true)
    setErr(null)
    try {
      const res = await runNightScheduleNow(id)
      if (!res.ok) {
        setErr(res.error || 'Night run failed')
        return
      }
      setToast(
        `Night run done · ${res.result?.live_count ?? 0} live roles · ${Math.round((res.result?.elapsed_ms || 0) / 1000)}s`,
      )
      await refresh()
    } finally {
      setRunning(false)
    }
  }

  if (!lab) {
    return (
      <div className="p-8 text-center text-white/50">Night Scout is localhost lab only.</div>
    )
  }

  const topRun = morning?.runs?.[0]
  const jobs = (topRun?.digest?.jobs || topRun?.digest?.top5 || []) as Array<
    Record<string, unknown>
  >

  const sendDigestToSearch = () => {
    if (!jobs.length) {
      setErr('No morning jobs yet — Run night job now first')
      return
    }
    try {
      localStorage.setItem(
        'ip_jobsearch_seed_from_night',
        JSON.stringify({
          at: new Date().toISOString(),
          title,
          skills,
          jobs,
        }),
      )
      setToast('Morning jobs saved — open Search tab to load them')
      onSwitchSearch?.()
    } catch {
      setErr('Could not hand off jobs to Search')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-10">
      <header className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-gradient-to-br from-[#0a1628] via-[#12101f] to-[#0c0c0c] p-6 md:p-8">
        <div className="pointer-events-none absolute -right-8 top-0 h-40 w-40 rounded-full bg-[#5B8DEF]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-[#8EB6FF]">
              <Moon className="h-3.5 w-3.5" />
              Night Scout · mega-scale ready
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight text-white md:text-[26px]">
              Search while you sleep.
              <span className="block text-[#8EB6FF]">Wake up to matches.</span>
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-white/50">
              Schedule overnight harvests across live boards. Durable multi-tenant store, worker
              leases for scale, morning digest with optional auto-apply plan ready before coffee.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void save()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save schedule
              </Button>
              <Button size="sm" variant="secondary" disabled={running} onClick={() => void runNow()}>
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Run night job now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onSwitchAuto ? onSwitchAuto() : onSwitchSearch ? onSwitchSearch() : setRoute('jobsearch')
                }
              >
                {embedded ? 'Back to Search' : 'Jobs hub'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[200px]">
            <Mini label="API / Night" value={workerOk ? 'Online' : 'Offline'} ok={workerOk} />
            <Mini label="Schedules" value={String(schedules.length)} />
            <Mini
              label="Morning ready"
              value={morning?.ready ? 'Yes' : 'Not yet'}
              ok={Boolean(morning?.ready)}
            />
            <Mini label="Last live" value={String(topRun?.live_count ?? 0)} />
          </div>
        </div>
      </header>

      {err && (
        <div className="rounded-2xl border border-[#E85D5D]/35 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
          {err}
        </div>
      )}
      {toast && (
        <div className="rounded-2xl border border-[#5B8DEF]/30 bg-[#5B8DEF]/10 px-4 py-2.5 text-[13px] text-[#8EB6FF]">
          {toast}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="glass space-y-3 rounded-[24px] p-4 md:p-5">
          <h2 className="text-[14px] font-semibold text-white/90">Overnight criteria</h2>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-white/35">Role</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. SAP Consultant"
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-[13px] text-white/90 outline-none focus:border-[#5B8DEF]/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-white/35">Skills</span>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="optional — sap, abap, hana…"
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 text-[13px] text-white/90 outline-none focus:border-[#5B8DEF]/40"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-white/35">Location</span>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
              >
                <option value="us">US</option>
                <option value="all">Anywhere</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-white/35">Work</span>
              <select
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
              >
                <option value="all">All</option>
                <option value="remote">Remote</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-white/35">
                <Moon className="mr-1 inline h-3 w-3" />
                Run hour
              </span>
              <select
                value={runHour}
                onChange={(e) => setRunHour(Number(e.target.value))}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-white/35">
                <Sun className="mr-1 inline h-3 w-3" />
                Wake by
              </span>
              <select
                value={wakeHour}
                onChange={(e) => setWakeHour(Number(e.target.value))}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-black/30 px-2 text-[12px] text-white/80"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-white/55">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-[#5B8DEF]"
            />
            Enabled (worker will claim nightly)
          </label>
          <p className="text-[10px] leading-relaxed text-white/30">
            Keep <code className="text-white/45">python -m jobsearch.night_worker</code> running
            (START_JOBSEARCH_LAB.bat starts it). Multi-worker safe via leases. DB:
            src/data/night_scout.db
          </p>
        </aside>

        <div className="flex flex-col gap-4">
          {/* Morning digest */}
          <section className="glass overflow-hidden rounded-[24px]">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-[#5B8DEF]/12 to-transparent px-4 py-3">
              <Sun className="h-4 w-4 text-[#E8C547]" />
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-white/95">Morning digest</h2>
                <p className="text-[11px] text-white/40">
                  {topRun?.digest?.headline ||
                    (morning?.ready
                      ? 'Results ready'
                      : 'No overnight run yet — save schedule or Run night job now')}
                </p>
              </div>
              {morning?.ready && <Badge tone="emerald">ready</Badge>}
              {jobs.length > 0 && (
                <Button size="sm" variant="secondary" onClick={sendDigestToSearch}>
                  Load into Search
                </Button>
              )}
            </div>
            {!jobs.length ? (
              <div className="space-y-3 px-6 py-10 text-center text-[13px] text-white/40">
                <p>No morning matches yet.</p>
                <ol className="mx-auto max-w-sm space-y-1 text-left text-[12px] text-white/35">
                  <li>1. Set role + skills on the left</li>
                  <li>2. Click <strong className="text-white/60">Save schedule</strong></li>
                  <li>3. Click <strong className="text-white/60">Run night job now</strong></li>
                  <li>4. Or leave worker running overnight via START_JOBSEARCH_LAB.bat</li>
                </ol>
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                {jobs.slice(0, 40).map((j, i) => {
                  const title = String(j.title || '')
                  const company = String(j.company || '')
                  const location = j.location ? String(j.location) : ''
                  const source = j.source ? String(j.source) : ''
                  const apply = String(j.apply_url || j.url || '')
                  const score =
                    typeof j.scores === 'object' && j.scores && 'ensemble' in (j.scores as object)
                      ? (j.scores as { ensemble?: number }).ensemble
                      : undefined
                  return (
                    <div
                      key={String(j.id) + i}
                      className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3"
                    >
                      <span className="w-6 text-[11px] tabular-nums text-[#8EB6FF]">#{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-white/90">{title}</div>
                        <div className="truncate text-[11px] text-white/40">
                          {company}
                          {location ? ` · ${location}` : ''}
                          {source ? ` · ${source}` : ''}
                        </div>
                      </div>
                      <span className="tabular-nums text-[12px] text-[#5DD5E3]">
                        {score ?? '—'}
                      </span>
                      {apply.startsWith('http') && (
                        <a
                          href={apply}
                          target="_blank"
                          rel="noreferrer"
                          className="text-white/30 hover:text-[#5DD5E3]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {(jobs.length > 0 || !!topRun?.digest?.apply_campaign?.steps?.length) && (
              <div className="flex flex-wrap gap-2 border-t border-white/[0.06] px-4 py-3">
                {jobs.length > 0 && (
                  <Button size="sm" onClick={sendDigestToSearch}>
                    <Zap className="h-3.5 w-3.5" />
                    Load into Search / Apply
                  </Button>
                )}
                {!!topRun?.digest?.apply_campaign?.steps?.length && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => (onSwitchAuto ? onSwitchAuto() : setRoute('jobsearch'))}
                  >
                    Open Auto Apply
                  </Button>
                )}
              </div>
            )}
          </section>

          <section className="glass rounded-[24px] p-4 text-[11px] leading-relaxed text-white/40">
            <strong className="text-white/60">Scale architecture:</strong> tenant-scoped schedules ·
            SQLite WAL (swap to Postgres) · worker claim leases · horizontal workers · morning digest
            API. Path to mega-scale: Redis/SQS queue → K8s HPA workers → object store digests — same
            API shape.
          </section>
        </div>
      </div>
    </div>
  )
}

function Mini({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[15px] font-semibold text-white/90',
          ok === true && 'text-[#5DD5E3]',
          ok === false && 'text-[#E85D5D]',
        )}
      >
        {value}
      </div>
    </div>
  )
}
