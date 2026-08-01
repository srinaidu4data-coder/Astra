import { Waveform } from '@/components/Waveform'
import { useAppStore } from '@/stores/app-store'
import { memo } from 'react'

/**
 * Isolated subscriber for audio levels — only this component re-renders on
 * level ticks so the answer panel / transcript do not flash.
 */
export const LiveWaveform = memo(function LiveWaveform({
  active,
  className,
}: {
  active?: boolean
  className?: string
}) {
  const levels = useAppStore((s) => s.levels)
  return <Waveform levels={levels} active={active} className={className} />
})
