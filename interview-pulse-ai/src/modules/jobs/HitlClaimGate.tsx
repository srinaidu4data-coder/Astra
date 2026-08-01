/**
 * Human-in-the-loop gate before any Submit — plain-language "what we claim" diff.
 * Lists the actual jobs so the user is not confirming a black box.
 */

import { Button } from '@/components/ui/button'
import { useEffect } from 'react'

export type ClaimJob = {
  id?: string
  title: string
  company?: string
  url?: string
  source?: string
  /** Hint: public form vs likely manual */
  likelihood?: 'form_fill' | 'manual' | 'unknown'
}

export type ClaimPreview = {
  jobCount: number
  willSubmit: boolean
  name?: string
  email?: string
  injects?: string[]
  gaps?: string[]
  honesty?: string
  jobs?: ClaimJob[]
}

function hostOf(url?: string) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

function likelihoodLabel(l?: ClaimJob['likelihood']) {
  if (l === 'form_fill') return { text: 'Likely form-fill', className: 'text-[#81c995]' }
  if (l === 'manual') return { text: 'Likely manual', className: 'text-[#fdd663]' }
  return { text: 'Unknown ATS', className: 'text-[#9aa0a6]' }
}

export function HitlClaimGate({
  open,
  preview,
  onConfirm,
  onCancel,
}: {
  open: boolean
  preview: ClaimPreview
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const jobs = preview.jobs || []

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hitl-title"
      data-testid="hitl-claim-gate"
    >
      <div className="jobs-command max-h-[90vh] w-full max-w-lg overflow-y-auto p-5 shadow-2xl md:p-6">
        <h2 id="hitl-title" className="text-[18px] font-medium text-[#e8eaed]">
          Review before apply
        </h2>
        <p className="mt-1 text-[13px] text-[#9aa0a6]">
          Confirm contact details and the exact roles below. Nothing is submitted until you
          continue.
        </p>

        <dl className="mt-4 space-y-3 text-[13px]">
          <div className="flex justify-between gap-4 border-b border-[rgba(232,234,237,0.08)] pb-2">
            <dt className="text-[#80868b]">Jobs in this run</dt>
            <dd className="font-medium tabular-nums text-[#e8eaed]">
              {jobs.length || preview.jobCount}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-[rgba(232,234,237,0.08)] pb-2">
            <dt className="text-[#80868b]">Submit forms?</dt>
            <dd className="font-medium text-[#e8eaed]">
              {preview.willSubmit ? (
                <span className="text-[#fdd663]">Yes — may click Submit on public forms</span>
              ) : (
                <span className="text-[#8ab4f8]">No — fill only</span>
              )}
            </dd>
          </div>
          {preview.name && (
            <div className="flex justify-between gap-4 border-b border-[rgba(232,234,237,0.08)] pb-2">
              <dt className="text-[#80868b]">Name on forms</dt>
              <dd className="max-w-[60%] truncate text-right font-medium text-[#e8eaed]">
                {preview.name}
              </dd>
            </div>
          )}
          {preview.email && (
            <div className="flex justify-between gap-4 border-b border-[rgba(232,234,237,0.08)] pb-2">
              <dt className="text-[#80868b]">Email on forms</dt>
              <dd className="max-w-[60%] truncate text-right font-medium text-[#e8eaed]">
                {preview.email}
              </dd>
            </div>
          )}
        </dl>

        {jobs.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#80868b]">
              Roles we will attempt
            </p>
            <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
              {jobs.map((j, i) => {
                const like = likelihoodLabel(j.likelihood)
                const host = hostOf(j.url)
                return (
                  <li
                    key={j.id || `${j.title}-${i}`}
                    className="rounded-lg border border-[rgba(232,234,237,0.08)] bg-black/20 px-3 py-2"
                  >
                    <p className="truncate text-[13px] font-medium text-[#e8eaed]">
                      {j.title}
                      {j.company ? (
                        <span className="font-normal text-[#9aa0a6]"> · {j.company}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[#80868b]">
                      {host && <span>{host}</span>}
                      {j.source && <span>· {j.source}</span>}
                      <span className={like.className}>· {like.text}</span>
                    </p>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {!!preview.injects?.length && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#80868b]">
              Keywords we may emphasize (only if already in your background)
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {preview.injects.slice(0, 12).map((k) => (
                <span
                  key={k}
                  className="rounded-md bg-[#8ab4f8]/15 px-2 py-0.5 text-[11px] text-[#8ab4f8]"
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        {!!preview.gaps?.length && (
          <div className="mt-4 rounded-lg border border-[#fdd663]/25 bg-[#fdd663]/10 px-3 py-2">
            <p className="text-[11px] font-medium text-[#fdd663]">Honest gaps — do not invent</p>
            <p className="mt-1 text-[12px] text-[#fdd663]/90">
              {preview.gaps.slice(0, 8).join(', ')}
            </p>
          </div>
        )}

        <p className="mt-4 text-[12px] leading-relaxed text-[#80868b]">
          {preview.honesty ||
            'We never invent employers or degrees. Login walls and CAPTCHA stay with you. You own every claim.'}
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="jobs-primary-cta" onClick={onConfirm} data-testid="hitl-confirm">
            {preview.willSubmit
              ? `I understand — apply ${jobs.length || preview.jobCount || ''}`
              : 'I understand — fill only'}
          </Button>
        </div>
      </div>
    </div>
  )
}
