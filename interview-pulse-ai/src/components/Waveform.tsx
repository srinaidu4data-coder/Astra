import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

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
  const bars = levels.length ? levels : Array.from({ length: 32 }, () => 0.08)

  return (
    <div className={cn('flex h-14 items-end justify-center gap-[3px]', className)}>
      {bars.map((level, i) => {
        const h = Math.max(0.08, active ? level : 0.1 + (i % 5) * 0.02)
        return (
          <motion.div
            key={i}
            animate={{ height: `${h * 100}%` }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="w-[2px] min-h-[4px]"
            style={{
              background: active ? '#20B8CD' : 'rgba(32,184,205,0.28)',
              opacity: active ? 1 : 0.55,
              borderRadius: 0,
            }}
          />
        )
      })}
    </div>
  )
}
