/**
 * Company Twin Interview Sprint — flagship prep for one job opportunity.
 * Progressive disclosure: role+JD → free diagnostic → paywall → dossier/mock/live.
 */
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { setSessionContext } from '@/services/real-api'
import { parseUploadedFile } from '@/services/parser'
import {
  claimReferral,
  createOpportunity,
  deleteSprintAccountData,
  exportSprintAccount,
  fetchEntitlements,
  fetchLiveContext,
  fetchMockPlan,
  fetchReadinessReport,
  generateDossier,
  listOpportunities,
  listStories,
  runDiagnostic,
  startProductCheckout,
  trackSprintEvent,
  updateStory,
  type Diagnostic,
  type InterviewStage,
  type Opportunity,
  type ProductPublic,
} from '@/services/sprint'
import { useAppStore } from '@/stores/app-store'
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  Share2,
  Sparkles,
  Target,
  Upload,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

const STAGES: { id: InterviewStage; label: string }[] = [
  { id: 'recruiter', label: 'Recruiter' },
  { id: 'hiring_manager', label: 'Hiring manager' },
  { id: 'technical', label: 'Technical' },
  { id: 'behavioral', label: 'Behavioral' },
  { id: 'case_study', label: 'Case study' },
  { id: 'panel', label: 'Panel' },
  { id: 'executive', label: 'Executive' },
  { id: 'final', label: 'Final' },
]

type Step = 'setup' | 'diagnostic' | 'paywall' | 'workspace'

