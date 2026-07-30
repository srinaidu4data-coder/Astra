import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  isJobSearchLabHost,
  jobsearchHealth,
  runJobSearch,
  type JobSearchRunResult,
  type RankedJob,
} from '@/services/jobsearch'
import { useAppStore } from '@/stores/app-store'
import { Loader2, Radar, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

/**
 * Job Search AI — localhost lab only.
 * One-button multi-agent search/rank/outreach draft pipeline.
 * Does not modify copilot / mock / billing / admin production flows.
 */
export function JobSearchPage() {
  const user = useAppStore((s) => s.user)
  const documents = useAppStore((s) => s.documents)
  const activeJobTitle = useAppStore((s) => s.activeJobTitle)
  const settings = useAppStore((s) => s.settings)

  const lab = isJobSearchLabHost()
  const [title, setTitle] = useState(activeJobTitle || 'Software Engineer')
  const [skills, setSkills] = useState('typescript, react, python, api, llm')
  const [summary, setSummary] = useState(
    settings.jobContext || 'Full-stack engineer focused on AI copilots and real-time systems',
  )
  const [useLive, setUseLive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<JobSearchRunResult | null>(null)
  const [apiLab, setApiLab] = useState<boolean | null>(null)

  useEffect(() => {
    if (!lab) return
    void jobsearchHealth().then((h) => setApiLab(Boolean(h.lab_enabled)))
  }, [lab])

  // Prefill skills from uploaded knowledge docs (local only, read-only)
  const docHint = useMemo(() => {
    const resume = documents.find((d) => d.type === 'resume')
    if (!resume?.text) return null
    return resume.text.slice(0, 400)
  }, [documents])

  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      const skillList = skills
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const data = await runJobSearch({
        profile: {
          name: user?.name || user?.email || 'Candidate',
          target_title: title,
          summary: [summary, docHint].filter(Boolean).join('\n'),
          skills: skillList,
          remote_ok: true,
        },
        use_live: useLive,
      })
      setResult(data)
    } catch (e) {
      setErr((e as Error).message || 'Run failed')
    } finally {
      setBusy(false)
    }
  }

  if (!lab) {
    return (
      <div className="mx-auto max-w-lg glass rounded-[28px] p-10 text-center">
        <Radar className="mx-auto mb-4 h-8 w-8 text-white/30" />
        <h2 className="text-[17px] font-medium text-white/90">Job Search AI (lab)</h2>
        <p className="mt-2 text-[13px] text-white/40">
          This module is enabled only on <code className="text-[#5DD5E3]">localhost</code> while
          we validate ranking and outreach drafts. Production candidates will get it after
          testing.
        </p>
      </div>
    )
  }

  const ranked: RankedJob[] = result?.ranked_jobs || []
  const agents = result?.agents || {}

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <section className="glass rounded-[28px] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#5DD5E3]" strokeWidth={1.75} />
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                Job Search AI
              </h2>
              <Badge tone="amber">localhost lab</Badge>
            </div>
            <p className="max-w-2xl text-[13px] leading-relaxed text-white/40">
              Multi-agent research team: Scout → Harvester → Scorer (BM25, cosine, Jaccard,
              Bayesian fit, graph centrality, spectral path, Elo) → Critic → Outreach → Upskill.
              Inspired by open workflows like ai-job-search, reimplemented in-process without
              disturbing interview copilot.
            </p>
            {apiLab === false && (
              <p className="mt-2 text-[12px] text-[#E85D5D]">
                API lab gate is off — start copilot_api on localhost.
              </p>
            )}
          </div>
          <Button size="lg" disabled={busy} onClick={() => void run()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            {busy ? 'Running agents…' : 'Job Search AI'}
          </Button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-white/35">Target title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-white/35">
              Skills (comma-separated)
            </span>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
            />
          </label>
          <label className="md:col-span-2 flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-white/35">Summary</span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-white/55">
            <input
              type="checkbox"
              checked={useLive}
              onChange={(e) => setUseLive(e.target.checked)}
              className="accent-[#20B8CD]"
            />
            Include live freehire.me tech board (optional network)
          </label>
        </div>

        {err && (
          <div className="mt-4 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
            {err}
          </div>
        )}
      </section>

      {result && (
        <>
          <section className="glass rounded-[28px] p-6">
            <h3 className="mb-3 text-[14px] font-medium text-white/80">RT agents</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(agents).map(([name, payload]) => (
                <div
                  key={name}
                  className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] px-4 py-3"
                >
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-[#5DD5E3]">
                    {name}
                  </div>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] text-white/45">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </section>

          <section className="glass overflow-hidden rounded-[28px]">
            <div className="border-b border-white/[0.06] px-6 py-4">
              <h3 className="text-[14px] font-medium text-white/80">
                Ranked opportunities
                <span className="ml-2 text-white/35">({ranked.length})</span>
              </h3>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {ranked.map((j) => (
                <div key={j.id} className="px-5 py-4 md:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium text-white/90">
                        {j.title}
                      </div>
                      <div className="text-[12px] text-white/40">
                        {j.company}
                        {j.location ? ` · ${j.location}` : ''}
                        {j.remote ? ' · remote' : ''}
                        {j.source ? ` · ${j.source}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        tone={
                          j.verdict === 'strong'
                            ? 'emerald'
                            : j.verdict === 'good'
                              ? 'indigo'
                              : 'default'
                        }
                      >
                        {j.verdict || 'scored'} · {j.scores?.ensemble ?? '—'}
                      </Badge>
                    </div>
                  </div>
                  {j.scores && (
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/35">
                      {Object.entries(j.scores).map(([k, v]) => (
                        <span key={k} className="rounded bg-white/[0.04] px-1.5 py-0.5">
                          {k} {v}
                        </span>
                      ))}
                    </div>
                  )}
                  {!!j.gap_skills?.length && (
                    <p className="mt-2 text-[12px] text-white/40">
                      Gaps: {j.gap_skills.join(', ')}
                    </p>
                  )}
                  {j.url && (
                    <a
                      href={j.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-[12px] text-[#5DD5E3] hover:underline"
                    >
                      Open posting
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
