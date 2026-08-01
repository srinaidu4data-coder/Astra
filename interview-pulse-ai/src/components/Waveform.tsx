import { cn } from '@/lib/utils'
import { memo, useMemo } from 'react'

/**
 * Lightweight waveform — GPU scaleY (no height layout thrash).
 * Parent must NOT re-render the whole page on every level tick.
 */
export const Waveform = memo(function Waveform({
  levels,
  active,
  className,
}: {
  levels: number[]
  active?: boolean
  className?: string
  color?: 'emerald' | 'indigo'
}) {
  const bars = useMemo(() => {
    const raw = levels.length ? levels : Array.from({ length: 16 }, () => 0.08)
    const step = Math.max(1, Math.floor(raw.length / 16))
    return raw.filter((_, i) => i % step === 0).slice(0, 16)
  }, [levels])

  return (
    <div
      className={cn(
        'flex h-14 items-end justify-center gap-[3px] contain-layout contain-paint',
        className,
      )}
    >
      {bars.map((level, i) => {
        const h = Math.max(0.08, active ? level : 0.1 + (i % 5) * 0.02)
        return (
          <div
            key={i}
            className="w-[3px] origin-bottom rounded-sm"
            style={{
              height: '100%',
              // scaleY avoids layout reflow that used to flash glass panels
              transform: `scaleY(${h})`,
              transition: active ? 'transform 100ms linear' : 'transform 220ms ease',
              background: active ? '#20B8CD' : 'rgba(32,184,205,0.28)',
              opacity: active ? 0.95 : 0.5,
              willChange: active ? 'transform' : 'auto',
            }}
          />
        )
      })}
    </div>
  )
})
