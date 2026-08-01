import { Button } from '@/components/ui/button'
import {
  downloadTrackerCsv,
  type TrackedApplication,
} from '@/services/jobsearch'
import { ExternalLink } from 'lucide-react'

type Props = {
  tracker: TrackedApplication[]
  appliedCount: number
  shortlistCount: number
  onToast?: (msg: string) => void
}

export function ApplicationsPanel({
  tracker,
  appliedCount,
  shortlistCount,
  onToast,
}: Props) {
  if (!tracker.length) return null

  return (
    <section className="jobs-command overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/30">
            Tracker
          </p>
          <h3 className="text-[13px] font-semibold text-white/90">Your applications</h3>
        </div>
        <span className="text-[11px] tabular-nums text-white/35">
          {appliedCount} applied · {shortlistCount} shortlisted · {tracker.length} total
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            downloadTrackerCsv(tracker)
            onToast?.('Downloaded applications.csv')
          }}
        >
          Export CSV
        </Button>
      </div>
      <div className="max-h-44 overflow-y-auto">
        {tracker.slice(0, 40).map((t) => (
          <div
            key={t.job_id + (t.updated_at || '')}
            className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2.5 text-[12px] transition hover:bg-white/[0.02]"
          >
            <span
              className={
                t.status === 'applied'
                  ? 'w-[4.5rem] shrink-0 capitalize text-[#5DD5E3]'
                  : t.status === 'interview' || t.status === 'offer'
                    ? 'w-[4.5rem] shrink-0 capitalize text-[#E8C547]'
                    : 'w-[4.5rem] shrink-0 capitalize text-white/40'
              }
            >
              {t.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-white/80">
              {t.title} · {t.company}
            </span>
            {t.apply_url && (
              <a
                href={t.apply_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#5DD5E3] opacity-70 hover:opacity-100"
                title="Open application"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
