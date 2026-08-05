/**
 * Premium interview setup — Role, Context, Resume, JD required.
 * Blocks Start until complete; progressive disclosure for uploads.
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
  Circle,
  FileText,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const ICONS: Record<ReadyKey, typeof UserRound> = {
  role: UserRound,
  jobContext: Briefcase,
  resume: FileText,
  jd: FileText,
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

  const onFiles = useCallback(
    async (files: FileList | null, type: 'resume' | 'jd') => {
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

  return (
    <section
      className={cn(
        'ip-setup-card relative overflow-hidden rounded-[22px] border border-white/[0.08]',
        'bg-gradient-to-b from-white/[0.06] to-white/[0.02]',
        className,
      )}
      aria-labelledby="ip-setup-title"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5DD5E3]/50 to-transparent"
        aria-hidden
      />

      <div className={cn('p-5', compact && 'p-4')}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles
                className="h-4 w-4 text-[#5DD5E3]"
                strokeWidth={1.75}
                aria-hidden
              />
              <h2
                id="ip-setup-title"
                className="text-[15px] font-medium tracking-tight text-white/95"
              >
                Interview kit
              </h2>
            </div>
            <p className="text-[12px] leading-relaxed text-white/45">
              Four inputs. Then one tap to start — answers stay grounded in{' '}
              <em className="not-italic text-white/60">your</em> role and materials.
            </p>
          </div>
          <div
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums',
              readiness.ready
                ? 'bg-[#81c995]/15 text-[#81c995]'
                : 'bg-white/[0.06] text-white/50',
            )}
            aria-live="polite"
          >
            {readiness.completeCount}/{readiness.total}
          </div>
        </div>

        {/* Progress */}
        <div
          className="mb-5 h-1 overflow-hidden rounded-full bg-white/[0.06]"
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

        {/* Checklist */}
        <ul className="mb-4 space-y-2" aria-label="Required setup">
          {readiness.checks.map((c) => {
            const Icon = ICONS[c.key]
            return (
              <li
                key={c.key}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                  c.ok
                    ? 'border-[#81c995]/20 bg-[#81c995]/[0.06]'
                    : 'border-white/[0.06] bg-black/20',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    c.ok ? 'bg-[#81c995]/20 text-[#81c995]' : 'bg-white/[0.04] text-white/35',
                  )}
                  aria-hidden
                >
                  {c.ok ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  ) : (
                    <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-[13px] font-medium',
                      c.ok ? 'text-white/90' : 'text-white/75',
                    )}
                  >
                    {c.label}
                    <span className="sr-only">
                      {c.ok ? ', complete' : ', required'}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-white/35">{c.hint}</p>
                </div>
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    c.ok ? 'text-[#81c995]/70' : 'text-white/20',
                  )}
                  strokeWidth={1.5}
                  aria-hidden
                />
              </li>
            )
          })}
        </ul>

        {/* Fields */}
        <div className="space-y-3">
          <label className="block" id="ip-kit-role">
            <span className="ip-label">Job role</span>
            <input
              id="ip-field-role"
              className="ip-field mt-1.5"
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
          </label>
          <label className="block" id="ip-kit-jobContext">
            <span className="ip-label">Job context</span>
            <input
              id="ip-field-jobContext"
              className="ip-field mt-1.5"
              value={jobContext || ''}
              onChange={(e) => updateSettings({ jobContext: e.target.value })}
              placeholder="e.g. EPCIS, serialization, go-live hypercare"
              autoComplete="off"
              required
              aria-required
            />
          </label>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div id="ip-kit-resume">
              <span className="ip-label">Resume</span>
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
                className="ip-upload mt-1.5"
                disabled={busy === 'resume'}
                onClick={() => resumeInputRef.current?.click()}
                aria-label={
                  readiness.checks.find((c) => c.key === 'resume')?.ok
                    ? 'Replace resume'
                    : 'Upload resume'
                }
              >
                <Upload className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="min-w-0 truncate">
                  {busy === 'resume'
                    ? 'Uploading…'
                    : resumeName
                      ? resumeName
                      : 'Upload resume'}
                </span>
              </button>
            </div>
            <div id="ip-kit-jd">
              <span className="ip-label">Job description</span>
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
                className="ip-upload mt-1.5"
                disabled={busy === 'jd'}
                onClick={() => jdInputRef.current?.click()}
                aria-label={
                  readiness.checks.find((c) => c.key === 'jd')?.ok
                    ? 'Replace job description'
                    : 'Upload job description'
                }
              >
                <Upload className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="min-w-0 truncate">
                  {busy === 'jd' ? 'Uploading…' : jdName ? jdName : 'Upload JD'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
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
              Open full materials
            </button>
          </div>

          {showJdPaste && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <textarea
                className="ip-field min-h-[100px] resize-y py-2.5"
                value={jdPaste}
                onChange={(e) => setJdPaste(e.target.value)}
                placeholder="Paste the full job description here…"
                aria-label="Paste job description"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={saveJdPaste}
                disabled={jdPaste.trim().length < 40}
              >
                Save JD
              </Button>
            </div>
          )}
        </div>

        {error && (
          <p
            className="mt-3 rounded-lg border border-[#f28b82]/25 bg-[#f28b82]/10 px-3 py-2 text-[12px] text-[#f28b82]"
            role="alert"
          >
            {error}
          </p>
        )}

        <p
          className={cn(
            'mt-4 text-[12px] font-medium',
            readiness.ready ? 'text-[#81c995]' : 'text-white/40',
          )}
          aria-live="polite"
        >
          {readinessSummary(readiness)}
        </p>
      </div>
    </section>
  )
}
