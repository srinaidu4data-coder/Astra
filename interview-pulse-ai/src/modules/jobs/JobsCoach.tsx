/**
 * Contextual "how to use Jobs" coach — one next action, plain language.
 * Addresses first-run confusion: too many buttons, unclear loop.
 */

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Check,
  Circle,
  HelpCircle,
  Lightbulb,
  X,
} from 'lucide-react'
import { useState } from 'react'

const DISMISS_KEY = 'ip_jobs_coach_dismissed_v1'
const COLLAPSE_KEY = 'ip_jobs_coach_collapsed_v1'

export type CoachPhase =
  | 'offline'
  | 'start'
  | 'need_email'
  | 'ready_search'
  | 'searching'
  | 'pick_jobs'
  | 'ready_apply'
  | 'applying'
  | 'truth'
  | 'idle'

export type JobsCoachProps = {
  phase: CoachPhase
  selectedCount?: number
  liveCount?: number
  title?: string
  /** Primary action for current phase */
  onPrimary?: () => void
  primaryLabel?: string
  primaryDisabled?: boolean
  onSecondary?: () => void
  secondaryLabel?: string
  className?: string
}

const STEPS = [
  { id: 'search', label: 'Search' },
  { id: 'pick', label: 'Pick roles' },
  { id: 'apply', label: 'Apply' },
  { id: 'truth', label: 'See truth' },
] as const

function stepIndex(phase: CoachPhase): number {
  switch (phase) {
    case 'offline':
    case 'start':
    case 'need_email':
    case 'ready_search':
    case 'searching':
      return 0
    case 'pick_jobs':
      return 1
    case 'ready_apply':
    case 'applying':
      return 2
    case 'truth':
      return 3
    default:
      return 0
  }
}

function copyFor(phase: CoachPhase, selectedCount: number, liveCount: number): {
  title: string
  body: string
  tip?: string
} {
  switch (phase) {
    case 'offline':
      return {
        title: 'API is offline',
        body: 'Start the lab API first. Search and Apply stay disabled until Connected is green.',
        tip: 'Run START_JOBSEARCH_LAB.bat or python -m jobsearch.supervisor in src/',
      }
    case 'start':
      return {
        title: 'How to use Jobs (30 seconds)',
        body: '1) Type a job title  2) Add your email  3) Search  4) Check the roles you want  5) Apply selected  6) Read the trust log (filled / manual / skipped).',
        tip: 'We fill public forms when possible. LinkedIn and login walls stay manual — that is expected, not a bug.',
      }
    case 'need_email':
      return {
        title: 'Add your email next',
        body: 'Email is required so we can put contact info on employer forms. Title is already set — email unlocks Apply.',
      }
    case 'ready_search':
      return {
        title: 'Ready to search',
        body: 'Press Search to pull live roles. You will pick which ones to try — we will not apply until you confirm.',
        tip: 'Prefer “Search” first. “Search & try form-fill” is optional and only attempts up to 4 roles after you confirm.',
      }
    case 'searching':
      return {
        title: 'Searching live boards…',
        body: 'Usually 4–12 seconds. Results appear below when ready.',
      }
    case 'pick_jobs':
      return {
        title: liveCount
          ? `${liveCount} roles found — pick who to try`
          : 'No live roles — try again',
        body: liveCount
          ? 'Check the boxes on jobs you want. Top form-friendly roles are pre-selected (max 4). Uncheck anything wrong.'
          : 'Try Anywhere, turn LinkedIn on, or broaden the title.',
        tip: 'Apply only runs on checked jobs. You stay in control.',
      }
    case 'ready_apply':
      return {
        title: `Apply ${selectedCount || 0} selected`,
        body: 'Next we show a claim sheet (name, email, job list), then open forms in a browser. Expect some “manual” for LinkedIn/Workday.',
      }
    case 'applying':
      return {
        title: 'Applying selected roles…',
        body: 'One browser at a time. Cancel stops the queue. Outcomes land in the trust log.',
      }
    case 'truth':
      return {
        title: 'Read the trust log',
        body: 'Each row is one real attempt: submitted, filled, manual, or skipped — not a marketing count. Scroll to “Apply trust log” or use Jump to truth.',
        tip: 'Manual means we opened the page for you; you finish login/CAPTCHA.',
      }
    default:
      return {
        title: 'Jobs lab',
        body: 'Search → pick roles → apply selected → read truth.',
      }
  }
}

