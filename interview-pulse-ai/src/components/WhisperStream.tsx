import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  extractAtomicPunchline,
  planSpeakCanvas,
  starFieldWeights,
  type BeatRole,
} from '@/lib/speak-canvas-engine'
import {
  getSpeakHighlightsBudgeted,
  type SpeakHighlightSpan,
} from '@/lib/speak-highlight'
import {
  keywordMagnitude,
  lensedDisplayScale,
  orbitalShell,
  segmentForNeuro,
} from '@/lib/speak-neuro-astro'
import { buildSpeakSheetFromAnswer, chipsFromSpans } from '@/lib/speak-impact'
import {
  advanceSpeakLadder,
  chipBudget,
  ladderCue,
  SOFT_DIM_OPACITY,
  shouldCoolPulse,
  shouldLandPulse,
  type SpeakLadderStep,
} from '@/lib/speak-psych-hacks'
import { craftCoolSignoff } from '@/lib/speak-cool-line'
import { planAskRail, type AskPlan } from '@/lib/speak-ask-engine'
import { cn } from '@/lib/utils'
import type { AnswerMode, QACard } from '@/types'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Expand,
  Loader2,
  Minimize2,
  PictureInPicture2,
} from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

type Spotlight = 'all' | 'hook' | 'proof' | 'close' | 'ask' | 'cool'

const modes: { id: AnswerMode; label: string; hint: string }[] = [
  { id: 'shorter', label: 'Shorter', hint: '3 tight lines' },
  { id: 'technical', label: 'Technical', hint: 'depth + tradeoffs' },
  { id: 'star', label: 'STAR', hint: 'S/T/A/R story' },
  { id: 'code', label: 'Code', hint: 'sketch + speak' },
]

const READY_RAILS = [
  { id: 'hook', label: 'Hook', hint: 'Open with the claim' },
  { id: 'proof', label: 'Proof', hint: 'Action + evidence' },
  { id: 'close', label: 'Close', hint: 'Land the result' },
  {
    id: 'ask',
    label: 'Ask',
    hint: 'One reverse question — when the room is ready',
  },
  {
    id: 'cool',
    label: 'Cool',
    hint: 'Calm sign-off if Ask is silent',
  },
] as const

/** End rail: Ask supersedes Cool when gates fire (research v3). */
function EndSignalRails({
  askPlan,
  coolLine,
  isDim,
  landPulse,
  coolPulse,
  spotlight,
  onAskFocus,
  onCoolFocus,
}: {
  askPlan: AskPlan
  coolLine: string
  isDim: (role: BeatRole) => boolean
  landPulse: boolean
  coolPulse: boolean
  spotlight: Spotlight
  onAskFocus: () => void
  onCoolFocus: () => void
}) {
  if (askPlan.show && askPlan.question) {
    return (
      <OrbitBeat
        role="ask"
        label="ASK"
        scale={1.06}
        wide
        fullText={askPlan.question}
        dimmed={isDim('ask')}
        active={spotlight === 'ask' || landPulse}
        onFocus={onAskFocus}
      >
        <p className="speak-ask-line text-[15px] leading-snug text-[#E8F4FF]/95">
          {askPlan.question}
        </p>
        {askPlan.why ? (
          <p className="speak-ask-why mt-1.5 text-[11px] leading-snug text-white/35">
            {askPlan.why}
          </p>
        ) : null}
      </OrbitBeat>
    )
  }
  if (coolLine) {
    return (
      <OrbitBeat
        role="cool"
        label="COOL"
        scale={1.05}
        wide
        fullText={coolLine}
        dimmed={isDim('cool')}
        active={spotlight === 'cool' || coolPulse}
        onFocus={onCoolFocus}
      >
        <p className="speak-cool-line text-[15px] leading-snug text-[#E8C547]/95">
          {coolLine}
        </p>
      </OrbitBeat>
    )
  }
  return null
}

/**
 * Neuro-astro render: full text always present.
 * Fovea (first ~11 words) full luminance; periphery slightly dimmer.
 * Impact spans get gravitational magnitude classes (O/B/A/F/G).
 * Zero words deleted.
 */
function HighlightedText({
  text,
  spans,
  className,
}: {
  text: string
  spans: SpeakHighlightSpan[]
  className?: string
}) {
  const segments = useMemo(() => segmentForNeuro(text), [text])
  const magSpans = useMemo(() => {
    const L = text.length
    return [...spans]
      .filter((s) => s.end > s.start && s.start >= 0 && s.start < L)
      .map((s) => {
        const m = keywordMagnitude(s.kind, s.start, L)
        return {
          ...s,
          end: Math.min(s.end, L),
          css: m.cssClass,
          mass: m.mass,
        }
      })
      .sort((a, b) => a.start - b.start)
  }, [spans, text])

  // Walk text with absolute offsets so highlights align with original string
  let cursor = 0
  const nodes: ReactNode[] = []
  let key = 0

  for (const seg of segments) {
    const segStart = cursor
    const segEnd = cursor + seg.text.length
    cursor = segEnd

    // Slice this segment with any overlapping highlights
    let local = segStart
    const covering = magSpans.filter(
      (s) => s.end > segStart && s.start < segEnd,
    )
    if (!covering.length) {
      nodes.push(
        <span
          key={key++}
          className={cn(
            seg.foveal ? 'speak-fovea' : 'speak-periphery',
            'speak-phrase',
          )}
        >
          {seg.text}
        </span>,
      )
      continue
    }
    for (const s of covering) {
      const from = Math.max(s.start, segStart)
      const to = Math.min(s.end, segEnd)
      if (from > local) {
        nodes.push(
          <span
            key={key++}
            className={cn(
              seg.foveal ? 'speak-fovea' : 'speak-periphery',
              'speak-phrase',
            )}
          >
            {text.slice(local, from)}
          </span>,
        )
      }
      if (to > from) {
        nodes.push(
          <strong
            key={key++}
            className={cn('speak-keyword', s.css)}
            data-mass={s.mass.toFixed(2)}
          >
            {text.slice(from, to)}
          </strong>,
        )
      }
      local = Math.max(local, to)
    }
    if (local < segEnd) {
      nodes.push(
        <span
          key={key++}
          className={cn(
            seg.foveal ? 'speak-fovea' : 'speak-periphery',
            'speak-phrase',
          )}
        >
          {text.slice(local, segEnd)}
        </span>,
      )
    }
  }

  return <span className={className}>{nodes}</span>
}

