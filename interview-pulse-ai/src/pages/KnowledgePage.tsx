import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { parseUploadedFile, rankMemories, vectorizeToMemories } from '@/services/parser'
import { useAppStore } from '@/stores/app-store'
import type { JobMatch } from '@/types'
import { uid } from '@/lib/utils'
import { FileText, Link2, Trash2, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const starTree = useMemo(() => memories.slice(0, 24), [memories])

  const handleFiles = async (files: FileList | File[], type: 'resume' | 'job' | 'notes') => {
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const doc = await parseUploadedFile(file, type)
        addDocument(doc)
        if (type === 'resume' || type === 'notes') {
          addMemories(vectorizeToMemories(doc))
        }
        if (type === 'job') {
          setJdText(doc.text.slice(0, 4000))
          setActiveJobTitle(file.name.replace(/\.[^.]+$/, ''))
        }
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
    const matched = rankMemories(text, memories, 5)
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
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">
            Upload
          </h2>
          <p className="mt-1 mb-8 text-[13px] text-white/40">
            Resume, notes, and job descriptions
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void handleFiles(e.dataTransfer.files, 'resume')
            }}
            className={`flex flex-col items-center justify-center rounded-[24px] px-6 py-14 text-center transition-colors ${
              dragOver
                ? 'bg-[#20B8CD]/12 ring-1 ring-[#20B8CD]/35'
                : 'glass-inset'
            }`}
          >
            <UploadCloud className="mb-4 h-8 w-8 text-white/35" strokeWidth={1.5} />
            <p className="text-[15px] text-white/80">Drop files here</p>
            <p className="mt-1 text-[13px] text-white/35">PDF, DOCX, MD, TXT</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <label>
                <input
                  type="file"
                  accept=".pdf,.docx,.md,.txt"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && void handleFiles(e.target.files, 'resume')}
                />
                <span className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#20B8CD] px-5 py-2.5 text-[13px] font-light text-white">
                  <FileText className="h-4 w-4" strokeWidth={1.75} /> Resume
                </span>
              </label>
              <label>
                <input
                  type="file"
                  accept=".pdf,.docx,.md,.txt"
                  className="hidden"
                  onChange={(e) => e.target.files && void handleFiles(e.target.files, 'job')}
                />
                <span className="inline-flex cursor-pointer items-center gap-2 rounded-full glass-soft px-5 py-2.5 text-[13px] font-light text-white/85">
                  Job description
                </span>
              </label>
            </div>
            {busy && <p className="mt-4 text-[12px] text-[#5DD5E3]">Parsing…</p>}
            {error && <p className="mt-4 text-[12px] text-[#E85D5D]">{error}</p>}
          </div>
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-[17px] font-medium tracking-tight text-white/95">
              Documents
            </h2>
            <span className="text-[12px] text-white/35">{documents.length}</span>
          </div>
          <div className="space-y-3">
            {documents.length === 0 && (
              <p className="py-6 text-[14px] text-white/35">
                No uploads yet — demo memories are active.
              </p>
            )}
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-[18px] glass-inset px-4 py-3.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-white/90">{d.name}</div>
                  <div className="mt-0.5 text-[12px] text-white/35">
                    {d.type} · {(d.sizeBytes / 1024).toFixed(1)} KB
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
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                Job match
              </h2>
              <p className="mt-1 text-[13px] text-white/40">
                Align memories to the role
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
            placeholder="Role title"
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
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-8">
            <h2 className="text-[17px] font-medium tracking-tight text-white/95">
              STAR memories
            </h2>
            <p className="mt-1 text-[13px] text-white/40">
              {memories.length} experiences for retrieval
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {starTree.map((m) => (
              <div key={m.id} className="rounded-[22px] glass-inset p-5">
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {m.tags.slice(0, 3).map((t) => (
                    <Badge key={t} tone="indigo">
                      {t}
                    </Badge>
                  ))}
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

function StarLine({ label, text }: { label: string; text: string }) {
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-white/65">
      <span className="mr-2 font-light text-white/35">{label}</span>
      {text}
    </p>
  )
}