export function JobsCoach({
  phase,
  selectedCount = 0,
  liveCount = 0,
  onPrimary,
  primaryLabel,
  primaryDisabled,
  onSecondary,
  secondaryLabel,
  className,
}: JobsCoachProps) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  // Re-show coach when phase is critical even if user dismissed the long intro
  const forceShow =
    phase === 'offline' ||
    phase === 'need_email' ||
    phase === 'pick_jobs' ||
    phase === 'ready_apply' ||
    phase === 'applying' ||
    phase === 'truth'

  if (dismissed && !forceShow) {
    return (
      <button
        type="button"
        onClick={() => {
          setDismissed(false)
          try {
            localStorage.removeItem(DISMISS_KEY)
          } catch {
            /* ignore */
          }
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border border-[rgba(232,234,237,0.1)] bg-[#1e1f20] px-3 py-2 text-left text-[12px] text-[#9aa0a6] hover:bg-white/[0.03]',
          className,
        )}
        data-testid="jobs-coach-restore"
      >
        <HelpCircle className="h-3.5 w-3.5 shrink-0 text-[#8ab4f8]" />
        Show how to use Jobs
      </button>
    )
  }

  const copy = copyFor(phase, selectedCount, liveCount)
  const active = stepIndex(phase)

  if (collapsed && !forceShow) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-xl border border-[rgba(232,234,237,0.1)] bg-[#1e1f20] px-3 py-2',
          className,
        )}
        data-testid="jobs-coach-collapsed"
      >
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-[#fdd663]" />
        <span className="min-w-0 flex-1 text-[12px] text-[#e8eaed]">{copy.title}</span>
        {onPrimary && primaryLabel && (
          <Button
            size="sm"
            className="jobs-primary-cta h-8"
            disabled={primaryDisabled}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        )}
        <button
          type="button"
          className="text-[11px] text-[#8ab4f8] hover:underline"
          onClick={() => {
            setCollapsed(false)
            try {
              localStorage.removeItem(COLLAPSE_KEY)
            } catch {
              /* ignore */
            }
          }}
        >
          Expand
        </button>
      </div>
    )
  }

  return (
    <section
      className={cn(
        'jobs-command overflow-hidden border-[#8ab4f8]/20',
        phase === 'offline' && 'border-[#f28b82]/30',
        className,
      )}
      data-testid="jobs-coach"
      aria-label="How to use Jobs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[rgba(232,234,237,0.08)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Lightbulb
            className={cn(
              'h-4 w-4 shrink-0',
              phase === 'offline' ? 'text-[#f28b82]' : 'text-[#fdd663]',
            )}
          />
          <h2 className="text-[14px] font-medium text-[#e8eaed]">{copy.title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {!forceShow && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-[11px] text-[#9aa0a6] hover:bg-white/[0.04] hover:text-[#e8eaed]"
              onClick={() => {
                setCollapsed(true)
                try {
                  localStorage.setItem(COLLAPSE_KEY, '1')
                } catch {
                  /* ignore */
                }
              }}
            >
              Minimize
            </button>
          )}
          {(phase === 'start' || phase === 'idle') && (
            <button
              type="button"
              className="rounded-lg p-1 text-[#80868b] hover:bg-white/[0.04] hover:text-[#e8eaed]"
              aria-label="Dismiss guide"
              onClick={() => {
                setDismissed(true)
                try {
                  localStorage.setItem(DISMISS_KEY, '1')
                } catch {
                  /* ignore */
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress chips */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        {STEPS.map((s, i) => {
          const done = i < active
          const current = i === active
          return (
            <div key={s.id} className="flex items-center gap-1.5">
              {i > 0 && (
                <span
                  className={cn(
                    'mx-0.5 h-px w-3',
                    done || current ? 'bg-[#8ab4f8]/40' : 'bg-white/10',
                  )}
                />
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  done && 'bg-[#81c995]/15 text-[#81c995]',
                  current && !done && 'bg-[#8ab4f8]/15 text-[#8ab4f8]',
                  !done && !current && 'bg-white/[0.04] text-[#80868b]',
                )}
              >
                {done ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Circle className={cn('h-2.5 w-2.5', current && 'fill-current')} />
                )}
                {s.label}
              </span>
            </div>
          )
        })}
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="text-[13px] leading-relaxed text-[#9aa0a6]">{copy.body}</p>
        {copy.tip && (
          <p className="rounded-lg border border-[rgba(232,234,237,0.08)] bg-black/20 px-3 py-2 text-[12px] leading-relaxed text-[#80868b]">
            <span className="font-medium text-[#9aa0a6]">Honest note: </span>
            {copy.tip}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {onPrimary && primaryLabel && (
            <Button
              size="sm"
              className="jobs-primary-cta"
              disabled={primaryDisabled}
              onClick={onPrimary}
              data-testid="jobs-coach-primary"
            >
              {primaryLabel}
            </Button>
          )}
          {onSecondary && secondaryLabel && (
            <Button size="sm" variant="secondary" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

/** Compact always-on legend for results header */
export function ApplyLegend({ className }: { className?: string }) {
  return (
    <p className={cn('text-[11px] leading-snug text-[#80868b]', className)}>
      <span className="text-[#81c995]">Submitted</span>
      {' · '}
      <span className="text-[#8ab4f8]">Filled</span>
      {' · '}
      <span className="text-[#fdd663]">Manual</span>
      {' · '}
      <span className="text-[#9aa0a6]">Skipped</span>
      {' — each is one real attempt'}
    </p>
  )
}