/**
 * HOOK / PROOF / CLOSE card — expand/collapse + drag-resize height.
 * Auto glance collapse can be overridden by the user at any time.
 */
function OrbitBeat({
  role,
  label,
  children,
  scale,
  opacity,
  collapsed,
  fullText,
  dimmed,
  active,
  onFocus,
  wide,
}: {
  role: BeatRole
  label: string
  children: ReactNode
  scale: number
  opacity?: number
  collapsed?: boolean
  fullText?: string
  /** Spotlight: non-focused beats soft-dim (text still fully present) */
  dimmed?: boolean
  active?: boolean
  onFocus?: () => void
  /** Stretch card across the Speak panel (not 66ch) */
  wide?: boolean
}) {
  const shell = orbitalShell(role)
  /** null = follow engine collapsed; true/false = user override */
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [bodyHeight, setBodyHeight] = useState<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)

  // New card text → reset user size overrides (spotlight collapse stays free to override)
  useEffect(() => {
    setManualOpen(null)
    setBodyHeight(null)
  }, [fullText])

  const isOpen = manualOpen !== null ? manualOpen : !collapsed

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const h = bodyRef.current?.offsetHeight ?? 72
    resizeRef.current = { startY: e.clientY, startH: h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    const next = Math.max(
      48,
      Math.min(560, resizeRef.current.startH + (e.clientY - resizeRef.current.startY)),
    )
    setBodyHeight(next)
    if (!isOpen) setManualOpen(true)
  }

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const toggleOpen = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    setManualOpen((prev) => {
      const currentlyOpen = prev !== null ? prev : !collapsed
      return !currentlyOpen
    })
    // Clear fixed height when expanding so content can size naturally
    setBodyHeight(null)
  }

  return (
    <li
      className={cn(
        'speak-beat speak-orbit speak-rail-card relative list-none rounded-[14px] px-3.5 py-2.5 transition-[opacity,box-shadow] duration-200',
        `speak-orbit-${shell}`,
        role === 'hook' && 'speak-beat-hook',
        role === 'proof' && 'speak-beat-peak',
        role === 'close' && 'speak-beat-close',
        role === 'cool' && 'speak-beat-cool',
        role === 'support' && 'speak-beat-support',
        active && 'speak-beat-active',
        dimmed && 'speak-beat-dimmed',
        wide && 'w-full',
        isOpen && 'speak-rail-card-open',
      )}
      style={{
        opacity:
          dimmed
            ? SOFT_DIM_OPACITY
            : opacity != null && opacity < 0.99
              ? opacity
              : undefined,
      }}
      title={
        !isOpen && fullText
          ? fullText
          : 'Click label to focus · chevron expands · drag bottom edge to resize'
      }
      onClick={onFocus}
      onMouseEnter={(e) => {
        if (dimmed) (e.currentTarget as HTMLElement).style.opacity = '1'
      }}
      onMouseLeave={(e) => {
        if (dimmed)
          (e.currentTarget as HTMLElement).style.opacity = String(SOFT_DIM_OPACITY)
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="speak-rail-label">{label}</span>
        <div className="flex items-center gap-1.5">
          {active && isOpen ? (
            <span className="text-[10px] text-[#5DD5E3]/70">speak</span>
          ) : null}
          {!isOpen ? (
            <span className="text-[10px] text-white/30">collapsed</span>
          ) : null}
          <button
            type="button"
            className="speak-rail-toggle"
            title={isOpen ? 'Collapse card' : 'Expand card'}
            aria-expanded={isOpen}
            onClick={toggleOpen}
          >
            {isOpen ? (
              <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
      <div
        ref={bodyRef}
        className={cn(
          'speak-body min-w-0 leading-[1.65] text-white/90',
          !isOpen && 'line-clamp-2',
          isOpen && bodyHeight != null && 'speak-rail-body-scroll',
        )}
        style={{
          fontSize: `${15.5 * scale}px`,
          height: isOpen && bodyHeight != null ? bodyHeight : undefined,
          maxHeight: !isOpen ? undefined : bodyHeight != null ? bodyHeight : undefined,
        }}
      >
        {children}
      </div>
      {/* Drag bottom edge to grow/shrink card height */}
      {isOpen ? (
        <div
          className="speak-rail-resize"
          title="Drag to adjust card height"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
    </li>
  )
}

/** Empty scaffold rails — same expand/resize affordance before answer lands */
function ReadyRails({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('w-full space-y-3', compact ? 'py-2' : 'py-4')}>
      <div className="mb-1">
        <p className="text-[15px] font-medium tracking-tight text-white/80">
          Ready to speak
        </p>
        <p className="speak-body-secondary mt-1">
          {compact
            ? 'Answers stream here from the main window.'
            : 'Type a question and press Answer — scaffold fills as you go. Expand or drag card edges to fit your screen.'}
        </p>
      </div>
      {READY_RAILS.map((rail) => (
        <ReadyRailCard key={rail.id} rail={rail} compact={compact} />
      ))}
    </div>
  )
}

function ReadyRailCard({
  rail,
  compact,
}: {
  rail: (typeof READY_RAILS)[number]
  compact?: boolean
}) {
  const [open, setOpen] = useState(true)
  const [height, setHeight] = useState<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const h = bodyRef.current?.offsetHeight ?? (compact ? 40 : 56)
    resizeRef.current = { startY: e.clientY, startH: h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    setHeight(
      Math.max(
        36,
        Math.min(320, resizeRef.current.startH + (e.clientY - resizeRef.current.startY)),
      ),
    )
    if (!open) setOpen(true)
  }
  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={cn(
        'speak-rail-card relative w-full rounded-[14px] border border-dashed border-white/[0.1] bg-white/[0.02] px-4 py-3',
        compact && 'px-3 py-2.5',
        open && 'speak-rail-card-open',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="speak-rail-label">{rail.label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/25">{rail.hint}</span>
          <button
            type="button"
            className="speak-rail-toggle"
            title={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
      {open ? (
        <>
          <div
            ref={bodyRef}
            className="mt-2.5 space-y-1.5 opacity-40"
            style={{
              height: height ?? undefined,
              minHeight: height ? undefined : compact ? 28 : 36,
            }}
          >
            <div className="h-2 w-[70%] max-w-full rounded bg-white/[0.08]" />
            <div className="h-2 w-[45%] max-w-full rounded bg-white/[0.05]" />
            {!compact && height && height > 64 ? (
              <div className="h-2 w-[55%] max-w-full rounded bg-white/[0.04]" />
            ) : null}
          </div>
          <div
            className="speak-rail-resize"
            title="Drag to adjust card height"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
          />
        </>
      ) : (
        <p className="mt-1.5 text-[11px] text-white/25">Collapsed — expand when ready</p>
      )}
    </div>
  )
}

function ImpactChipStrip({
  chips,
}: {
  chips: Array<{ text: string; kind: string }>
}) {
  if (!chips.length) return null
  return (
    <div className="speak-impact-strip w-full" aria-label="Impact words">
      {chips.map((c, i) => (
        <span
          key={`${c.text}-${i}`}
          className={cn('speak-impact-chip', `speak-impact-${c.kind}`)}
        >
          {c.text}
        </span>
      ))}
    </div>
  )
}

function PathRail({
  spotlight,
  onSpot,
  completeness,
  streaming,
  focusMode,
  processMode,
}: {
  spotlight: Spotlight
  onSpot: (s: Spotlight) => void
  completeness: number
  streaming?: boolean
  focusMode?: boolean
  processMode?: 'glance' | 'depth'
}) {
  const items: { id: Spotlight; label: string; key: string }[] = [
    { id: 'hook', label: 'Hook', key: '1' },
    { id: 'proof', label: 'Proof', key: '2' },
    { id: 'close', label: 'Close', key: '3' },
    { id: 'ask', label: 'Ask', key: '4' },
    { id: 'cool', label: 'Cool', key: '5' },
  ]
  // Focus mode: show only active step + ladder cue (choice overload / Iyengar)
  if (focusMode && spotlight !== 'all') {
    const active = items.find((it) => it.id === spotlight)
    return (
      <div className="speak-path-rail speak-path-rail-focus">
        <div className="speak-path-steps">
          <button
            type="button"
            className="speak-path-step is-active"
            onClick={() => onSpot('all')}
            title="Show all (0 / Esc)"
          >
            <span className="speak-path-key">{active?.key ?? '·'}</span>
            {active?.label ?? 'Speak'}
          </button>
          <span className="speak-path-focus-cue" aria-live="polite">
            Space advances · Esc all
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="speak-path-rail">
      <div className="speak-path-steps">
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            className={cn(
              'speak-path-step',
              spotlight === it.id && 'is-active',
              spotlight === 'all' && 'is-idle',
            )}
            onClick={() => onSpot(spotlight === it.id ? 'all' : it.id)}
            title={`Focus ${it.label} (key ${it.key})`}
          >
            <span className="speak-path-key">{it.key}</span>
            {it.label}
            {i < items.length - 1 ? (
              <span className="speak-path-arrow" aria-hidden>
                →
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className={cn('speak-path-step', spotlight === 'all' && 'is-active')}
          onClick={() => onSpot('all')}
          title="Show all beats (key 0)"
        >
          All
        </button>
        {processMode ? (
          <span
            className={cn(
              'speak-path-mode',
              processMode === 'glance' && 'is-glance',
            )}
            title={
              processMode === 'glance'
                ? 'Glance: Hook · Proof · Close · Ask'
                : 'Depth: full rails'
            }
          >
            {processMode === 'glance' ? 'Glance' : 'Depth'}
          </span>
        ) : null}
      </div>
      {/* Completeness only while streaming — sealed bar is theater */}
      {streaming ? (
        <div
          className="speak-complete-track"
          title={`Streaming ${Math.round(completeness * 100)}%`}
        >
          <div
            className="speak-complete-fill"
            style={{ width: `${Math.round(completeness * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

// Speak surface stays clean: layout math runs in speak-canvas-engine for
// highlight budgets / type scale only — no psych/ML "skills" UI while reading.

function SpeakRailsSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('w-full space-y-3', compact ? 'space-y-2.5' : 'space-y-3')}>
      {READY_RAILS.map((rail, i) => (
        <div
          key={rail.id}
          className={cn(
            'speak-rail-card w-full rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-4 py-3',
            compact && 'px-3 py-2.5',
          )}
        >
          <div className="speak-rail-label mb-2">{rail.label}</div>
          <div className="space-y-2">
            <div
              className="speak-skeleton-line"
              style={{ width: i === 0 ? '72%' : i === 1 ? '88%' : '64%' }}
            />
            {i === 1 && !compact && (
              <div className="speak-skeleton-line" style={{ width: '54%' }} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function MetricsChips({ metrics }: { metrics: string[] }) {
  const shown = metrics.filter(Boolean).slice(0, 6)
  if (!shown.length) return null
  return (
    <div className="speak-measure flex flex-wrap gap-1.5 pt-1">
      {shown.map((m, i) => (
        <span key={`${m}-${i}`} className="speak-metric-chip" title={m}>
          {m}
        </span>
      ))}
    </div>
  )
}

/** Freeze-friendly highlight allocation for a card while streaming. */
function useFrozenHighlights(
  cardId: string | undefined,
  parts: string[],
  streaming: boolean,
  question?: string,
): SpeakHighlightSpan[][] {
  const freezeKeyRef = useRef<string>('')
  const frozenPartsRef = useRef<SpeakHighlightSpan[][] | null>(null)
  // Content signature so we recompute when text changes (not array identity)
  const partsKey = parts.join('\u0001')

  return useMemo(() => {
    const key = cardId ?? ''
    if (!key) {
      frozenPartsRef.current = null
      freezeKeyRef.current = ''
      return parts.map(() => [])
    }

    // New card → reset freeze
    if (freezeKeyRef.current !== key) {
      freezeKeyRef.current = key
      frozenPartsRef.current = null
    }

    const frozenHasHits = Boolean(
      frozenPartsRef.current?.some((p) => p.length > 0),
    )

    // Once we have a non-empty freeze set, hold it for the rest of the stream
    // so spans do not reshuffle as tokens append.
    if (streaming && frozenHasHits && frozenPartsRef.current) {
      return getSpeakHighlightsBudgeted(parts, {
        freeze: true,
        frozenParts: frozenPartsRef.current,
        max: 10,
        question,
      })
    }

    const next = getSpeakHighlightsBudgeted(parts, { max: 10, question })
    if (streaming) {
      // Keep scanning until first hits, then freeze; empty freeze is not sticky.
      if (next.some((p) => p.length > 0)) {
        frozenPartsRef.current = next
      }
      return next
    }

    // Streaming ended → one refresh to the final highlight set
    frozenPartsRef.current = next
    return next
    // partsKey tracks text content; parts used for values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, partsKey, streaming, question])
}

export const WhisperStream = memo(function WhisperStream({
  cards,
  cardIndex,
  onCardIndex,
  mode,
  onMode,
  preparing,
  regenerating,
  compact,
  expanded,
  onToggleExpand,
  onDetach,
  detaching,
  /** Overlay Hide: strip Speak chrome so answer body pulls to top (red-mark line) */
  chromeHidden,
}: {
  cards: QACard[]
  cardIndex: number
  onCardIndex: (i: number) => void
  mode: AnswerMode
  onMode: (m: AnswerMode) => void
  preparing?: boolean
  regenerating?: boolean
  compact?: boolean
  /** In-app full-pane expand (main window) */
  expanded?: boolean
  onToggleExpand?: () => void
  /** Pop out to overlay / browser popup */
  onDetach?: () => void
  detaching?: boolean
  /**
   * Hide Speak chrome (title, path rail, modes, Q, scaffold label, footer)
   * so ANSWER / PROOF rails sit under the floating Show pill.
   */
  chromeHidden?: boolean
}) {
  const card = cards[cardIndex] ?? null
  const total = cards.length
  const canPrev = cardIndex > 0
  const canNext = cardIndex < total - 1
  const answer = card?.answer
  const bullets = answer?.bullets?.filter(Boolean) ?? []
  const metrics = answer?.metrics?.filter(Boolean) ?? []
  /** OpenAI bar: progressive disclosure never permanently loses answer text */
  const [expandFull, setExpandFull] = useState(false)
  const [spotlight, setSpotlight] = useState<Spotlight>('all')
  const [copied, setCopied] = useState(false)
  /** Focus mode: hide chips after settle (reduce choice overload) */
  const [focusMode, setFocusMode] = useState(false)
  const [landPulse, setLandPulse] = useState(false)
  /** Cool peak–end pulse (warmth after competence land) */
  const [coolPulse, setCoolPulse] = useState(false)
  /** Commitment lock: first atomic punch token freezes for the card */
  const punchLockRef = useRef<{ cardId: string; token: string } | null>(null)
  const wasStreamingRef = useRef(false)
  /** Session Ask budget (research: sparse; max ~2). */
  const askSessionCountRef = useRef(0)
  const askCountedCardRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setExpandFull(false)
    setSpotlight('all')
    setCopied(false)
    setFocusMode(false)
    setLandPulse(false)
    setCoolPulse(false)
    punchLockRef.current = null
    wasStreamingRef.current = false
  }, [card?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return
      }
      // 1–5: Hook / Proof / Close / Ask / Cool; 0 or Esc = all
      if (e.key === '1') {
        e.preventDefault()
        setSpotlight((s) => (s === 'hook' ? 'all' : 'hook'))
        setFocusMode(true)
      } else if (e.key === '2') {
        e.preventDefault()
        setSpotlight((s) => (s === 'proof' ? 'all' : 'proof'))
        setFocusMode(true)
      } else if (e.key === '3') {
        e.preventDefault()
        setSpotlight((s) => (s === 'close' ? 'all' : 'close'))
        setFocusMode(true)
      } else if (e.key === '4') {
        e.preventDefault()
        setSpotlight((s) => (s === 'ask' ? 'all' : 'ask'))
        setFocusMode(true)
      } else if (e.key === '5') {
        e.preventDefault()
        setSpotlight((s) => (s === 'cool' ? 'all' : 'cool'))
        setFocusMode(true)
      } else if (e.key === '0' || e.key === 'Escape') {
        setSpotlight('all')
        setFocusMode(false)
      } else if (e.key === ' ' || e.code === 'Space') {
        // Speak ladder: Hook → Proof → Close → Ask → Cool
        e.preventDefault()
        setSpotlight((s) => {
          const step = (s === 'all' ? 'all' : s) as SpeakLadderStep | 'all'
          const next = advanceSpeakLadder(step === 'all' ? 'all' : step)
          if (next === 'done') {
            setFocusMode(false)
            return 'all'
          }
          setFocusMode(true)
          return next as Spotlight
        })
      } else if (e.key === 'f' || e.key === 'F') {
        setFocusMode((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const answerBodyText = useMemo(() => {
    if (!card?.answer) return ''
    return (
      (card.answer.bullets || []).join('\n') ||
      [
        card.answer.star?.situation,
        card.answer.star?.task,
        card.answer.star?.action,
        card.answer.star?.result,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }, [card])

  const askPlan = useMemo((): AskPlan => {
    if (!card?.answer || !answerBodyText.trim() || card.answer.streaming) {
      return planAskRail({
        answerText: '',
        streaming: true,
      })
    }
    return planAskRail({
      answerText: answerBodyText,
      question: card.question || card.answer.question,
      streaming: false,
      cardIndex,
      asksShownThisSession: askSessionCountRef.current,
      maxAsksPerSession: 2,
    })
  }, [card, answerBodyText, cardIndex])

  // Count Ask fires once per card for session budget
  useEffect(() => {
    if (!card?.id || !askPlan.show) return
    if (askCountedCardRef.current.has(card.id)) return
    askCountedCardRef.current.add(card.id)
    askSessionCountRef.current += 1
  }, [card?.id, askPlan.show])

  const coolLine = useMemo(() => {
    if (!card?.answer || !answerBodyText.trim() || card.answer.streaming) return ''
    // Ask supersedes Cool when gates fire
    if (askPlan.show) return ''
    return craftCoolSignoff({
      answerText: answerBodyText,
      question: card.question || card.answer.question,
      mode: card.answer.mode,
    })
  }, [card, answerBodyText, askPlan.show])

  const copySpeakSheet = useCallback(async () => {
    if (!card?.answer) return
    let sheet = buildSpeakSheetFromAnswer({
      star: card.answer.star,
      bullets: card.answer.bullets,
    })
    if (askPlan.show && askPlan.question) {
      sheet = sheet
        ? `${sheet}\n\nAsk\n${askPlan.question}`
        : `Ask\n${askPlan.question}`
    } else if (coolLine) {
      sheet = sheet ? `${sheet}\n\nCool\n${coolLine}` : `Cool\n${coolLine}`
    }
    if (!sheet) return
    try {
      await navigator.clipboard.writeText(sheet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }, [card, coolLine, askPlan])
  const streaming = Boolean(answer?.streaming)

  // Peak-end: Close land pulse, then Cool warmth pulse, then focus mode
  useEffect(() => {
    const was = wasStreamingRef.current
    if (shouldLandPulse(was, streaming, true) && card?.id) {
      setLandPulse(true)
      // Cool pulse slightly after Close (warmth after competence)
      const tCool = window.setTimeout(() => {
        if (shouldCoolPulse(true, false, true)) {
          setCoolPulse(true)
          window.setTimeout(() => setCoolPulse(false), 1400)
        }
      }, 700)
      // Focus mode after settle — fewer affordances under cortisol
      const t = window.setTimeout(() => setFocusMode(true), 1400)
      const t2 = window.setTimeout(() => setLandPulse(false), 1600)
      wasStreamingRef.current = streaming
      return () => {
        window.clearTimeout(t)
        window.clearTimeout(t2)
        window.clearTimeout(tCool)
      }
    }
    wasStreamingRef.current = streaming
  }, [streaming, card?.id])

  const hasStarBody = Boolean(
    answer?.star?.situation ||
      answer?.star?.task ||
      answer?.star?.action ||
      answer?.star?.result,
  )
  const hasBody =
    bullets.length > 0 || Boolean(answer?.codeSnippet) || hasStarBody

  // Highlight parts: bullets OR STAR Action/Result (Situation/Task not highlighted)
  const starAction = answer?.star?.action ?? ''
  const starResult = answer?.star?.result ?? ''
  const useStarLayout =
    answer?.mode === 'star' && answer.star && hasStarBody

  const bulletsKey = bullets.join('\u0001')
  const questionText = card?.question ?? ''
  const highlightParts = useMemo(() => {
    if (useStarLayout) {
      return [starAction, starResult]
    }
    if (bullets.length <= 1) {
      return [bullets[0] || answer?.bullets?.join('\n') || '']
    }
    return bullets
    // bulletsKey tracks content; bullets/answer used for values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useStarLayout, starAction, starResult, bulletsKey])

  const highlightSets = useFrozenHighlights(
    card?.id,
    highlightParts,
    streaming,
    questionText,
  )

  let speakBody: ReactNode = null

  // Layout plan only (no psych chrome) — adaptive load / dual-process
  const canvasStats = useMemo(() => {
    const parts = useStarLayout
      ? [starAction, starResult].filter(Boolean)
      : bullets.length
        ? bullets
        : []
    const hits = highlightSets.reduce((n, s) => n + s.length, 0)
    return planSpeakCanvas(parts, {
      highlightHits: hits,
      streaming,
    })
  }, [useStarLayout, starAction, starResult, bulletsKey, highlightSets, streaming])

  const impactChips = useMemo(() => {
    const parts = useStarLayout
      ? [starAction, starResult].filter(Boolean)
      : bullets.length
        ? bullets
        : []
    const max = chipBudget({
      spotlightActive: spotlight !== 'all',
      focusMode,
      expanded: expandFull,
    })
    if (max <= 0) return []
    return chipsFromSpans(parts, highlightSets, max)
  }, [
    useStarLayout,
    starAction,
    starResult,
    bulletsKey,
    highlightSets,
    spotlight,
    focusMode,
    expandFull,
  ])

  const ladderHint = ladderCue(
    spotlight === 'all' ? 'all' : (spotlight as SpeakLadderStep),
  )

  const isDim = (role: BeatRole) =>
    spotlight !== 'all' && role !== spotlight && role !== 'support'
      ? true
      : spotlight !== 'all' && role === 'support'
        ? true
        : false

  if (card && hasBody) {
    if (useStarLayout && answer?.star) {
      const starFields = starFieldWeights().filter(
        (f) => Boolean(answer.star?.[f.key]),
      )
      const proofIdx = 2 // Action peak in STAR order S T A R

      speakBody = (
        <div className="w-full space-y-3">
          <ImpactChipStrip chips={impactChips} />
          <ul className="grid w-full gap-2.5">
            {starFields.map((f, i) => {
              const t = answer.star![f.key]!
              const isAction = f.weight === 'primary'
              const isMuted = f.weight === 'muted' && !expandFull
              const hlIndex =
                f.key === 'action' ? 0 : f.key === 'result' ? 1 : -1
              const spans = hlIndex >= 0 ? highlightSets[hlIndex] ?? [] : []
              const scale = lensedDisplayScale(
                isAction ? 1.08 : f.key === 'result' ? 1.02 : 0.92,
                f.role,
                proofIdx,
                i,
              )
              // Peak-end: Result never permanently muted when spotlight is close/all
              const collapsed =
                isMuted && spotlight !== 'close' && spotlight !== 'all'
              return (
                <OrbitBeat
                  key={f.key}
                  role={f.role}
                  label={f.label}
                  scale={scale}
                  collapsed={collapsed}
                  fullText={t}
                  dimmed={isDim(f.role)}
                  wide
                  active={
                    spotlight === f.role ||
                    (landPulse && f.role === 'close')
                  }
                  onFocus={() => {
                    const r = f.role
                    if (
                      r !== 'hook' &&
                      r !== 'proof' &&
                      r !== 'close' &&
                      r !== 'cool' &&
                      r !== 'ask'
                    )
                      return
                    setSpotlight((s) => (s === r ? 'all' : r))
                    setFocusMode(true)
                  }}
                >
                  <HighlightedText text={t} spans={spans} />
                </OrbitBeat>
              )
            })}
            {!streaming ? (
              <li className="list-none w-full">
                <EndSignalRails
                  askPlan={askPlan}
                  coolLine={coolLine}
                  isDim={isDim}
                  landPulse={landPulse}
                  coolPulse={coolPulse}
                  spotlight={spotlight}
                  onAskFocus={() => {
                    setSpotlight((s) => (s === 'ask' ? 'all' : 'ask'))
                    setFocusMode(true)
                  }}
                  onCoolFocus={() => {
                    setSpotlight((s) => (s === 'cool' ? 'all' : 'cool'))
                    setFocusMode(true)
                  }}
                />
              </li>
            ) : null}
          </ul>
        </div>
      )
    } else if (bullets.length <= 1) {
      // Single growing stream — primacy surface (anti-flicker)
      const text = bullets[0] || answer?.bullets?.join('\n') || ''
      let punch = extractAtomicPunchline(text)
      // Commitment lock: freeze first punch token for this card
      if (punch && card.id) {
        if (
          !punchLockRef.current ||
          punchLockRef.current.cardId !== card.id
        ) {
          punchLockRef.current = { cardId: card.id, token: punch.token }
        } else if (streaming) {
          punch = {
            token: punchLockRef.current.token,
            rest: punch.rest,
          }
        }
      }
      const beat = canvasStats.beats[0]
      if (punch && (punch.rest || !streaming)) {
        speakBody = (
          <div className="w-full space-y-3">
            <ImpactChipStrip chips={impactChips} />
            <div className="speak-punch speak-orbit-core w-full">
              <span className="speak-rail-label text-[#5DD5E3]/80">
                Answer
              </span>
              <p className="speak-punch-word">
                {punch.token}
                <span className="speak-punch-period">.</span>
              </p>
            </div>
            {punch.rest ? (
              <OrbitBeat
                role="proof"
                label="Explain"
                scale={1}
                wide
                fullText={punch.rest}
                active={spotlight === 'proof'}
                onFocus={() =>
                  setSpotlight((s) => (s === 'proof' ? 'all' : 'proof'))
                }
              >
                <span className="whitespace-pre-wrap">
                  <HighlightedText
                    text={punch.rest}
                    spans={highlightSets[0] ?? []}
                  />
                  {streaming ? (
                    <span className="stream-caret" aria-hidden />
                  ) : null}
                </span>
              </OrbitBeat>
            ) : streaming ? (
              <p className="text-[13px] text-white/35">Explaining…</p>
            ) : null}
            {!streaming ? (
              <EndSignalRails
                askPlan={askPlan}
                coolLine={coolLine}
                isDim={isDim}
                landPulse={landPulse}
                coolPulse={coolPulse}
                spotlight={spotlight}
                onAskFocus={() => {
                  setSpotlight((s) => (s === 'ask' ? 'all' : 'ask'))
                  setFocusMode(true)
                }}
                onCoolFocus={() => {
                  setSpotlight((s) => (s === 'cool' ? 'all' : 'cool'))
                  setFocusMode(true)
                }}
              />
            ) : null}
          </div>
        )
      } else {
        speakBody = (
          <div className="w-full space-y-3">
            <ImpactChipStrip chips={impactChips} />
            <OrbitBeat
              role="hook"
              label={beat?.label ?? 'HOOK'}
              scale={beat?.displayScale ?? 1.1}
              wide
              fullText={text}
              active={spotlight === 'hook' || spotlight === 'all'}
              onFocus={() =>
                setSpotlight((s) => (s === 'hook' ? 'all' : 'hook'))
              }
            >
              <span className="whitespace-pre-wrap">
                <HighlightedText text={text} spans={highlightSets[0] ?? []} />
                {streaming ? (
                  <span className="stream-caret" aria-hidden />
                ) : null}
              </span>
            </OrbitBeat>
            {!streaming ? (
              <EndSignalRails
                askPlan={askPlan}
                coolLine={coolLine}
                isDim={isDim}
                landPulse={landPulse}
                coolPulse={coolPulse}
                spotlight={spotlight}
                onAskFocus={() => {
                  setSpotlight((s) => (s === 'ask' ? 'all' : 'ask'))
                  setFocusMode(true)
                }}
                onCoolFocus={() => {
                  setSpotlight((s) => (s === 'cool' ? 'all' : 'cool'))
                  setFocusMode(true)
                }}
              />
            ) : null}
          </div>
        )
      }
    } else {
      // Multi-beat rails
      let firstPunch = extractAtomicPunchline(bullets[0] || '')
      if (firstPunch && card.id) {
        if (
          !punchLockRef.current ||
          punchLockRef.current.cardId !== card.id
        ) {
          punchLockRef.current = {
            cardId: card.id,
            token: firstPunch.token,
          }
        } else if (streaming) {
          firstPunch = {
            token: punchLockRef.current.token,
            rest: firstPunch.rest,
          }
        }
      }
      const proofIdx = canvasStats.beats.findIndex((b) => b.role === 'proof')
      const glance =
        canvasStats.processMode === 'glance' && !expandFull
      speakBody = (
        <ul className="w-full space-y-2.5">
          <li className="list-none">
            <ImpactChipStrip chips={impactChips} />
          </li>
          {firstPunch ? (
            <li className="speak-punch speak-orbit-core list-none w-full">
              <span className="speak-rail-label text-[#5DD5E3]/80">
                Answer
              </span>
              <p className="speak-punch-word">
                {firstPunch.token}
                <span className="speak-punch-period">.</span>
              </p>
            </li>
          ) : null}
          {bullets.map((b, i) => {
            if (i === 0 && firstPunch) {
              if (!firstPunch.rest) return null
              const beat = canvasStats.beats[i]
              const scale = lensedDisplayScale(
                beat?.displayScale ?? 1,
                beat?.role ?? 'proof',
                proofIdx,
                i,
              )
              return (
                <OrbitBeat
                  key={`${card.id}-b-${i}`}
                  role="proof"
                  label="Explain"
                  scale={scale}
                  opacity={beat?.opacity}
                  dimmed={isDim('proof')}
                  wide
                  fullText={firstPunch.rest}
                  active={spotlight === 'proof'}
                  onFocus={() =>
                    setSpotlight((s) => (s === 'proof' ? 'all' : 'proof'))
                  }
                >
                  <HighlightedText
                    text={firstPunch.rest}
                    spans={highlightSets[i] ?? []}
                  />
                </OrbitBeat>
              )
            }
            const beat = canvasStats.beats[i]
            const role = beat?.role ?? 'support'
            // Peak-end / serial position: Hook, Proof, Close, Cool never collapse
            const isPeak =
              role === 'hook' ||
              role === 'proof' ||
              role === 'close' ||
              role === 'cool' ||
              role === 'ask'
            const collapsed =
              glance &&
              !isPeak &&
              (Boolean(beat?.collapsible) ||
                (beat != null &&
                  beat.index >= canvasStats.visibleBeatCap &&
                  role === 'support'))
            const scale = lensedDisplayScale(
              beat?.displayScale ?? 1,
              role,
              proofIdx,
              i,
            )
            return (
              <OrbitBeat
                key={`${card.id}-b-${i}`}
                role={role}
                label={beat?.label ?? `BEAT ${i + 1}`}
                scale={scale}
                opacity={
                  collapsed
                    ? Math.min(beat?.opacity ?? 0.7, 0.62)
                    : beat?.opacity
                }
                collapsed={collapsed}
                fullText={b}
                dimmed={isDim(role)}
                wide
                active={
                  spotlight === role ||
                  (landPulse && role === 'close') ||
                  (coolPulse && role === 'cool')
                }
                onFocus={() => {
                  if (
                    role !== 'hook' &&
                    role !== 'proof' &&
                    role !== 'close' &&
                    role !== 'cool' &&
                    role !== 'ask'
                  )
                    return
                  setSpotlight((s) => (s === role ? 'all' : role))
                  setFocusMode(true)
                }}
              >
                <HighlightedText text={b} spans={highlightSets[i] ?? []} />
              </OrbitBeat>
            )
          })}
          {/* Ask supersedes Cool when gates fire (key 4) */}
          {!streaming ? (
            <li className="list-none w-full">
              <EndSignalRails
                askPlan={askPlan}
                coolLine={coolLine}
                isDim={isDim}
                landPulse={landPulse}
                coolPulse={coolPulse}
                spotlight={spotlight}
                onAskFocus={() => {
                  setSpotlight((s) => (s === 'ask' ? 'all' : 'ask'))
                  setFocusMode(true)
                }}
                onCoolFocus={() => {
                  setSpotlight((s) => (s === 'cool' ? 'all' : 'cool'))
                  setFocusMode(true)
                }}
              />
            </li>
          ) : null}
          {canvasStats.processMode === 'glance' && bullets.length > 2 ? (
            <li className="list-none pt-1">
              <button
                type="button"
                className="speak-expand-btn"
                onClick={() => setExpandFull((v) => !v)}
              >
                {expandFull
                  ? 'Glance — Hook · Proof · Close · Ask'
                  : 'Depth — expand support rails'}
              </button>
            </li>
          ) : null}
        </ul>
      )
    }
  }

  const showReadyRails = !card && !preparing
  const showPreparingSkeleton = preparing && (!card || !hasBody)
  const showEmptyCardBody = card && !hasBody && !preparing

  return (
    <div
      className={cn(
        // Tall reading surface: fill parent and keep a large floor so long answers stay readable
        'glass flex h-full min-h-[min(78vh,900px)] flex-col rounded-[28px] p-7 md:p-9',
        // Overlay: drop fixed min-height so the window can shrink/grow freely
        compact && 'min-h-0 rounded-[20px] p-4 sm:rounded-[24px] sm:p-5',
        expanded && 'min-h-0 rounded-[24px] p-5 md:p-7',
        // Hide chrome: pull answer body to top (under floating Show pill)
        chromeHidden &&
          'min-h-0 rounded-[16px] border-white/[0.06] p-3 pt-2 sm:rounded-[18px] sm:p-3.5',
      )}
    >
      {!chromeHidden && (
        <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-medium tracking-tight text-white/95">
              Speak this
            </h2>
            <p className="mt-1 text-[13px] text-white/40">
              {compact
                ? `${ladderHint} · F focus`
                : `${ladderHint} · 1–5 rails · Space ladder · F focus`}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {onToggleExpand ? (
              <Button
                size="sm"
                variant="secondary"
                title={
                  expanded
                    ? 'Exit full-pane expand'
                    : 'Expand answer to fill the main pane'
                }
                onClick={onToggleExpand}
              >
                {expanded ? (
                  <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Expand className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                <span className="ml-1.5 hidden sm:inline">
                  {expanded ? 'Exit' : 'Expand'}
                </span>
              </Button>
            ) : null}
            {onDetach ? (
              <Button
                size="sm"
                variant="secondary"
                title="Detach answer into a resizable popup window"
                disabled={detaching}
                onClick={onDetach}
              >
                {detaching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <PictureInPicture2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                <span className="ml-1.5 hidden sm:inline">
                  {detaching ? 'Opening…' : 'Detach'}
                </span>
              </Button>
            ) : null}
            {card && hasBody ? (
              <Button
                size="sm"
                variant="secondary"
                title="Copy full speak sheet"
                onClick={() => void copySpeakSheet()}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            ) : null}
            {(preparing || regenerating) && (
              <Badge tone="amber">
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {regenerating ? 'Rewriting…' : 'Working…'}
              </Badge>
            )}
            {total > 0 && (
              <Badge tone="indigo">
                {cardIndex + 1} / {total}
              </Badge>
            )}
          </div>
        </div>
      )}

      {!chromeHidden && card && hasBody ? (
        <div className="mb-4 shrink-0">
          <PathRail
            spotlight={spotlight}
            onSpot={(s) => {
              setSpotlight(s)
              setFocusMode(s !== 'all')
            }}
            completeness={streaming ? canvasStats.completeness : 1}
            streaming={streaming}
            focusMode={focusMode}
            processMode={canvasStats.processMode}
          />
        </div>
      ) : null}

      {/* Format modes — hide under focus to cut choice overload (Iyengar) */}
      {!chromeHidden && !focusMode && (
        <div className="mb-5 flex shrink-0 flex-wrap gap-2">
          {modes.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={mode === m.id ? 'default' : 'secondary'}
              title={m.hint}
              disabled={regenerating}
              onClick={() => onMode(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      )}

      {/* Minimal status when chrome hidden (modes/path gone) */}
      {chromeHidden && (preparing || regenerating) && (
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <Badge tone="amber">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            {regenerating ? 'Rewriting…' : 'Working…'}
          </Badge>
        </div>
      )}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 scrollbar-thin',
          chromeHidden ? 'space-y-2' : 'space-y-4',
        )}
      >
        {showReadyRails && <ReadyRails compact={compact || chromeHidden} />}

        {showPreparingSkeleton && !card && (
          <div className="space-y-3">
            <SpeakRailsSkeleton compact={compact || chromeHidden} />
          </div>
        )}

        {card && (
          // Stable key: do NOT remount on every streaming token (was causing heavy flicker).
          // Only remount when the card identity changes (new question).
          <div
            key={card.id}
            className={cn('pb-2', chromeHidden ? 'space-y-2' : 'space-y-3.5')}
          >
            {/* Q + Scaffold chrome — hidden so answer pulls up to red-mark line */}
            {!chromeHidden && (
              <p
                className="line-clamp-1 max-w-[66ch] text-[13px] leading-snug text-white/40"
                title={card.question}
              >
                <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wide text-white/28">
                  Q
                </span>
                {card.question}
              </p>
            )}

            <div
              className={cn(
                chromeHidden ? 'space-y-2' : 'space-y-3',
                !chromeHidden &&
                  canvasStats.processMode === 'glance' &&
                  !expandFull &&
                  'speak-glance-surface',
              )}
            >
              {/* Quiet chrome: no "Scaffold" / formula labels under stress */}
              {!chromeHidden && !focusMode && hasBody ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium tracking-wide text-white/30">
                    {canvasStats.processMode === 'glance'
                      ? askPlan.show
                        ? 'Hook · Proof · Close · Ask'
                        : 'Hook · Proof · Close · Cool'
                      : 'Full rails'}
                  </p>
                  <span className="text-[10px] uppercase tracking-wide text-white/25">
                    {answer?.mode ?? mode}
                  </span>
                </div>
              ) : null}

              {showPreparingSkeleton && (
                <SpeakRailsSkeleton compact={compact || chromeHidden} />
              )}

              {showEmptyCardBody && (
                <div className="speak-measure rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-[14px] text-white/40">
                  No answer text yet — try Answer again or switch format.
                </div>
              )}

              {speakBody}

              {answer?.codeSnippet ? (
                <pre className="speak-measure max-h-[40vh] overflow-auto rounded-[14px] border border-white/[0.06] bg-black/30 p-4 text-[13px] leading-relaxed text-[#5DD5E3]/95">
                  <code>{answer.codeSnippet}</code>
                </pre>
              ) : null}

              {!chromeHidden && <MetricsChips metrics={metrics} />}
            </div>
          </div>
        )}
      </div>

      {total > 0 && !chromeHidden && (
        <div className="mt-6 flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] pt-5">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canPrev}
            onClick={() => onCardIndex(Math.max(0, cardIndex - 1))}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
            Previous
          </Button>
          <span className="text-[12px] text-white/35">
            {canNext ? 'Next when ready' : preparing ? 'More coming…' : 'End of list'}
          </span>
          <Button
            variant="default"
            size="sm"
            disabled={!canNext}
            onClick={() => onCardIndex(Math.min(total - 1, cardIndex + 1))}
          >
            Next
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>
      )}
    </div>
  )
})
