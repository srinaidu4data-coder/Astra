import { Waveform } from '@/components/Waveform'
import { WhisperStream } from '@/components/WhisperStream'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'
import type { QACard } from '@/types'
import { Eye, EyeOff, GripHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'

export function OverlayPage() {
  const {
    answer,
    answerMode,
    setAnswerMode,
    levels,
    listening,
    stealth,
    updateStealth,
  } = useAppStore()

  const [cardIndex, setCardIndex] = useState(0)

  const cards: QACard[] = useMemo(() => {
    if (!answer) return []
    return [
      {
        id: answer.id,
        question: answer.question || 'Current answer',
        answer,
      },
    ]
  }, [answer])

  useEffect(() => {
    document.body.style.background = 'transparent'
    void window.interviewPulse?.setOverlayOpacity(stealth.opacity)
    void window.interviewPulse?.setContentProtection(stealth.contentProtection)
    void window.interviewPulse?.setClickThrough(stealth.clickThrough)

    const unsub = window.interviewPulse?.onToggleClickThrough?.(() => {
      const next = !useAppStore.getState().stealth.clickThrough
      updateStealth({ clickThrough: next })
      void window.interviewPulse?.setClickThrough(next)
    })

    return () => {
      unsub?.()
      document.body.style.background = ''
    }
  }, [stealth.opacity, stealth.contentProtection, stealth.clickThrough, updateStealth])

  useEffect(() => {
    setCardIndex(0)
  }, [answer?.id])

  return (
    <div className="flex h-screen flex-col bg-transparent p-3 text-white">
      <div
        className="glass mb-3 flex items-center justify-between rounded-[18px] px-3 py-2.5"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center gap-2 text-[12px] text-white/55">
          <GripHorizontal className="h-4 w-4 text-white/30" strokeWidth={1.5} />
          Answer
          <Badge tone={listening ? 'emerald' : 'default'}>
            {listening ? 'live' : 'idle'}
          </Badge>
        </div>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <Button
            size="icon"
            variant="ghost"
            title="Click-through"
            onClick={() => {
              const next = !stealth.clickThrough
              updateStealth({ clickThrough: next })
              void window.interviewPulse?.setClickThrough(next)
            }}
          >
            {stealth.clickThrough ? (
              <EyeOff className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <Eye className="h-4 w-4" strokeWidth={1.5} />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void window.interviewPulse?.closeOverlay()}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <div className="glass mb-3 rounded-[18px] px-4 py-3">
        <Waveform levels={levels} active={listening} className="h-10" />
      </div>

      <div
        className="mb-3 flex items-center gap-3"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <input
          type="range"
          min={20}
          max={100}
          value={Math.round(stealth.opacity * 100)}
          onChange={(e) => {
            const opacity = Number(e.target.value) / 100
            updateStealth({ opacity })
            void window.interviewPulse?.setOverlayOpacity(opacity)
          }}
          className="flex-1 accent-[#20B8CD]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[24px]">
        <WhisperStream
          compact
          cards={cards}
          cardIndex={cardIndex}
          onCardIndex={setCardIndex}
          mode={answerMode}
          onMode={setAnswerMode}
          preparing={false}
        />
      </div>
    </div>
  )
}
