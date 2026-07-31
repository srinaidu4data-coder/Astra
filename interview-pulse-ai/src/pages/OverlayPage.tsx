import { Waveform } from '@/components/Waveform'
import { WhisperStream } from '@/components/WhisperStream'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { subscribeLiveSync } from '@/lib/window-sync'
import { useAppStore } from '@/stores/app-store'
import type { AnswerMode, OverlaySizePreset, QACard } from '@/types'
import {
  Eye,
  EyeOff,
  GripHorizontal,
  Maximize2,
  Minimize2,
  PanelTopClose,
  PanelTopOpen,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'

const PRESETS: { id: OverlaySizePreset; label: string; title: string }[] = [
  { id: 'compact', label: 'S', title: 'Compact' },
  { id: 'medium', label: 'M', title: 'Medium' },
  { id: 'large', label: 'L', title: 'Large' },
  { id: 'wide', label: 'Wide', title: 'Wide' },
  { id: 'tall', label: 'Tall', title: 'Tall' },
  { id: 'max', label: 'Max', title: 'Fill screen' },
]

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
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  const [sizeLabel, setSizeLabel] = useState('')
  const [maximized, setMaximized] = useState(false)
  const [activePreset, setActivePreset] = useState<OverlaySizePreset | null>('medium')
  const resizingRef = useRef(false)
  const movingRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const resizeStartRef = useRef<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

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

  const refreshBounds = useCallback(async () => {
    const b = await window.interviewPulse?.getOverlayBounds?.()
    if (!b?.ok && b?.width == null) return
    if (b.width != null && b.height != null) {
      setSizeLabel(`${b.width}×${b.height}`)
    }
    if (typeof b.maximized === 'boolean') setMaximized(b.maximized)
  }, [])

  useEffect(() => {
    document.body.style.background = 'transparent'
    // Opening the overlay always restores mouse interaction so drag/move works.
    // Click-through can be re-enabled via the eye button after you're positioned.
    updateStealth({ clickThrough: false })
    void window.interviewPulse?.setClickThrough(false)
    void window.interviewPulse?.setOverlayOpacity(stealth.opacity)
    void window.interviewPulse?.setContentProtection(stealth.contentProtection)
    void refreshBounds()

    const unsub = window.interviewPulse?.onToggleClickThrough?.(() => {
      const next = !useAppStore.getState().stealth.clickThrough
      updateStealth({ clickThrough: next })
      void window.interviewPulse?.setClickThrough(next)
    })

    // Receive answers from the main copilot window (separate Electron heap).
    // Use setState (not setAnswer/setLevels) so we don't re-publish and loop.
    const unsubLive = subscribeLiveSync((payload) => {
      const patch: {
        answer?: typeof payload.answer
        listening?: boolean
        levels?: number[]
        answerMode?: AnswerMode
      } = {}
      if (payload.answer !== undefined) patch.answer = payload.answer
      if (typeof payload.listening === 'boolean') patch.listening = payload.listening
      if (Array.isArray(payload.levels) && payload.levels.length) {
        patch.levels = payload.levels
      }
      if (payload.answerMode) patch.answerMode = payload.answerMode as AnswerMode
      if (Object.keys(patch).length) {
        useAppStore.setState(patch)
      }
    })

    const onResize = () => {
      setActivePreset(null)
      void refreshBounds()
    }
    window.addEventListener('resize', onResize)

    return () => {
      unsub?.()
      unsubLive()
      window.removeEventListener('resize', onResize)
      document.body.style.background = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, [])

  useEffect(() => {
    void window.interviewPulse?.setOverlayOpacity(stealth.opacity)
  }, [stealth.opacity])

  useEffect(() => {
    void window.interviewPulse?.setContentProtection(stealth.contentProtection)
  }, [stealth.contentProtection])

  useEffect(() => {
    setCardIndex(0)
  }, [answer?.id])

  const applyPreset = async (preset: OverlaySizePreset) => {
    setActivePreset(preset)
    const res = await window.interviewPulse?.setOverlayPreset?.(preset)
    if (res?.width != null && res?.height != null) {
      setSizeLabel(`${res.width}×${res.height}`)
    }
    setMaximized(preset === 'max')
  }

  const toggleMaximize = async () => {
    const res = await window.interviewPulse?.toggleOverlayMaximize?.()
    if (res?.width != null && res?.height != null) {
      setSizeLabel(`${res.width}×${res.height}`)
    }
    if (typeof res?.maximized === 'boolean') {
      setMaximized(res.maximized)
      setActivePreset(res.maximized ? 'max' : null)
    }
  }

  const resetPosition = async () => {
    updateStealth({ clickThrough: false })
    void window.interviewPulse?.setClickThrough(false)
    const res = await window.interviewPulse?.resetOverlayPosition?.()
    if (res?.width != null) {
      setSizeLabel(`${res.width}×${res.height}`)
      setMaximized(false)
      setActivePreset('medium')
    }
  }

  // --- Move (manual pointer drag — works when -webkit-app-region fails on Win) ---
  const onMovePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (stealth.clickThrough) return
    // Don't start move from buttons
    const t = e.target as HTMLElement
    if (t.closest('button, input, select, a')) return
    e.preventDefault()
    movingRef.current = true
    lastPointerRef.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onMovePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!movingRef.current || !lastPointerRef.current) return
    const dx = e.screenX - lastPointerRef.current.x
    const dy = e.screenY - lastPointerRef.current.y
    lastPointerRef.current = { x: e.screenX, y: e.screenY }
    if (dx === 0 && dy === 0) return
    void window.interviewPulse?.moveOverlayBy?.({ x: dx, y: dy })
  }

  const onMovePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!movingRef.current) return
    movingRef.current = false
    lastPointerRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    void refreshBounds()
  }

  // --- Resize handle ---
  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.interviewPulse?.setOverlayBounds) return
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = true
    resizeStartRef.current = {
      x: e.screenX,
      y: e.screenY,
      w: window.innerWidth,
      h: window.innerHeight,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current || !resizeStartRef.current) return
    const start = resizeStartRef.current
    const dw = e.screenX - start.x
    const dh = e.screenY - start.y
    void window.interviewPulse?.setOverlayBounds?.({
      width: Math.round(start.w + dw),
      height: Math.round(start.h + dh),
    })
  }

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return
    resizingRef.current = false
    resizeStartRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    setActivePreset(null)
    void refreshBounds()
  }

  return (
    <div className="relative flex h-screen flex-col bg-transparent p-2.5 text-white sm:p-3">
      {stealth.clickThrough && (
        <div
          className="mb-2 rounded-[14px] border border-[#E8C547]/40 bg-[#E8C547]/15 px-3 py-2 text-[11px] text-[#E8C547]"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          Click-through is ON — mouse passes through this window. Press the{' '}
          <strong>eye</strong> icon (or Ctrl+Shift+C) to interact and drag again.
        </div>
      )}

      {/* Title bar — primary move surface */}
      <div
        className={cn(
          'glass mb-2 flex shrink-0 cursor-grab items-center justify-between rounded-[16px] px-2.5 py-2 active:cursor-grabbing sm:mb-3 sm:rounded-[18px] sm:px-3 sm:py-2.5',
          stealth.clickThrough && 'opacity-60',
        )}
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        onPointerDown={onMovePointerDown}
        onPointerMove={onMovePointerMove}
        onPointerUp={onMovePointerUp}
        onPointerCancel={onMovePointerUp}
        onDoubleClick={() => void toggleMaximize()}
        title="Drag this bar to move the overlay · double-click to expand"
      >
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-white/55">
          <GripHorizontal className="h-4 w-4 shrink-0 text-[#5DD5E3]" strokeWidth={1.5} />
          <span className="truncate font-medium text-white/70">Drag to move</span>
          <Badge tone={listening ? 'emerald' : 'default'}>
            {listening ? 'live' : 'idle'}
          </Badge>
          {sizeLabel ? (
            <span className="hidden truncate text-[10px] text-white/30 sm:inline">
              {sizeLabel}
            </span>
          ) : null}
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            size="icon"
            variant="ghost"
            title="Reset position (if stuck)"
            onClick={() => void resetPosition()}
          >
            <span className="text-[10px] font-semibold text-white/50">⌂</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={chromeCollapsed ? 'Show controls' : 'Hide controls'}
            onClick={() => setChromeCollapsed((v) => !v)}
          >
            {chromeCollapsed ? (
              <PanelTopOpen className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <PanelTopClose className="h-4 w-4" strokeWidth={1.5} />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={maximized ? 'Restore size' : 'Expand to fill screen'}
            onClick={() => void toggleMaximize()}
          >
            {maximized ? (
              <Minimize2 className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={
              stealth.clickThrough
                ? 'Click-through ON — click to interact again'
                : 'Click-through OFF — click so mouse passes through'
            }
            onClick={() => {
              const next = !stealth.clickThrough
              updateStealth({ clickThrough: next })
              void window.interviewPulse?.setClickThrough(next)
            }}
          >
            {stealth.clickThrough ? (
              <EyeOff className="h-4 w-4 text-[#E8C547]" strokeWidth={1.5} />
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

      {!chromeCollapsed && (
        <div
          className="mb-2 flex shrink-0 flex-col gap-2 sm:mb-3"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <div className="glass flex flex-wrap items-center gap-1.5 rounded-[16px] px-2.5 py-2">
            <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-white/35">
              Size
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.title}
                onClick={() => void applyPreset(p.id)}
                className={cn(
                  'h-7 min-w-[2rem] rounded-lg px-2 text-[11px] font-medium transition-colors',
                  activePreset === p.id
                    ? 'bg-[#20B8CD] text-[#0C0C0C]'
                    : 'bg-white/[0.06] text-white/55 hover:bg-white/[0.1] hover:text-white/85',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="glass flex items-center gap-3 rounded-[16px] px-3 py-2">
            <Waveform levels={levels} active={listening} className="h-8 flex-1" />
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(stealth.opacity * 100)}
              title="Opacity"
              onChange={(e) => {
                const opacity = Number(e.target.value) / 100
                updateStealth({ opacity })
                void window.interviewPulse?.setOverlayOpacity(opacity)
              }}
              className="w-20 shrink-0 accent-[#20B8CD] sm:w-28"
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-[20px] sm:rounded-[24px]">
        <WhisperStream
          compact
          cards={cards}
          cardIndex={cardIndex}
          onCardIndex={setCardIndex}
          mode={answerMode}
          onMode={setAnswerMode}
          preparing={Boolean(answer?.streaming)}
        />
      </div>

      <div
        className="absolute bottom-1 right-1 z-20 flex h-7 w-7 cursor-nwse-resize items-end justify-end p-1"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        title="Drag to resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          className="text-white/35"
          aria-hidden
        >
          <path
            d="M12 2 L2 12 M12 6 L6 12 M12 10 L10 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  )
}
