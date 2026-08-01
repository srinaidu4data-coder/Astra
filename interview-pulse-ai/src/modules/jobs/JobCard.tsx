import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { companyInitials, cn } from '@/lib/utils'
import {
  isLinkedInSourcedJob,
  isSyntheticJob,
  resolveApplyUrl,
  resolveLinkedInUrl,
  type AppStatus,
  type RankedJob,
  type TrackedApplication,
} from '@/services/jobsearch'
import {
  Briefcase,
  ExternalLink,
  Linkedin,
  Loader2,
  MapPin,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { ComponentType } from 'react'

export type JobCardProps = {
  job: RankedJob
  index: number
  expanded: boolean
  tracked?: TrackedApplication
  excludeLinkedIn: boolean
  applyBusy: boolean
  apiOk: boolean
  statusOpts: AppStatus[]
  /** Multi-select for batch apply */
  selected?: boolean
  onToggleSelect?: () => void
  selectDisabled?: boolean
  onToggleExpand: () => void
  onOpenApply: () => void
  onShortlist: () => void
  onMaterials: () => void
  onFillForm: () => void
  onMarkStatus: (st: AppStatus) => void
  onSaveJd: () => void
  onMock: () => void
  ScoreRing: ComponentType<{ score: number }>
}

export function JobCard({
  job: j,
  index: idx,
  expanded: open,
  tracked,
  excludeLinkedIn,
  applyBusy,
  apiOk,
  statusOpts,
  selected = false,
  onToggleSelect,
  selectDisabled,
  onToggleExpand,
  onOpenApply,
  onShortlist,
  onMaterials,
  onFillForm,
  onMarkStatus,
  onSaveJd,
  onMock,
  ScoreRing,
}: JobCardProps) {
  const synth = isSyntheticJob(j)
  const score = j.scores?.ensemble ?? 0
  const liUrl = resolveLinkedInUrl(j)
  const primary = resolveApplyUrl(j, excludeLinkedIn)

  return (
    <article
      className={cn(
        'jobs-card group glass relative overflow-hidden rounded-2xl',
        synth && 'border-l-4 border-l-[#fdd663]',
        selected && !synth && 'ring-1 ring-[#8ab4f8]/45 border-[#8ab4f8]/30',
        tracked?.status === 'applied' && 'border-[#8ab4f8]/35',
        tracked?.status === 'shortlisted' && 'border-[rgba(232,234,237,0.2)]',
      )}
    >
      <div className="flex gap-3 p-4 md:gap-4 md:p-5">
        {onToggleSelect && !synth && (
          <label
            className="flex shrink-0 cursor-pointer flex-col items-center gap-1 pt-1"
            title={selected ? 'Selected for apply' : 'Select for apply'}
          >
            <input
              type="checkbox"
              checked={selected}
              disabled={selectDisabled && !selected}
              onChange={onToggleSelect}
              className="h-4 w-4 accent-[#8ab4f8]"
              aria-label={`Select ${j.title} for apply`}
            />
            <span className="text-[9px] uppercase tracking-wide text-[#80868b]">
              {selected ? 'On' : 'Pick'}
            </span>
          </label>
        )}
        <div className="hidden flex-col items-center gap-1 sm:flex">
          <ScoreRing score={score} />
          <span className="text-[11px] font-medium tabular-nums text-[#80868b]">
            {idx + 1}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#8ab4f8]/15 text-[12px] font-medium text-[#8ab4f8] sm:hidden">
              {companyInitials(j.company)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[16px] font-medium leading-snug text-[#e8eaed]">
                  {j.title}
                </h3>
                {synth ? (
                  <Badge tone="amber">practice</Badge>
                ) : isLinkedInSourcedJob(j) ? (
                  <Badge tone="indigo">LinkedIn</Badge>
                ) : (
                  <Badge tone="emerald">{j.source || 'live'}</Badge>
                )}
                {tracked && <Badge tone="default">{tracked.status}</Badge>}
                <span className="text-[13px] font-medium tabular-nums text-[#8ab4f8] sm:hidden">
                  {score}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-[#9aa0a6]">
                <span className="inline-flex items-center gap-1 font-medium text-[#e8eaed]/90">
                  <Briefcase className="h-3.5 w-3.5 text-[#80868b]" />
                  {j.company}
                </span>
                {j.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-[#80868b]" />
                    {j.location}
                  </span>
                )}
                {j.work_mode && j.work_mode !== 'onsite' && (
                  <span className="text-[#80868b]">· {j.work_mode}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onOpenApply}>
              <ExternalLink className="h-4 w-4" />
              {synth ? 'Find on Indeed' : 'Open listing'}
            </Button>
            {!synth && (
              <Button
                size="sm"
                className="jobs-primary-cta"
                disabled={applyBusy || !apiOk}
                onClick={onFillForm}
                title="Auto-fill this application form (not bulk Apply selected)"
              >
                {applyBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Fill form
              </Button>
            )}
            {!synth && !isLinkedInSourcedJob(j) && liUrl && !excludeLinkedIn && liUrl !== primary && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => window.open(liUrl, '_blank', 'noopener,noreferrer')}
              >
                <Linkedin className="h-3.5 w-3.5" />
              </Button>
            )}
            {!synth && (
              <Button size="sm" variant="ghost" onClick={onShortlist}>
                Save
              </Button>
            )}
            {!synth && (
              <Button size="sm" variant="ghost" disabled={applyBusy} onClick={onMaterials}>
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
            )}
            <button
              type="button"
              onClick={onToggleExpand}
              className="ml-auto text-[12px] text-white/30 transition hover:text-white/70"
            >
              {open ? 'Less' : 'Details'}
            </button>
          </div>

          {open && (
            <div className="mt-3 space-y-2.5 rounded-xl border border-white/[0.06] bg-black/30 p-3.5">
              {synth && (
                <p className="text-[11px] text-[#E8C547]">
                  Synthetic practice listing — not a real opening.
                </p>
              )}
              {!!j.gap_skills?.length && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-white/30">
                    Skill gaps
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {j.gap_skills.map((g) => (
                      <span
                        key={g}
                        className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/45"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {j.text && (
                <p className="max-h-28 overflow-y-auto text-[12px] leading-relaxed text-white/40">
                  {j.text.slice(0, 480)}
                  {j.text.length > 480 ? '…' : ''}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={onSaveJd}>
                  Save JD
                </Button>
                <Button size="sm" variant="ghost" onClick={onMock}>
                  Prep mock
                </Button>
                {j.indeed_url && !synth && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(j.indeed_url, '_blank', 'noopener,noreferrer')}
                  >
                    Indeed
                  </Button>
                )}
              </div>
              {!synth && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {statusOpts.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => onMarkStatus(st)}
                      className={cn(
                        'rounded-md px-2 py-1 text-[10px] capitalize transition',
                        tracked?.status === st
                          ? 'bg-[#20B8CD]/20 text-[#5DD5E3]'
                          : 'bg-white/[0.04] text-white/35 hover:text-white/60',
                      )}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