export function SprintPage() {
  const setRoute = useAppStore((s) => s.setRoute)
  const setActiveJobTitle = useAppStore((s) => s.setActiveJobTitle)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const paidShell = useAppStore((s) => Boolean(s.user?.subscription_active))

  const [step, setStep] = useState<Step>('setup')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Minimal fields first
  const [role, setRole] = useState('')
  const [jd, setJd] = useState('')
  // Expanded
  const [showMore, setShowMore] = useState(false)
  const [company, setCompany] = useState('')
  const [resume, setResume] = useState('')
  const [stage, setStage] = useState<InterviewStage>('hiring_manager')
  const [concerns, setConcerns] = useState('')
  const [tone, setTone] = useState('professional')
  const [answerLength, setAnswerLength] = useState('medium')
  const [interviewAt, setInterviewAt] = useState('')
  const [interviewerName, setInterviewerName] = useState('')
  const [interviewerTitle, setInterviewerTitle] = useState('')
  const [interviewerUrl, setInterviewerUrl] = useState('')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [readinessShare, setReadinessShare] = useState<{
    anonymous_badge: string
    referral_link: string
    overall_readiness: number
    improvement_points: number
    policy: string
  } | null>(null)
  const [followUpEmail, setFollowUpEmail] = useState('')

  const [opp, setOpp] = useState<Opportunity | null>(null)
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
  const [products, setProducts] = useState<ProductPublic[]>([])
  const [paidAccess, setPaidAccess] = useState(paidShell)
  const [liveMinutes, setLiveMinutes] = useState(0)
  const [dossier, setDossier] = useState<Record<string, unknown> | null>(null)
  const [stories, setStories] = useState<
    Array<{
      id: number
      title: string
      status: string
      confidence: number
      missing_details: string
      result: string
    }>
  >([])
  const [opps, setOpps] = useState<Opportunity[]>([])

  const refreshEntitlements = useCallback(async () => {
    try {
      const e = await fetchEntitlements()
      setPaidAccess(Boolean(e.paid_access))
      setLiveMinutes(e.live_minutes_remaining)
      setProducts((e.products || []) as ProductPublic[])
    } catch {
      /* offline */
    }
  }, [])

  useEffect(() => {
    void trackSprintEvent('landing_viewed', { source: 'sprint_page' })
    void refreshEntitlements()
    void listOpportunities()
      .then(setOpps)
      .catch(() => setOpps([]))
    // Referral deep link: #/sprint?ref=CODE
    try {
      const q = (window.location.hash.split('?')[1] || '')
      const params = new URLSearchParams(q)
      const ref = params.get('ref')
      if (ref) {
        void claimReferral(ref).catch(() => {
          /* already claimed or invalid */
        })
      }
    } catch {
      /* ignore */
    }
    try {
      const deb = sessionStorage.getItem('ip_sprint_last_debrief')
      if (deb) {
        const d = JSON.parse(deb) as { follow_up_email_draft?: string }
        if (d.follow_up_email_draft) setFollowUpEmail(d.follow_up_email_draft)
      }
    } catch {
      /* ignore */
    }
  }, [refreshEntitlements])

  const onUpload = async (file: File, kind: 'job' | 'resume') => {
    setUploadBusy(true)
    setError(null)
    try {
      const doc = await parseUploadedFile(file, kind)
      if (kind === 'job') {
        setJd(doc.text.slice(0, 20000))
        if (!role.trim()) setRole(file.name.replace(/\.[^.]+$/, ''))
        void trackSprintEvent('jd_supplied')
      } else {
        setResume(doc.text.slice(0, 20000))
        void trackSprintEvent('resume_supplied')
      }
    } catch (e) {
      setError((e as Error).message || 'Could not parse file (use PDF, DOCX, or TXT)')
    } finally {
      setUploadBusy(false)
    }
  }

  const progress =
    step === 'setup' ? 25 : step === 'diagnostic' ? 50 : step === 'paywall' ? 75 : 100

  const runFreeDiagnostic = async () => {
    if (!role.trim() && !jd.trim()) {
      setError('Enter a target role or paste a job description to continue.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Create or update opportunity draft
      let current = opp
      if (!current) {
        const interviewers =
          interviewerName.trim() || interviewerTitle.trim() || interviewerUrl.trim()
            ? [
                {
                  name: interviewerName.trim(),
                  title: interviewerTitle.trim(),
                  url: interviewerUrl.trim(),
                },
              ]
            : []
        current = await createOpportunity({
          company,
          role,
          job_description: jd,
          resume_text: resume,
          interview_stage: stage,
          concerns: concerns
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 3),
          answer_tone: tone,
          answer_length: answerLength,
          interview_at: interviewAt || undefined,
          interviewers,
        })
        setOpp(current)
        try {
          sessionStorage.setItem('ip_sprint_opportunity_id', String(current.id))
        } catch {
          /* ignore */
        }
      }

      const res = await runDiagnostic({
        opportunity_id: current.id,
        company,
        role,
        job_description: jd,
        resume_text: resume,
        interview_stage: stage,
        source: 'sprint_ui',
      })
      setDiagnostic(res.diagnostic)
      setStep('diagnostic')
      if (res.entitlements) {
        setPaidAccess(Boolean((res.entitlements as { paid_access?: boolean }).paid_access))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkout = async (code: string) => {
    setBusy(true)
    setError(null)
    void trackSprintEvent('checkout_started', { source: code })
    void trackSprintEvent('paywall_viewed')
    try {
      const url = await startProductCheckout(code, opp?.id)
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const unlockWorkspace = async () => {
    if (!opp) return
    setBusy(true)
    setError(null)
    try {
      if (paidAccess) {
        const d = await generateDossier(opp.id)
        setDossier(d.dossier)
        const st = await listStories(opp.id)
        setStories(st)
        setStep('workspace')
      } else {
        setStep('paywall')
      }
    } catch (e) {
      const msg = (e as Error).message || ''
      if (/402|payment|purchase|pass/i.test(msg)) {
        setStep('paywall')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const startTwinMock = async () => {
    if (!opp) return
    setBusy(true)
    setError(null)
    try {
      const plan = await fetchMockPlan(opp.id)
      // Seed practice via store + navigate to Mock
      setActiveJobTitle(plan.job_title || role)
      // Store questions for practice handoff
      try {
        sessionStorage.setItem(
          'ip_sprint_mock_plan',
          JSON.stringify({
            opportunity_id: opp.id,
            ...plan,
          }),
        )
        sessionStorage.setItem('ip_sprint_opportunity_id', String(opp.id))
      } catch {
        /* ignore */
      }
      void trackSprintEvent('first_mock_completed', { source: 'sprint_start' })
      setRoute('practice')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openLiveSprint = async () => {
    if (!opp) return
    setBusy(true)
    setError(null)
    try {
      const ctx = await fetchLiveContext(opp.id)
      const storyBlob = (ctx.verified_stories || [])
        .map(
          (s) =>
            `${s.title}: ${s.situation} → ${s.actions} → ${s.result} (${s.metrics || 'no metric'})`,
        )
        .join('\n')
      void setSessionContext({
        role: `${ctx.role}${ctx.company ? ` @ ${ctx.company}` : ''}`,
        job_description: ctx.job_description.slice(0, 8000),
        resume_text: ctx.resume_text.slice(0, 6000),
        stories: storyBlob ? [storyBlob.slice(0, 2000)] : [],
        outline_first: true,
      })
      setActiveJobTitle(ctx.role || role)
      updateSettings({
        jobContext: ctx.company ? `${ctx.role} · ${ctx.company}` : ctx.role,
      })
      try {
        const { consumeLiveMinutes } = await import('@/services/sprint')
        await consumeLiveMinutes(1, opp.id)
      } catch (e) {
        // 402 = out of minutes — still open live but surface error
        setError((e as Error).message)
      }
      try {
        sessionStorage.setItem('ip_sprint_opportunity_id', String(opp.id))
      } catch {
        /* ignore */
      }
      void trackSprintEvent('first_live_started')
      setRoute('copilot')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verifyStory = async (id: number) => {
    try {
      await updateStory(id, { status: 'verified' })
      if (opp) setStories(await listStories(opp.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* Progress */}
      <div className="glass rounded-[22px] px-5 py-4">
        <div className="mb-2 flex items-center justify-between text-[12px] text-white/45">
          <span className="flex items-center gap-2 font-medium text-white/80">
            <Target className="h-4 w-4 text-[#20B8CD]" />
            Company Twin Interview Sprint
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#20B8CD] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-[12px] text-white/35">
          Prep for one real job — not a generic subscription you have to reverse-engineer.
        </p>
      </div>

      {error && (
        <div
          className="rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* SETUP */}
      {step === 'setup' && (
        <section className="glass rounded-[28px] p-6 md:p-8">
          <h2 className="text-[17px] font-medium text-white/95">Start free diagnostic</h2>
          <p className="mt-1 mb-6 text-[13px] text-white/40">
            Role + job description is enough for a useful preview in under three minutes.
          </p>

          <label className="block">
            <span className="label-quiet">Target role</span>
            <input
              className="field mt-1.5"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. SAP FICO Consultant"
            />
          </label>
          <label className="mt-4 block">
            <span className="label-quiet">Job description</span>
            <textarea
              className="field mt-1.5 min-h-[120px] resize-y"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the JD…"
            />
          </label>

          <button
            type="button"
            className="mt-4 text-[13px] text-[#5DD5E3] hover:underline"
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? 'Hide optional details' : 'Add company, resume, stage…'}
          </button>

          {showMore && (
            <div className="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
              <label className="block">
                <span className="label-quiet">Company</span>
                <input
                  className="field mt-1.5"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Acme Corp"
                />
              </label>
              <label className="block">
                <span className="label-quiet">Resume text (paste)</span>
                <textarea
                  className="field mt-1.5 min-h-[100px] resize-y"
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                  placeholder="Paste resume text for better match scoring…"
                />
              </label>
              <div>
                <span className="label-quiet">Interview stage</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STAGES.map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      variant={stage === s.id ? 'default' : 'secondary'}
                      onClick={() => setStage(s.id)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="label-quiet">Biggest concerns (one per line)</span>
                <textarea
                  className="field mt-1.5 min-h-[72px] resize-y"
                  value={concerns}
                  onChange={(e) => setConcerns(e.target.value)}
                  placeholder="System design depth&#10;Salary negotiation&#10;Panel dynamics"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="label-quiet">Answer tone</span>
                  <select
                    className="field mt-1.5"
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                  >
                    <option value="professional">Professional</option>
                    <option value="confident">Confident</option>
                    <option value="concise">Concise</option>
                  </select>
                </label>
                <label>
                  <span className="label-quiet">Answer length</span>
                  <select
                    className="field mt-1.5"
                    value={answerLength}
                    onChange={(e) => setAnswerLength(e.target.value)}
                  >
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long / STAR</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="label-quiet">Interview date (optional)</span>
                <input
                  type="datetime-local"
                  className="field mt-1.5"
                  value={interviewAt}
                  onChange={(e) => setInterviewAt(e.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label>
                  <span className="label-quiet">Interviewer name</span>
                  <input
                    className="field mt-1.5"
                    value={interviewerName}
                    onChange={(e) => setInterviewerName(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  <span className="label-quiet">Title</span>
                  <input
                    className="field mt-1.5"
                    value={interviewerTitle}
                    onChange={(e) => setInterviewerTitle(e.target.value)}
                    placeholder="e.g. Eng Manager"
                  />
                </label>
                <label>
                  <span className="label-quiet">Public profile URL</span>
                  <input
                    className="field mt-1.5"
                    value={interviewerUrl}
                    onChange={(e) => setInterviewerUrl(e.target.value)}
                    placeholder="LinkedIn URL (optional)"
                  />
                </label>
              </div>
              <p className="text-[11px] text-white/30">
                We only use interviewer info you provide — no invented background.
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] text-white/70">
              <Upload className="h-3.5 w-3.5" />
              {uploadBusy ? 'Parsing…' : 'Upload JD'}
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                disabled={uploadBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onUpload(f, 'job')
                  e.target.value = ''
                }}
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] text-white/70">
              <Upload className="h-3.5 w-3.5" />
              {uploadBusy ? 'Parsing…' : 'Upload resume'}
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                disabled={uploadBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onUpload(f, 'resume')
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              size="lg"
              className="min-h-[48px]"
              disabled={busy}
              onClick={() => void runFreeDiagnostic()}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Running…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Run free diagnostic
                </>
              )}
            </Button>
          </div>

          {opps.length > 0 && (
            <div className="mt-8 border-t border-white/[0.06] pt-6">
              <h3 className="text-[13px] font-medium text-white/70">Your opportunities</h3>
              <ul className="mt-3 space-y-2">
                {opps.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="w-full rounded-[14px] glass-inset px-4 py-3 text-left text-[13px] text-white/80 hover:bg-white/[0.04]"
                      onClick={() => {
                        setOpp(o)
                        setRole(o.role)
                        setCompany(o.company)
                        setJd(o.job_description)
                        setResume(o.resume_text)
                        setStage((o.interview_stage as InterviewStage) || 'hiring_manager')
                        if (o.has_diagnostic) {
                          try {
                            const d = JSON.parse(
                              // diagnostic stored server-side; re-run if needed
                              '{}',
                            )
                            void d
                          } catch {
                            /* */
                          }
                          void runDiagnostic({ opportunity_id: o.id }).then((r) => {
                            setDiagnostic(r.diagnostic)
                            setStep('diagnostic')
                          })
                        }
                      }}
                    >
                      {o.role || 'Untitled'} {o.company ? `@ ${o.company}` : ''}
                      {o.readiness_score != null && (
                        <span className="ml-2 text-white/40">· {o.readiness_score}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* DIAGNOSTIC */}
      {step === 'diagnostic' && diagnostic && (
        <section className="glass rounded-[28px] p-6 md:p-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-medium text-white/95">Your free diagnostic</h2>
              <p className="mt-1 text-[13px] text-white/40">
                Real value — full Twin prep unlocks after purchase.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[40px] font-medium tracking-tight text-[#20B8CD]">
                {diagnostic.match_score}
              </div>
              <div className="text-[12px] text-white/40">Match score</div>
            </div>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[16px] glass-inset p-4">
              <div className="text-[11px] text-white/40">Est. prep</div>
              <div className="mt-1 text-[18px] text-white/90">
                ~{diagnostic.estimated_prep_hours}h
              </div>
            </div>
            <div className="rounded-[16px] glass-inset p-4 sm:col-span-2">
              <div className="text-[11px] text-white/40">Gaps vs JD</div>
              <ul className="mt-1 space-y-1 text-[13px] text-white/70">
                {diagnostic.gaps.map((g) => (
                  <li key={g}>· {g}</li>
                ))}
              </ul>
            </div>
          </div>

          <h3 className="text-[14px] font-medium text-white/85">Five likely questions</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13px] text-white/65">
            {diagnostic.likely_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>

          <h3 className="mt-6 text-[14px] font-medium text-white/85">Answer preview</h3>
          <p className="mt-2 rounded-[16px] glass-inset p-4 text-[13px] leading-relaxed text-white/70">
            {diagnostic.answer_preview}
          </p>
          <p className="mt-2 text-[11px] text-white/30">{diagnostic.disclaimer}</p>

          <div className="mt-6 rounded-[16px] border border-[#20B8CD]/25 bg-[#20B8CD]/[0.06] p-4">
            <h3 className="flex items-center gap-2 text-[14px] font-medium text-white/90">
              <Zap className="h-4 w-4 text-[#20B8CD]" /> What paid Sprint unlocks
            </h3>
            <ul className="mt-2 space-y-1.5 text-[13px] text-white/60">
              {diagnostic.paid_unlocks.map((u) => (
                <li key={u} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#20B8CD]" />
                  {u}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" disabled={busy} onClick={() => void unlockWorkspace()}>
              {paidAccess ? 'Open Twin workspace' : 'See plans'}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setStep('setup')}>
              Edit opportunity
            </Button>
          </div>
        </section>
      )}

      {/* PAYWALL */}
      {step === 'paywall' && (
        <section className="glass rounded-[28px] p-6 md:p-8">
          <h2 className="text-[17px] font-medium text-white/95">Choose your prep plan</h2>
          <p className="mt-1 mb-6 text-[13px] text-white/40">
            Buy prep for this opportunity — prices come from the server catalog.
          </p>
          <div className="grid gap-4">
            {(products.length
              ? products
              : [
                  {
                    code: 'interview_pass',
                    name: 'Interview Pass',
                    description: '72 hours · 120 live minutes · one opportunity',
                    price_display: '$19',
                    price_cents: 1900,
                    billing_mode: 'payment',
                    features: [],
                    purchasable: true,
                    live_minutes: 120,
                    duration_hours: 72,
                    max_opportunities: 1,
                  },
                  {
                    code: 'interview_sprint',
                    name: 'Interview Sprint',
                    description: '14 days · 180 live minutes · unlimited mocks',
                    price_display: '$39',
                    price_cents: 3900,
                    billing_mode: 'payment',
                    features: [],
                    purchasable: true,
                    live_minutes: 180,
                    duration_hours: 336,
                    max_opportunities: 1,
                  },
                  {
                    code: 'pro_monthly',
                    name: 'Pro Monthly',
                    description: 'Multiple opportunities · fair-use live minutes',
                    price_display: '$59/mo',
                    price_cents: 5900,
                    billing_mode: 'subscription',
                    features: [],
                    purchasable: true,
                    live_minutes: 600,
                    duration_hours: null,
                    max_opportunities: 5,
                  },
                ]
            )
              .filter((p) => p.code !== 'free_diagnostic')
              .map((p) => (
                <div
                  key={p.code}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-medium text-white/95">{p.name}</h3>
                      <Badge tone="emerald">{p.price_display}</Badge>
                    </div>
                    <p className="mt-1 text-[12px] text-white/45">{p.description}</p>
                  </div>
                  <Button
                    disabled={busy || p.purchasable === false}
                    onClick={() => void checkout(p.code)}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buy'}
                  </Button>
                </div>
              ))}
          </div>
          <p className="mt-4 text-[11px] text-white/30">
            Access is granted by Stripe webhooks / session confirm — not by the browser alone.
          </p>
          <Button
            className="mt-4"
            variant="ghost"
            onClick={() => void refreshEntitlements().then(() => unlockWorkspace())}
          >
            I already paid — refresh access
          </Button>
        </section>
      )}

      {/* WORKSPACE */}
      {step === 'workspace' && opp && (
        <section className="glass rounded-[28px] p-6 md:p-8 space-y-6">
          <div>
            <h2 className="text-[17px] font-medium text-white/95">
              Twin workspace · {opp.role || role}
              {opp.company || company ? ` @ ${opp.company || company}` : ''}
            </h2>
            <p className="mt-1 text-[13px] text-white/40">
              Live minutes remaining:{' '}
              {liveMinutes < 0 ? 'unlimited' : liveMinutes}
            </p>
          </div>

          {dossier && (
            <div className="rounded-[16px] glass-inset p-4 text-[13px] text-white/65">
              <h3 className="mb-2 font-medium text-white/90">Company Twin dossier</h3>
              <p className="text-[12px] text-white/40">
                Sources: only your JD + resume. Unsupported skills are listed so you do not
                fabricate them.
              </p>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-white/50">
                {JSON.stringify(
                  {
                    role_requirements: (dossier as { role_requirements?: unknown })
                      .role_requirements,
                    resume_mapping: {
                      unsupported: (
                        (dossier as { resume_mapping?: { unsupported?: unknown[] } })
                          .resume_mapping?.unsupported || []
                      ).slice(0, 8),
                      supported_count: (
                        (dossier as { resume_mapping?: { supported?: unknown[] } })
                          .resume_mapping?.supported || []
                      ).length,
                    },
                    likely_themes: (dossier as { likely_themes?: unknown }).likely_themes,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          )}

          <div>
            <h3 className="text-[14px] font-medium text-white/90">Story Bank</h3>
            <p className="mt-1 text-[12px] text-white/40">
              Verify AI-extracted stories before live mode uses them.
            </p>
            <ul className="mt-3 space-y-2">
              {stories.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] glass-inset px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-white/85">{s.title}</div>
                    <div className="text-[11px] text-white/40">
                      {s.status} · confidence {s.confidence}%
                      {s.missing_details ? ` · ${s.missing_details}` : ''}
                    </div>
                  </div>
                  {s.status !== 'verified' && (
                    <Button size="sm" onClick={() => void verifyStory(s.id)}>
                      Approve
                    </Button>
                  )}
                  {s.status === 'verified' && (
                    <Badge tone="emerald">Verified</Badge>
                  )}
                </li>
              ))}
              {stories.length === 0 && (
                <p className="text-[13px] text-white/40">
                  No stories yet — generate dossier with a resume to extract drafts.
                </p>
              )}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" disabled={busy} onClick={() => void startTwinMock()}>
              Adaptive Twin mock
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={busy}
              onClick={() => void openLiveSprint()}
            >
              Live Sprint mode
            </Button>
            {!paidAccess && (
              <span className="flex items-center gap-1 text-[12px] text-white/40">
                <Lock className="h-3.5 w-3.5" /> Paid features require an active plan
              </span>
            )}
          </div>

          {followUpEmail && (
            <div className="rounded-[16px] glass-inset p-4">
              <h3 className="text-[14px] font-medium text-white/90">
                Follow-up email draft (editable — never auto-sent)
              </h3>
              <textarea
                className="field mt-2 min-h-[140px] resize-y text-[13px]"
                value={followUpEmail}
                onChange={(e) => setFollowUpEmail(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => {
                  void navigator.clipboard.writeText(followUpEmail)
                }}
              >
                Copy draft
              </Button>
            </div>
          )}

          <div className="border-t border-white/[0.06] pt-4">
            <h3 className="text-[14px] font-medium text-white/90">Growth & privacy</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void fetchReadinessReport()
                    .then((r) => {
                      setReadinessShare(r)
                      void trackSprintEvent('referral_shared')
                    })
                    .catch((e) => setError((e as Error).message))
                }}
              >
                <Share2 className="h-3.5 w-3.5" /> Shareable readiness
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void exportSprintAccount()
                    .then((data) => {
                      const blob = new Blob([JSON.stringify(data, null, 2)], {
                        type: 'application/json',
                      })
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(blob)
                      a.download = 'interviewpulse-export.json'
                      a.click()
                    })
                    .catch((e) => setError((e as Error).message))
                }}
              >
                Export my data
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (
                    !window.confirm(
                      'Delete all Sprint opportunities, stories, and debriefs for this account? This cannot be undone.',
                    )
                  )
                    return
                  void deleteSprintAccountData()
                    .then(() => {
                      setOpp(null)
                      setStories([])
                      setDossier(null)
                      setOpps([])
                      setStep('setup')
                    })
                    .catch((e) => setError((e as Error).message))
                }}
              >
                Delete Sprint data
              </Button>
            </div>
            {readinessShare && (
              <div className="mt-3 rounded-[14px] glass-inset p-4 text-[13px] text-white/70">
                <p className="font-medium text-white/90">{readinessShare.anonymous_badge}</p>
                <p className="mt-1 text-[12px] text-white/45">
                  Improvement +{readinessShare.improvement_points} pts · Score{' '}
                  {readinessShare.overall_readiness}/100
                </p>
                <p className="mt-2 break-all text-[11px] text-[#5DD5E3]">
                  {readinessShare.referral_link}
                </p>
                <p className="mt-2 text-[11px] text-white/30">{readinessShare.policy}</p>
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    void navigator.clipboard.writeText(readinessShare.referral_link)
                  }
                >
                  Copy referral link
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
