import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

export function Badge({
  className,
  tone = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'indigo' | 'emerald' | 'amber'
}) {
  const tones = {
    default: 'bg-white/[0.06] text-white/60 border-white/[0.08]',
    indigo: 'bg-[#20B8CD]/15 text-[#5DD5E3] border-[#20B8CD]/30',
    emerald: 'bg-[#20B8CD]/12 text-[#20B8CD] border-[#20B8CD]/25',
    amber: 'bg-[#E8C547]/12 text-[#E8C547] border-[#E8C547]/25',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium tracking-wide',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
