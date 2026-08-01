import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  JOB_HUB_ADVANCED,
  JOB_HUB_PRIMARY,
  isAdvancedMode,
  type JobHubMode,
} from './hubConfig'
import { FlowNextBanner, type FlowNextAction } from './FlowNextBanner'
import { LabOnlyBanner } from './LabOnlyBanner'
import { JobsJourney, WeeklyCompletedChip, type JourneyStep } from './JobsJourney'

export type { JobHubMode }
export type { FlowNextAction }
export type { JourneyStep }

export type FlowStep = {
  id: string
  label: string
  detail: string
  done: boolean
  active: boolean
  onClick: () => void
}

export type JobHubShellProps = {
  hubMode: JobHubMode
  onSwitch: (mode: JobHubMode) => void
  playbooksOpen: boolean
  onTogglePlaybooks: () => void
  liveCount?: number
  appliedCount?: number
  shortlistCount?: number
  apiOk: boolean
  connectivity: string
  flowSteps: FlowStep[]
  journey?: JourneyStep[]
  weeklyCompleted?: number | null
  onOpenMetrics?: () => void
  nextAction?: FlowNextAction | null
  /** Contextual how-to coach (first-run + phase guidance) */
  coach?: ReactNode
  banner?: ReactNode
  children: ReactNode
}

/**
 * Jobs chrome — Search · Apply · Night + optional Advanced (form pack / metrics).
 * Marvel / multi-playbook marketing stack removed.
 */
export function JobHubShell({
  hubMode,
  onSwitch,
  playbooksOpen,
  onTogglePlaybooks,
  liveCount = 0,
  appliedCount = 0,
  apiOk,
  connectivity,
  flowSteps,
  journey,
  weeklyCompleted = null,
  onOpenMetrics,
  nextAction = null,
  coach,
  banner,
  children,
}: JobHubShellProps) {
  const advancedActive = isAdvancedMode(hubMode)
  const stepHint =
    flowSteps.find((s) => s.active && !s.done) || flowSteps.find((s) => !s.done)

  return (
    <div className="jobs-enterprise mx-auto flex w-full max-w-5xl flex-col gap-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-normal tracking-normal text-[#e8eaed] md:text-[32px]">
            Jobs
          </h1>
          <p className="mt-1 max-w-lg text-[14px] leading-snug text-[#9aa0a6]">
            {stepHint
              ? stepHint.detail
              : 'Search → pick roles → apply selected → read the trust log.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WeeklyCompletedChip
            n={weeklyCompleted}
            onClick={onOpenMetrics}
          />
          <div
            className={cn(
              'jobs-status-pill mt-0 inline-flex items-center gap-2 border px-3 py-1.5',
              apiOk
                ? 'border-[rgba(232,234,237,0.12)] bg-[#282a2c] text-[#9aa0a6]'
                : 'border-[#f28b82]/30 bg-[#f28b82]/10 text-[#f28b82]',
            )}
            title={connectivity}
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                apiOk ? 'bg-[#81c995]' : 'bg-[#f28b82]',
              )}
            />
            {apiOk ? 'Connected' : 'API offline'}
            {liveCount > 0 && (
              <span className="tabular-nums text-[#80868b]">· {liveCount} live</span>
            )}
            {appliedCount > 0 && (
              <span className="tabular-nums text-[#8ab4f8]">· {appliedCount} applied</span>
            )}
          </div>
        </div>
      </header>

      {!apiOk && (
        <div className="rounded-xl border border-[#f28b82]/30 bg-[#f28b82]/10 px-4 py-3 text-[13px] text-[#f28b82]">
          <p className="font-medium">API offline — Search & Apply cannot run.</p>
          <p className="mt-1 text-[12px] opacity-90">
            Run <code className="rounded bg-black/30 px-1">START_JOBSEARCH_LAB.bat</code> or{' '}
            <code className="rounded bg-black/30 px-1">python -m jobsearch.supervisor</code> in{' '}
            <code className="rounded bg-black/30 px-1">src/</code>, then refresh.
          </p>
        </div>
      )}

      {journey && journey.length > 0 && <JobsJourney steps={journey} />}

      <div role="tablist" aria-label="Jobs" className="jobs-tabs flex items-stretch">
        {JOB_HUB_PRIMARY.map((tab) => {
          const active = hubMode === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSwitch(tab.id)}
              className="relative flex items-center justify-center gap-1.5"
            >
              {tab.label}
              {tab.id === 'search' && liveCount > 0 && (
                <span
                  className={cn(
                    'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums',
                    active
                      ? 'bg-[#8ab4f8]/20 text-[#8ab4f8]'
                      : 'bg-[#282a2c] text-[#9aa0a6]',
                  )}
                >
                  {liveCount}
                </span>
              )}
            </button>
          )
        })}
        <button
          type="button"
          onClick={onTogglePlaybooks}
          className={cn(
            'ml-auto flex items-center gap-0.5 px-3 py-3 text-[13px] font-medium transition',
            advancedActive || playbooksOpen
              ? 'text-[#8ab4f8]'
              : 'text-[#9aa0a6] hover:text-[#e8eaed]',
          )}
        >
          Advanced
          {playbooksOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {playbooksOpen && (
        <div className="-mt-2 flex flex-wrap gap-2">
          {JOB_HUB_ADVANCED.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSwitch(tab.id)}
              title={tab.blurb}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                hubMode === tab.id
                  ? 'border-[#8ab4f8]/40 bg-[#8ab4f8]/15 text-[#8ab4f8]'
                  : 'border-[rgba(232,234,237,0.12)] bg-transparent text-[#9aa0a6] hover:bg-[#282a2c] hover:text-[#e8eaed]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <LabOnlyBanner />

      {coach}

      {banner}

      <FlowNextBanner action={nextAction ?? null} />

      {advancedActive && liveCount === 0 && hubMode === 'autofill' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#fdd663]/25 bg-[#fdd663]/10 px-4 py-3 text-[14px] text-[#fdd663]">
          <span className="flex-1">
            Optional: search first for job-specific packs. Form pack works from profile alone.
          </span>
          <button
            type="button"
            className="rounded-full bg-[#8ab4f8] px-4 py-1.5 text-[13px] font-medium text-[#062e6f] hover:bg-[#aecbfa]"
            onClick={() => onSwitch('search')}
          >
            Search
          </button>
        </div>
      )}

      <div className="min-h-[280px]">{children}</div>
    </div>
  )
}
