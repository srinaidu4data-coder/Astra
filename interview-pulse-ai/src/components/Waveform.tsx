import { cn } from '@/lib/utils'

/**
 * Lightweight waveform — plain CSS height (no Framer springs).
 * Springs on every mic tick were a major source of UI flicker.
 */
export function Waveform({
  levels,
  active,
  className,
}: {
  levels: number[]
  active?: boolean
  className?: string
  color?: 'emerald' | 'indigo'
}) {
  // Fewer bars = less paint cost while still reading as activity
  const raw = levels.length ? levels : Array.from({ length: 24 }, () => 0.08)
  const step = Math.max(1, Math.floor(raw.length / 24))
  const bars = raw.filter((_, i) => i % step === 0).slice(0, 24)

  return (
    <div className={cn('flex h-14 items-end justify-center gap-[3px]', className)}>
      {bars.map((level, i) => {
        const h = Math.max(0.08, active ? level : 0.1 + (i % 5) * 0.02)
        return (
          <div
            key={i}
            className="w-[3px] min-h-[4px] rounded-sm will-change-[height]"
            style={{
              height: `${h * 100}%`,
              // Short linear transition only — no spring bounce / flash
              transition: active ? 'height 80ms linear' : 'height 200ms ease',
              background: active ? '#20B8CD' : 'rgba(32,184,205,0.28)',
              opacity: active ? 0.95 : 0.5,
            }}
          />
        )
      })}
    </div>
  )
}
