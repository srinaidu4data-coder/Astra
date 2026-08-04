import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  isAllowedKnowledgeFile,
  parseUploadedFile,
  rankMemories,
  vectorizeToMemories,
} from '@/services/parser'
import { useAppStore } from '@/stores/app-store'
import type { JobMatch, KnowledgeDocType } from '@/types'
import { uid } from '@/lib/utils'
import { BookOpen, Briefcase, FileText, Link2, StickyNote, Trash2, UploadCloud } from 'lucide-react'
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

export function KnowledgePage() {
  const {
    documents,
    addDocument,
    removeDocument,
    memories,
    addMemories,
    jobMatch,
    setJobMatch,
    activeJobTitle,
    setActiveJobTitle,
  } = useAppStore()

  const [jdText, setJdText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [dropType, setDropType] = useState<KnowledgeDocType>('reference')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastOk, setLastOk] = useState<string | null>(null)

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
        }
        added += 1
      }
      if (added > 0) {
        setLastOk(
          `Added ${added} file${added > 1 ? 's' : ''} as ${DOC_LABELS[type]}. ` +
            (type === 'job'
              ? 'Paste/edit the JD below and press Match.'
              : 'Knowledge chunks are ready for retrieval.'),
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
  }

  return (
    <div className="grid gap-10 xl:grid-cols-12 xl:gap-12">
      <div className="flex flex-col gap-8 xl:col-span-5">
        <section className="glass rounded-[28px] p-8 md:p-10">
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">Upload</h2>
          <p className="mt-1 mb-6 text-[13px] leading-relaxed text-white/40">
            Resume, job descriptions, and subject PDFs (SAP FICO, study notes, project docs,
            cheatsheets). Files stay in this browser.
          </p>

          <div className="mb-4">
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
            className={`flex flex-col items-center justify-center rounded-[24px] px-6 py-12 text-center transition-colors ${
              dragOver ? 'bg-[#20B8CD]/12 ring-1 ring-[#20B8CD]/35' : 'glass-inset'
            }`}
          >
            <UploadCloud className="mb-4 h-8 w-8 text-white/35" strokeWidth={1.5} />
            <p className="text-[15px] text-white/80">Drop files here</p>
            <p className="mt-1 text-[13px] text-white/35">
              PDF, DOCX, MD, TXT · as <span className="text-white/60">{DOC_LABELS[dropType]}</span>
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
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
            {busy && <p className="mt-4 text-[12px] text-[#5DD5E3]">Parsing…</p>}
            {error && <p className="mt-4 text-[12px] text-[#E85D5D]">{error}</p>}
            {lastOk && !error && (
              <p className="mt-4 max-w-md text-[12px] leading-relaxed text-[#5DD5E3]">{lastOk}</p>
            )}
          </div>

          <ul className="mt-6 space-y-1.5 text-[12px] leading-relaxed text-white/35">
            <li>
              <strong className="text-white/50">Subject PDF</strong> — domain material (SAP FICO,
              Vertex, system design notes, etc.)
            </li>
            <li>
              <strong className="text-white/50">Notes</strong> — cheat sheets, talking points, Q&A
              banks
            </li>
            <li>
              <strong className="text-white/50">Resume</strong> — experience → STAR-style memories
            </li>
            <li>Scanned image-only PDFs may not extract text</li>
          </ul>
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-[17px] font-medium tracking-tight text-white/95">Documents</h2>
            <span className="text-[12px] text-white/35">{documents.length}</span>
          </div>
          <div className="space-y-3">
            {documents.length === 0 && (
              <p className="py-6 text-[14px] text-white/35">
                No uploads yet — demo memories are active until you add files.
              </p>
            )}
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-[18px] glass-inset px-4 py-3.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-white/90">{d.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-white/35">
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
        </section>
      </div>

      <div className="flex flex-col gap-8 xl:col-span-7">
        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">Job match</h2>
              <p className="mt-1 text-[13px] text-white/40">
                Rank your resume + subject knowledge against the JD
              </p>
            </div>
            <Button onClick={runMatch}>
              <Link2 className="h-4 w-4" strokeWidth={1.75} /> Match
            </Button>
          </div>
          <input
            className="field mb-4"
            value={activeJobTitle}
            onChange={(e) => setActiveJobTitle(e.target.value)}
            placeholder="Optional — type the target role"
            autoComplete="off"
          />
          <textarea
            className="field min-h-[140px] resize-y"
            placeholder="Paste job description…"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
          />
          {jobMatch && (
            <div className="mt-6 rounded-[20px] glass-inset p-5">
              <div className="mb-3 flex items-center gap-2">
                <Badge tone="emerald">{jobMatch.matchScore}%</Badge>
                <span className="text-[14px] text-white/80">{jobMatch.title}</span>
              </div>
              <div className="space-y-2">
                {jobMatch.matchedMemories.map((m) => (
                  <div key={m.id} className="text-[13px] leading-relaxed text-white/45">
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
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-8">
            <h2 className="text-[17px] font-medium tracking-tight text-white/95">
              Knowledge & STAR memories
            </h2>
            <p className="mt-1 text-[13px] text-white/40">
              {memories.length} chunks · {userMemories} from your uploads
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {starTree.map((m) => (
              <div key={m.id} className="rounded-[22px] glass-inset p-5">
                <div className="mb-4 flex flex-wrap gap-1.5">
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
        </section>
      </div>
    </div>
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
        className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-light ${
          primary
            ? 'bg-[#20B8CD] text-white'
            : 'glass-soft text-white/85'
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
    <p className="mt-2 text-[13px] leading-relaxed text-white/65">
      <span className="mr-2 font-light text-white/35">{label}</span>
      {text}
    </p>
  )
}
