/**
 * Interview readiness — all four inputs required before Start.
 * Role · Job context · Resume · Job description (JD)
 */

import type { KnowledgeDocType, ResumeDocument } from '@/types'

export type ReadyKey = 'role' | 'jobContext' | 'resume' | 'jd'

export type ReadyCheck = {
  key: ReadyKey
  label: string
  short: string
  ok: boolean
  hint: string
}

const MIN_DOC_CHARS = 40
const MIN_ROLE = 2
const MIN_CONTEXT = 3

export function hasDocOfType(
  documents: ResumeDocument[] | undefined,
  type: KnowledgeDocType,
  minChars = MIN_DOC_CHARS,
): boolean {
  return (documents || []).some(
    (d) => d.type === type && (d.text || '').trim().length >= minChars,
  )
}

export function getInterviewReadiness(opts: {
  role: string
  jobContext: string
  documents: ResumeDocument[] | undefined
}): {
  ready: boolean
  checks: ReadyCheck[]
  missing: ReadyCheck[]
  completeCount: number
  total: number
} {
  const role = (opts.role || '').trim()
  const jobContext = (opts.jobContext || '').trim()
  const docs = opts.documents || []

  const checks: ReadyCheck[] = [
    {
      key: 'role',
      label: 'Job role',
      short: 'Role',
      ok: role.length >= MIN_ROLE,
      hint: 'Title you are interviewing for',
    },
    {
      key: 'jobContext',
      label: 'Job context',
      short: 'Context',
      ok: jobContext.length >= MIN_CONTEXT,
      hint: 'Stack, domain, or focus for this interview',
    },
    {
      key: 'resume',
      label: 'Resume',
      short: 'Resume',
      ok: hasDocOfType(docs, 'resume'),
      hint: 'PDF, DOCX, or TXT — used to ground answers',
    },
    {
      key: 'jd',
      label: 'Job description',
      short: 'JD',
      ok: hasDocOfType(docs, 'job'),
      hint: 'Paste or upload the JD for this role',
    },
  ]

  const missing = checks.filter((c) => !c.ok)
  const completeCount = checks.length - missing.length
  return {
    ready: missing.length === 0,
    checks,
    missing,
    completeCount,
    total: checks.length,
  }
}

export function readinessSummary(r: ReturnType<typeof getInterviewReadiness>): string {
  if (r.ready) return 'Ready to start'
  if (r.missing.length === 1) return `Add ${r.missing[0]!.label} to start`
  return `${r.completeCount} of ${r.total} ready · ${r.missing.map((m) => m.short).join(', ')} still needed`
}

/** Scroll / focus first incomplete kit field (for Start & Answer gates). */
export function focusFirstMissing(
  r: ReturnType<typeof getInterviewReadiness>,
): void {
  const key = r.missing[0]?.key
  if (!key) return
  const section = document.getElementById(`ip-kit-${key}`)
  const field = document.getElementById(`ip-field-${key}`)
  section?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  window.setTimeout(() => {
    if (field instanceof HTMLInputElement && field.type !== 'file') {
      field.focus()
      return
    }
    // File inputs: open the visible upload control near the section
    const btn = section?.querySelector('button.ip-upload') as HTMLButtonElement | null
    btn?.focus()
  }, 280)
}
