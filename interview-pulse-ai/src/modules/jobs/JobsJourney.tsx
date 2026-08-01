/**
 * Progressive journey: Search → Review claims → Apply → Truth.
 * Sam Altman product ask: one boring loop people actually complete.
 */

import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

export type JourneyStep = {
  id: string
  label: string
  done: boolean
  active: boolean
  onClick?: () => void
}

export function JobsJourney({
  steps,
  className,
}: {
  steps: JourneyStep[]
  className?: string
}) {
  return (
    <nav
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-xl border border-[rgba(232,234,237,0.1)] bg-[#1e1f20] px-3 py-2.5',
        className,
      )}
      aria-label="Jobs journey"
    >
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1">
          {i > 0 && (
            <span
              className={cn(
                'mx-1 h-px w-3 sm:w-5',
                steps[i - 1]?.done ? 'bg-[#81c995]/40' : 'bg-[rgba(232,234,237,0.12)]',
              )}
              aria-hidden
            />
          )}
          <button
            type="button"
            disabled={!s.onClick}
            onClick={s.onClick}
            aria-current={s.active ? 'step' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition',
              s.done && 'text-[#81c995]',
              s.active && !s.done && 'bg-[#8ab4f8]/15 text-[#8ab4f8] ring-1 ring-[#8ab4f8]/25',
              !s.done && !s.active && 'text-[#80868b]',
              s.onClick && 'cursor-pointer hover:bg-white/[0.04]',
              !s.onClick && 'cursor-default',
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                s.done && 'bg-[#81c995]/20 text-[#81c995]',
                s.active && !s.done && 'bg-[#8ab4f8]/25 text-[#8ab4f8]',
                !s.done && !s.active && 'bg-white/[0.06] text-[#80868b]',
              )}
            >
              {s.done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
          </button>
        </div>
      ))}
    </nav>
  )
}

/** Compact weekly KPI for hub header */
export function WeeklyCompletedChip({
  n,
  loading,
  onClick,
}: {
  n?: number | null
  loading?: boolean
  onClick?: () => void
}) {
  if (loading) {
    return (
      <span className="jobs-status-pill border border-[rgba(232,234,237,0.1)] bg-[#282a2c] px-2.5 py-1 text-[11px] text-[#80868b]">
        Week…
      </span>
    )
  }
  if (n == null) return null
  const hasAny = n > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        hasAny
          ? 'jobs-status-pill border border-[#81c995]/25 bg-[#81c995]/10 px-2.5 py-1 text-[11px] font-medium text-[#81c995] hover:bg-[#81c995]/15'
          : 'jobs-status-pill border border-[rgba(232,234,237,0.12)] bg-[#282a2c] px-2.5 py-1 text-[11px] font-medium text-[#9aa0a6] hover:bg-white/[0.04]'
      }
      title="Lab metric: form submit clicks counted as submitted (not employer confirmation)"
    >
      {n} submit clicks this week (lab)
    </button>
  )
}
