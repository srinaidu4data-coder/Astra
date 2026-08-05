/**
 * Interview kit — four required inputs as one progressive surface.
 * Each step is the control (no checklist + form duplication).
 */
import { Button } from '@/components/ui/button'
import {
  getInterviewReadiness,
  readinessSummary,
  type ReadyKey,
} from '@/lib/interview-ready'
import { cn, uid } from '@/lib/utils'
import {
  isAllowedKnowledgeFile,
  parseUploadedFile,
  vectorizeToMemories,
} from '@/services/parser'
import { setSessionContext } from '@/services/real-api'
import { useAppStore } from '@/stores/app-store'
import type { KnowledgeDocType } from '@/types'
import {
  Briefcase,
  Check,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'

const STEP_META: Record<
  ReadyKey,
  { Icon: typeof UserRound; label: string; step: number }
> = {
  role: { Icon: UserRound, label: 'Job role', step: 1 },
  jobContext: { Icon: Briefcase, label: 'Job context', step: 2 },
  resume: { Icon: FileText, label: 'Resume', step: 3 },
  jd: { Icon: FileText, label: 'Job description', step: 4 },
}

export function InterviewSetupCard({
  className,
  compact,
  onReadyChange,
}: {
  className?: string
  compact?: boolean
  onReadyChange?: (ready: boolean) => void
}) {
  const activeJobTitle = useAppStore((s) => s.activeJobTitle)
  const setActiveJobTitle = useAppStore((s) => s.setActiveJobTitle)
  const jobContext = useAppStore((s) => s.settings.jobContext)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const documents = useAppStore((s) => s.documents)
  const addDocument = useAppStore((s) => s.addDocument)
  const addMemories = useAppStore((s) => s.addMemories)
  const setMaterialsOpen = useAppStore((s) => s.setMaterialsOpen)

  const [busy, setBusy] = useState<null | 'resume' | 'jd'>(null)
  const [error, setError] = useState<string | null>(null)
  const [jdPaste, setJdPaste] = useState('')
  const [showJdPaste, setShowJdPaste] = useState(false)
  const [dragOver, setDragOver] = useState<null | 'resume' | 'jd'>(null)
  const [justReady, setJustReady] = useState(false)
  const wasReady = useRef(false)
  const resumeInputRef = useRef<HTMLInputElement>(null)
  const jdInputRef = useRef<HTMLInputElement>(null)

  const readiness = useMemo(
    () =>
      getInterviewReadiness({
        role: activeJobTitle,
        jobContext: jobContext || '',
        documents,
      }),
    [activeJobTitle, jobContext, documents],
  )

  useEffect(() => {
    onReadyChange?.(readiness.ready)
  }, [readiness.ready, onReadyChange])

  // Celebrate first time kit becomes complete
  useEffect(() => {
    if (readiness.ready && !wasReady.current) {
      setJustReady(true)
      const t = window.setTimeout(() => setJustReady(false), 2400)
      wasReady.current = true
      return () => window.clearTimeout(t)
    }
    if (!readiness.ready) wasReady.current = false
  }, [readiness.ready])

  const onFiles = useCallback(
    async (files: FileList | File[] | null, type: 'resume' | 'jd') => {
      if (!files?.length) return
      setBusy(type)
      setError(null)
      try {
        const docType: KnowledgeDocType = type === 'resume' ? 'resume' : 'job'
        const file = files[0]!
        if (!isAllowedKnowledgeFile(file)) {
          setError('Use PDF, DOCX, MD, or TXT')
          return
        }
        const doc = await parseUploadedFile(file, docType)
        addDocument(doc)
        if (docType === 'resume') {
          const mems = vectorizeToMemories(doc)
          if (mems.length) addMemories(mems)
          void setSessionContext({ resume_text: doc.text.slice(0, 3500) })
        } else {
          void setSessionContext({
            job_description: doc.text.slice(0, 4000),
            role: (activeJobTitle || '').trim() || undefined,
          })
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed')
      } finally {
        setBusy(null)
        setDragOver(null)
      }
    },
    [activeJobTitle, addDocument, addMemories],
  )

  const saveJdPaste = () => {
    const text = jdPaste.trim()
    if (text.length < 40) {
      setError('Paste a fuller job description (at least a few lines)')
      return
    }
    setError(null)
    addDocument({
      id: uid('jd'),
      name: 'Pasted job description',
      type: 'job',
      text,
      uploadedAt: new Date().toISOString(),
      sizeBytes: text.length,
    })
    void setSessionContext({
      job_description: text.slice(0, 4000),
      role: (activeJobTitle || '').trim() || undefined,
    })
    setShowJdPaste(false)
    setJdPaste('')
  }

  const progress = readiness.total
    ? Math.round((readiness.completeCount / readiness.total) * 100)
    : 0

  const resumeName = documents.find(
    (d) => d.type === 'resume' && (d.text || '').trim().length >= 40,
  )?.name
  const jdName = documents.find(
    (d) => d.type === 'job' && (d.text || '').trim().length >= 40,
  )?.name

  const firstMissing = readiness.missing[0]?.key

  const onDrop = (e: DragEvent, type: 'resume' | 'jd') => {
    e.preventDefault()
    e.stopPropagation()
    void onFiles(e.dataTransfer.files, type)
  }

  const onDragOver = (e: DragEvent, type: 'resume' | 'jd') => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(type)
  }

  const stepClass = (key: ReadyKey, ok: boolean) =>
    cn(
      'ip-kit-step group relative rounded-2xl border px-3.5 py-3 transition-[border-color,background,box-shadow] duration-200',
      ok
        ? 'border-[#81c995]/25 bg-[#81c995]/[0.06]'
        : firstMissing === key
          ? 'border-[#5DD5E3]/35 bg-[#20B8CD]/[0.06] shadow-[0_0_0_1px_rgba(32,184,205,0.12)]'
          : 'border-white/[0.07] bg-black/25',
    )

  return (
    <section
      className={cn(
        'ip-setup-card relative overflow-hidden rounded-[22px] border border-white/[0.08]',
        'bg-gradient-to-b from-white/[0.055] to-white/[0.015]',
        readiness.ready && 'ip-setup-ready',
        justReady && 'ip-setup-celebrate',
        className,
      )}
      aria-labelledby="ip-setup-title"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5DD5E3]/55 to-transparent"
        aria-hidden
      />

      <div className={cn('p-5', compact && 'p-4')}>
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full',
                  readiness.ready
                    ? 'bg-[#81c995]/18 text-[#81c995]'
                    : 'bg-[#20B8CD]/12 text-[#5DD5E3]',
                )}
                aria-hidden
              >
                {readiness.ready ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </span>
              <h2
                id="ip-setup-title"
                className="text-[15px] font-medium tracking-tight text-white/95"
              >
                {readiness.ready ? 'Kit complete' : 'Interview kit'}
              </h2>
            </div>
            <p className="text-[12px] leading-relaxed text-white/45 pl-9">
              {readiness.ready
                ? 'Role, context, resume, and JD are locked in. Start when you’re ready.'
                : 'Four essentials. Ground every answer in your materials — then one tap to go live.'}
            </p>
          </div>
          <div
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums ring-1',
              readiness.ready
                ? 'bg-[#81c995]/15 text-[#81c995] ring-[#81c995]/25'
                : 'bg-white/[0.05] text-white/50 ring-white/[0.08]',
            )}
            aria-live="polite"
          >
            {readiness.completeCount}/{readiness.total}
          </div>
        </header>

        {/* Progress */}
        <div
          className="mb-4 h-1 overflow-hidden rounded-full bg-white/[0.06]"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#20B8CD] to-[#5DD5E3] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Unified steps */}
        <ol className="space-y-2.5" aria-label="Interview kit steps">
          {/* 1 Role */}
          <li id="ip-kit-role" className={stepClass('role', readiness.checks[0]!.ok)}>
            <StepHead
              meta={STEP_META.role}
              ok={readiness.checks[0]!.ok}
              hint={readiness.checks[0]!.hint}
            />
            <input
              id="ip-field-role"
              className="ip-field mt-2.5"
              value={activeJobTitle}
              onChange={(e) => setActiveJobTitle(e.target.value)}
              placeholder="e.g. SAP ATTP Architect"
              autoComplete="organization-title"
              required
              aria-required
              aria-invalid={
                activeJobTitle.trim().length > 0 &&
                activeJobTitle.trim().length < 2
              }
            />
          </li>

          {/* 2 Context */}
          <li
            id="ip-kit-jobContext"
            className={stepClass('jobContext', readiness.checks[1]!.ok)}
          >
            <StepHead
              meta={STEP_META.jobContext}
              ok={readiness.checks[1]!.ok}
              hint={readiness.checks[1]!.hint}
            />
            <input
              id="ip-field-jobContext"
              className="ip-field mt-2.5"
              value={jobContext || ''}
              onChange={(e) => updateSettings({ jobContext: e.target.value })}
              placeholder="e.g. EPCIS, serialization, go-live hypercare"
              autoComplete="off"
              required
              aria-required
            />
          </li>

          {/* 3 Resume */}
          <li
            id="ip-kit-resume"
            className={stepClass('resume', readiness.checks[2]!.ok)}
            onDragOver={(e) => onDragOver(e, 'resume')}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop(e, 'resume')}
          >
            <StepHead
              meta={STEP_META.resume}
              ok={readiness.checks[2]!.ok}
              hint={resumeName || readiness.checks[2]!.hint}
            />
            <input
              ref={resumeInputRef}
              id="ip-field-resume"
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,application/pdf"
              className="sr-only"
              onChange={(e) => {
                void onFiles(e.target.files, 'resume')
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={cn(
                'ip-upload mt-2.5',
                dragOver === 'resume' && 'ip-upload-drag',
                readiness.checks[2]!.ok && 'ip-upload-done',
              )}
              disabled={busy === 'resume'}
              onClick={() => resumeInputRef.current?.click()}
              aria-label={resumeName ? 'Replace resume' : 'Upload resume'}
            >
              {busy === 'resume' ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-80" />
              ) : readiness.checks[2]!.ok ? (
                <Check className="h-4 w-4 shrink-0 text-[#81c995]" strokeWidth={2.25} />
              ) : (
                <Upload className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
              )}
              <span className="min-w-0 truncate">
                {busy === 'resume'
                  ? 'Uploading…'
                  : resumeName
                    ? resumeName
                    : dragOver === 'resume'
                      ? 'Drop to upload'
                      : 'Drop or upload resume'}
              </span>
            </button>
          </li>

          {/* 4 JD */}
          <li
            id="ip-kit-jd"
            className={stepClass('jd', readiness.checks[3]!.ok)}
            onDragOver={(e) => onDragOver(e, 'jd')}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop(e, 'jd')}
          >
            <StepHead
              meta={STEP_META.jd}
              ok={readiness.checks[3]!.ok}
              hint={jdName || readiness.checks[3]!.hint}
            />
            <input
              ref={jdInputRef}
              id="ip-field-jd"
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,application/pdf"
              className="sr-only"
              onChange={(e) => {
                void onFiles(e.target.files, 'jd')
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={cn(
                'ip-upload mt-2.5',
                dragOver === 'jd' && 'ip-upload-drag',
                readiness.checks[3]!.ok && 'ip-upload-done',
              )}
              disabled={busy === 'jd'}
              onClick={() => jdInputRef.current?.click()}
              aria-label={jdName ? 'Replace job description' : 'Upload job description'}
            >
              {busy === 'jd' ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-80" />
              ) : readiness.checks[3]!.ok ? (
                <Check className="h-4 w-4 shrink-0 text-[#81c995]" strokeWidth={2.25} />
              ) : (
                <Upload className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
              )}
              <span className="min-w-0 truncate">
                {busy === 'jd'
                  ? 'Uploading…'
                  : jdName
                    ? jdName
                    : dragOver === 'jd'
                      ? 'Drop to upload'
                      : 'Drop or upload JD'}
              </span>
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                className="text-[12px] font-medium text-[#5DD5E3]/90 hover:text-[#7eeef8] underline-offset-2 hover:underline"
                onClick={() => setShowJdPaste((v) => !v)}
              >
                {showJdPaste ? 'Hide paste' : 'Paste JD instead'}
              </button>
              <span className="text-white/15" aria-hidden>
                ·
              </span>
              <button
                type="button"
                className="text-[12px] text-white/40 hover:text-white/65"
                onClick={() => setMaterialsOpen(true)}
              >
                Full materials
              </button>
            </div>
            {showJdPaste && (
              <div className="mt-2.5 space-y-2">
                <textarea
                  className="ip-field min-h-[104px] resize-y py-2.5"
                  value={jdPaste}
                  onChange={(e) => setJdPaste(e.target.value)}
                  placeholder="Paste the full job description…"
                  aria-label="Paste job description"
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={saveJdPaste}
                    disabled={jdPaste.trim().length < 40}
                  >
                    Save JD
                  </Button>
                  <span className="text-[11px] text-white/30">
                    {jdPaste.trim().length < 40
                      ? `${Math.max(0, 40 - jdPaste.trim().length)} more chars`
                      : 'Ready to save'}
                  </span>
                </div>
              </div>
            )}
          </li>
        </ol>

        {error && (
          <p
            className="mt-3 rounded-xl border border-[#f28b82]/25 bg-[#f28b82]/10 px-3 py-2 text-[12px] text-[#f28b82]"
            role="alert"
          >
            {error}
          </p>
        )}

        <p
          className={cn(
            'mt-4 text-[12px] font-medium transition-colors duration-300',
            readiness.ready ? 'text-[#81c995]' : 'text-white/40',
          )}
          aria-live="polite"
        >
          {justReady ? 'You’re ready — hit Start interview' : readinessSummary(readiness)}
        </p>
      </div>
    </section>
  )
}

function StepHead({
  meta,
  ok,
  hint,
}: {
  meta: (typeof STEP_META)[ReadyKey]
  ok: boolean
  hint: string
}) {
  const { Icon, label, step } = meta
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
          ok
            ? 'bg-[#81c995]/20 text-[#81c995]'
            : 'bg-white/[0.06] text-white/45',
        )}
        aria-hidden
      >
        {ok ? <Check className="h-3 w-3" strokeWidth={2.5} /> : step}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-white/90">
          {label}
          <span className="sr-only">{ok ? ', complete' : ', required'}</span>
        </p>
        <p className="truncate text-[11px] text-white/35">{hint}</p>
      </div>
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          ok ? 'text-[#81c995]/75' : 'text-white/20',
        )}
        strokeWidth={1.5}
        aria-hidden
      />
    </div>
  )
}
