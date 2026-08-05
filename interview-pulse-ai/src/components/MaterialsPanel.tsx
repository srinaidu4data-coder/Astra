import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  isAllowedKnowledgeFile,
  parseUploadedFile,
  rankMemories,
  vectorizeToMemories,
} from '@/services/parser'
import { setSessionContext } from '@/services/real-api'
import { useAppStore } from '@/stores/app-store'
import type { JobMatch, KnowledgeDocType } from '@/types'
import { uid } from '@/lib/utils'
import {
  BookOpen,
  Briefcase,
  ChevronDown,
  FileText,
  Link2,
  StickyNote,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { useMemo, useState } from 'react'

const DOC_LABELS: Record<KnowledgeDocType, string> = {
  resume: 'Resume',
  job: 'Job description',
  notes: 'Notes',
  reference: 'Subject / reference',
}

const DOC_TONE: Record<KnowledgeDocType, 'emerald' | 'indigo' | 'default' | 'amber'> = {
  resume: 'emerald',
  job: 'indigo',
  notes: 'default',
  reference: 'amber',
}

/**
 * Unified materials / knowledge UI (resume, JD, notes, STAR match).
 * Used inside Interview so users never leave the main flow.
 */
export function MaterialsPanel({
  defaultOpen = false,
  embedded = true,
}: {
  defaultOpen?: boolean
  /** When true, renders as collapsible card inside Interview */
  embedded?: boolean
}) {
  const materialsOpen = useAppStore((s) => s.materialsOpen)
  const setMaterialsOpen = useAppStore((s) => s.setMaterialsOpen)
  const {
    documents,
    addDocument,
    removeDocument,
    memories,
    addMemories,
    clearKnowledgeContext,
    jobMatch,
    setJobMatch,
    activeJobTitle,
    setActiveJobTitle,
  } = useAppStore()

  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const open = embedded ? materialsOpen || localOpen : true
  const setOpen = (v: boolean) => {
    setLocalOpen(v)
    setMaterialsOpen(v)
  }

  const [jdText, setJdText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [dropType, setDropType] = useState<KnowledgeDocType>('reference')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastOk, setLastOk] = useState<string | null>(null)

  const clearAllKnowledge = () => {
    if (
      !window.confirm(
        'Clear all materials, STAR memory chunks, job match, and server interview pack?\n\nThis does not delete your account. New logins also clear automatically.',
      )
    ) {
      return
    }
    clearKnowledgeContext()
    setJdText('')
    setLastOk('Materials & STAR memories cleared for this login.')
    setError(null)
  }

  const starTree = useMemo(() => memories.slice(0, 36), [memories])
  const userMemories = useMemo(
    () => memories.filter((m) => Boolean(m.sourceFile)).length,
    [memories],
  )

  const handleFiles = async (files: FileList | File[], type: KnowledgeDocType) => {
    setBusy(true)
    setError(null)
    setLastOk(null)
    try {
      const list = Array.from(files)
      if (!list.length) return

      let added = 0
      for (const file of list) {
        if (!isAllowedKnowledgeFile(file)) {
          setError(`Skipped ${file.name} — use PDF, DOCX, MD, or TXT`)
          continue
        }
        const doc = await parseUploadedFile(file, type)
        addDocument(doc)
        if (type === 'resume' || type === 'notes' || type === 'reference') {
          const mems = vectorizeToMemories(doc)
          if (mems.length) addMemories(mems)
        }
        if (type === 'job') {
          setJdText(doc.text.slice(0, 4000))
          setActiveJobTitle(file.name.replace(/\.[^.]+$/, ''))
          void setSessionContext({
            job_description: doc.text.slice(0, 4000),
            role: file.name.replace(/\.[^.]+$/, ''),
          })
        }
        if (type === 'resume') {
          void setSessionContext({
            resume_text: doc.text.slice(0, 3500),
          })
        }
        if (type === 'notes' || type === 'reference') {
          void setSessionContext({
            stories: [doc.text.slice(0, 800)],
            keywords: doc.text
              .split(/\W+/)
              .filter((w) => w.length > 4)
              .slice(0, 20),
          })
        }
        added += 1
      }
      if (added > 0) {
        setLastOk(
          `Added ${added} file${added > 1 ? 's' : ''} as ${DOC_LABELS[type]}. ` +
            (type === 'job'
              ? 'JD sent to live answers — paste/edit below and press Match if needed.'
              : type === 'resume'
                ? 'Resume sent to live answer context.'
                : 'Knowledge chunks ready; notes pushed to live session pack.'),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setBusy(false)
    }
  }

  const runMatch = () => {
    const text = jdText.trim()
    if (!text) return
    const matched = rankMemories(text, memories, 8)
    const match: JobMatch = {
      jobId: uid('job'),
      title: activeJobTitle || 'Target role',
      description: text,
      matchedMemories: matched,
      matchScore: Math.round(
        (matched.reduce((a, m) => a + (m.score ?? 0), 0) / Math.max(1, matched.length)) *
          100,
      ),
    }
    setJobMatch(match)
    void setSessionContext({
      role: (activeJobTitle || '').trim() || undefined,
      job_description: text.slice(0, 4000),
      keywords: matched
        .flatMap((m) => (m.action || '').split(/\W+/).filter((w) => w.length > 4))
        .slice(0, 24),
    })
  }

  const hasContext =
    documents.length > 0 ||
    memories.length > 0 ||
    Boolean(jdText.trim()) ||
    Boolean(activeJobTitle.trim()) ||
    Boolean(jobMatch)

  const summary = hasContext
    ? `${documents.length} file${documents.length === 1 ? '' : 's'} · ${memories.length} memory chunk${memories.length === 1 ? '' : 's'}`
    : 'Add resume or JD so answers sound like you'

  const body = (
    <div className={embedded ? 'space-y-5 pt-1' : 'space-y-8'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-white/40">{summary}</p>
        <Button
          type="button"
          variant="danger"
          size="sm"
          title="Remove all uploads, STAR memory chunks, job match, and server pack for this login"
          onClick={clearAllKnowledge}
          disabled={!hasContext && !busy}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          Clear all
        </Button>
      </div>
      {lastOk && (
        <p className="text-[13px] text-[#81c995]" role="status">
          {lastOk}
        </p>
      )}

      {/* Upload */}
      <div>
        <h3 className="text-[14px] font-medium tracking-tight text-white/90">Upload</h3>
        <p className="mt-1 mb-3 text-[12px] leading-relaxed text-white/35">
          Resume, job descriptions, and subject PDFs. Stays on this device for this login only.
        </p>

        <div className="mb-3">
          <span className="label-quiet">Drop zone type</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ['reference', 'Subject PDF'],
                ['notes', 'Notes'],
                ['resume', 'Resume'],
                ['job', 'JD file'],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={dropType === id ? 'default' : 'secondary'}
                onClick={() => setDropType(id)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            void handleFiles(e.dataTransfer.files, dropType)
          }}
          className={`flex flex-col items-center justify-center rounded-[20px] px-4 py-8 text-center transition-colors ${
            dragOver ? 'bg-[#20B8CD]/12 ring-1 ring-[#20B8CD]/35' : 'glass-inset'
          }`}
        >
          <UploadCloud className="mb-3 h-7 w-7 text-white/35" strokeWidth={1.5} />
          <p className="text-[14px] text-white/80">Drop files here</p>
          <p className="mt-1 text-[12px] text-white/35">
            PDF, DOCX, MD, TXT · as{' '}
            <span className="text-white/60">{DOC_LABELS[dropType]}</span>
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <FileButton
              label="Resume"
              icon={<FileText className="h-4 w-4" strokeWidth={1.75} />}
              primary
              onFiles={(f) => void handleFiles(f, 'resume')}
            />
            <FileButton
              label="Subject PDF"
              icon={<BookOpen className="h-4 w-4" strokeWidth={1.75} />}
              onFiles={(f) => void handleFiles(f, 'reference')}
              multiple
            />
            <FileButton
              label="Notes"
              icon={<StickyNote className="h-4 w-4" strokeWidth={1.75} />}
              onFiles={(f) => void handleFiles(f, 'notes')}
              multiple
            />
            <FileButton
              label="Job description"
              icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
              onFiles={(f) => void handleFiles(f, 'job')}
            />
          </div>
          {busy && <p className="mt-3 text-[12px] text-[#5DD5E3]">Parsing…</p>}
          {error && <p className="mt-3 text-[12px] text-[#E85D5D]">{error}</p>}
          {lastOk && !error && (
            <p className="mt-3 max-w-md text-[12px] leading-relaxed text-[#5DD5E3]">{lastOk}</p>
          )}
        </div>

        <ul className="mt-4 space-y-1 text-[11px] leading-relaxed text-white/30">
          <li>
            <strong className="text-white/45">Subject PDF</strong> — domain material (system design,
            notes, etc.)
          </li>
          <li>
            <strong className="text-white/45">Notes</strong> — cheat sheets, talking points, Q&A banks
          </li>
          <li>
            <strong className="text-white/45">Resume</strong> — experience → STAR-style memories
          </li>
          <li>Scanned image-only PDFs may not extract text</li>
        </ul>
      </div>

      {/* Documents */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-medium tracking-tight text-white/90">Documents</h3>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-white/35">{documents.length}</span>
            {documents.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="danger"
                title="Clear all documents and STAR chunks"
                onClick={clearAllKnowledge}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {documents.length === 0 && (
            <p className="py-3 text-[13px] text-white/35">
              No uploads yet — answers stay generic until you add files.
            </p>
          )}
          {documents.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-[16px] glass-inset px-3.5 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] text-white/90">{d.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
                  <Badge tone={DOC_TONE[d.type]}>{DOC_LABELS[d.type]}</Badge>
                  <span>{(d.sizeBytes / 1024).toFixed(1)} KB</span>
                  <span>· {d.text.length.toLocaleString()} chars</span>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => removeDocument(d.id)}>
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Job match */}
      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-medium tracking-tight text-white/90">Job match</h3>
            <p className="mt-0.5 text-[12px] text-white/35">
              Rank resume + materials against the JD
            </p>
          </div>
          <Button onClick={runMatch} size="sm">
            <Link2 className="h-4 w-4" strokeWidth={1.75} /> Match
          </Button>
        </div>
        <input
          className="field mb-3"
          value={activeJobTitle}
          onChange={(e) => setActiveJobTitle(e.target.value)}
          placeholder="Optional — type the target role"
          autoComplete="off"
        />
        <textarea
          className="field min-h-[110px] resize-y"
          placeholder="Paste job description…"
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
        />
        {jobMatch && (
          <div className="mt-4 rounded-[16px] glass-inset p-4">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="emerald">{jobMatch.matchScore}%</Badge>
              <span className="text-[13px] text-white/80">{jobMatch.title}</span>
            </div>
            <div className="space-y-1.5">
              {jobMatch.matchedMemories.map((m) => (
                <div key={m.id} className="text-[12px] leading-relaxed text-white/45">
                  <span className="text-[#20B8CD]">
                    {Math.round((m.score ?? 0) * 100)}%
                  </span>{' '}
                  — {m.action.slice(0, 120)}…
                  {m.sourceFile && (
                    <span className="ml-1 text-white/25">({m.sourceFile})</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* STAR memories */}
      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-medium tracking-tight text-white/90">
              STAR memories
            </h3>
            <p className="mt-0.5 text-[12px] text-white/35">
              {memories.length} chunks · {userMemories} from your uploads
              {memories.length > 0 ? ' · cleared on new login' : ''}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="danger"
            title="Remove all uploads and STAR memory chunks from this login"
            onClick={clearAllKnowledge}
            disabled={memories.length === 0 && documents.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Clear STAR
          </Button>
        </div>
        {starTree.length === 0 ? (
          <p className="py-4 text-[13px] text-white/35">
            No memory chunks yet. Upload a resume or notes — they never carry to another account.
          </p>
        ) : (
          <div className="grid max-h-[320px] gap-3 overflow-auto md:grid-cols-2">
            {starTree.map((m) => (
              <div key={m.id} className="rounded-[16px] glass-inset p-4">
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {m.tags.slice(0, 4).map((t) => (
                    <Badge key={t} tone="indigo">
                      {t}
                    </Badge>
                  ))}
                  {m.sourceFile && (
                    <Badge tone="default">{m.sourceFile.slice(0, 18)}</Badge>
                  )}
                </div>
                <StarLine label="S" text={m.situation} />
                <StarLine label="T" text={m.task} />
                <StarLine label="A" text={m.action} />
                <StarLine label="R" text={m.result} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (!embedded) {
    return (
      <div className="glass rounded-[28px] p-6 md:p-8">
        <h2 className="text-[17px] font-medium tracking-tight text-white/95">Materials</h2>
        <p className="mt-1 mb-6 text-[13px] text-white/40">
          Everything answers use for this login
        </p>
        {body}
      </div>
    )
  }

  return (
    <section className="glass rounded-[22px] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium tracking-tight text-white/95">Materials</span>
            {hasContext && (
              <span className="rounded-full bg-[#20B8CD]/15 px-2 py-0.5 text-[11px] text-[#5DD5E3]">
                {documents.length || memories.length}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-white/40">{summary}</p>
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-white/40 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          strokeWidth={1.75}
        />
      </button>
      {open && <div className="border-t border-white/[0.06] px-5 pb-5">{body}</div>}
    </section>
  )
}

function FileButton({
  label,
  icon,
  onFiles,
  primary,
  multiple,
}: {
  label: string
  icon: React.ReactNode
  onFiles: (files: FileList) => void
  primary?: boolean
  multiple?: boolean
}) {
  return (
    <label>
      <input
        type="file"
        accept=".pdf,.docx,.md,.txt,.markdown"
        multiple={multiple}
        className="hidden"
        onChange={(e) => e.target.files && onFiles(e.target.files)}
      />
      <span
        className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2 text-[12px] font-light ${
          primary ? 'bg-[#20B8CD] text-white' : 'glass-soft text-white/85'
        }`}
      >
        {icon}
        {label}
      </span>
    </label>
  )
}

function StarLine({ label, text }: { label: string; text: string }) {
  return (
    <p className="mt-1.5 text-[12px] leading-relaxed text-white/65">
      <span className="mr-2 font-light text-white/35">{label}</span>
      {text}
    </p>
  )
}
