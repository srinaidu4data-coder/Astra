import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'

export type FlowNextAction = {
  stage: string
  title: string
  detail: string
  cta: string
  onClick: () => void
  tone?: 'ready' | 'warn' | 'done'
  secondaryCta?: string
  onSecondary?: () => void
}

/** Material snackbar / assist banner */
export function FlowNextBanner({ action }: { action: FlowNextAction | null }) {
  if (!action) return null
  const tone = action.tone || 'ready'

  return (
    <div
      className={cn(
        'jobs-next-banner flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        tone === 'ready' && 'border-[#8ab4f8]/25 bg-[#8ab4f8]/10',
        tone === 'warn' && 'border-[#fdd663]/25 bg-[#fdd663]/10',
        tone === 'done' && 'border-[rgba(232,234,237,0.1)] bg-[#282a2c]',
      )}
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-[#e8eaed]">{action.title}</p>
        <p className="mt-0.5 text-[13px] text-[#9aa0a6]">{action.detail}</p>
      </div>
      <div className="flex items-center gap-2">
        {action.secondaryCta && action.onSecondary && (
          <Button size="sm" variant="ghost" onClick={action.onSecondary}>
            {action.secondaryCta}
          </Button>
        )}
        <Button
          size="sm"
          onClick={action.onClick}
          className={cn(
            tone === 'warn' && 'bg-[#fdd663] text-[#202124] hover:bg-[#fdd663]/90',
            tone === 'ready' && 'jobs-primary-cta',
          )}
        >
          {action.cta}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
