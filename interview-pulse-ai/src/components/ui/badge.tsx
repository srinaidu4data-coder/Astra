import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

/** Material assist chips */
export function Badge({
  className,
  tone = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'indigo' | 'emerald' | 'amber'
}) {
  const tones = {
    default: 'bg-[#282a2c] text-[#9aa0a6] border-[rgba(232,234,237,0.12)]',
    indigo: 'bg-[#8ab4f8]/15 text-[#8ab4f8] border-[#8ab4f8]/25',
    emerald: 'bg-[#81c995]/12 text-[#81c995] border-[#81c995]/25',
    amber: 'bg-[#fdd663]/12 text-[#fdd663] border-[#fdd663]/25',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 text-[12px] font-medium tracking-[0.02em]',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
