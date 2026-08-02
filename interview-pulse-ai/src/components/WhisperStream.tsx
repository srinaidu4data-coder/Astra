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
import { cn } from '@/lib/utils'
import type { AnswerMode, QACard } from '@/types'
import { Check, ChevronLeft, ChevronRight, Copy, Loader2 } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type Spotlight = 'all' | 'hook' | 'proof' | 'close'

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
] as const

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
}) {
  const shell = orbitalShell(role)
  return (
    <li
      className={cn(
        'speak-beat speak-orbit rounded-[12px] px-3.5 py-2.5 list-none transition-[opacity,box-shadow] duration-200',
        `speak-orbit-${shell}`,
        role === 'hook' && 'speak-beat-hook',
        role === 'proof' && 'speak-beat-peak',
        role === 'close' && 'speak-beat-close',
        role === 'support' && 'speak-beat-support',
        active && 'speak-beat-active',
        dimmed && 'speak-beat-dimmed',
      )}
      style={{
        opacity:
          dimmed
            ? 0.38
            : opacity != null && opacity < 0.99
              ? opacity
              : undefined,
      }}
      title={collapsed && fullText ? fullText : undefined}
      onClick={onFocus}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="speak-rail-label">{label}</span>
        {collapsed ? (
          <span className="text-[10px] text-white/25">expand for full</span>
        ) : active ? (
          <span className="text-[10px] text-[#5DD5E3]/70">speak</span>
        ) : null}
      </div>
      <div
        className={cn(
          'speak-body min-w-0 leading-[1.65] text-white/90',
          collapsed && 'line-clamp-2',
        )}
        style={{ fontSize: `${15.5 * scale}px` }}
      >
        {children}
      </div>
    </li>
  )
}

function ImpactChipStrip({
  chips,
}: {
  chips: Array<{ text: string; kind: string }>
}) {
  if (!chips.length) return null
  return (
    <div className="speak-impact-strip" aria-label="Impact words">
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
}: {
  spotlight: Spotlight
  onSpot: (s: Spotlight) => void
  completeness: number
}) {
  const items: { id: Spotlight; label: string; key: string }[] = [
    { id: 'hook', label: 'Hook', key: '1' },
    { id: 'proof', label: 'Proof', key: '2' },
    { id: 'close', label: 'Close', key: '3' },
  ]
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
      </div>
      <div
        className="speak-complete-track"
        title={`Scaffold ${Math.round(completeness * 100)}%`}
      >
        <div
          className="speak-complete-fill"
          style={{ width: `${Math.round(completeness * 100)}%` }}
        />
      </div>
    </div>
  )
}

// Speak surface stays clean: layout math runs in speak-canvas-engine for
// highlight budgets / type scale only — no psych/ML "skills" UI while reading.

function SpeakRailsSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('speak-measure space-y-3', compact ? 'space-y-2.5' : 'space-y-3')}>
      {READY_RAILS.map((rail, i) => (
        <div
          key={rail.id}
          className={cn(
            'rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-4 py-3',
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

function ReadyRails({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('speak-measure w-full space-y-3', compact ? 'py-2' : 'py-4')}>
      <div className="mb-1">
        <p className="text-[15px] font-medium tracking-tight text-white/80">
          Ready to speak
        </p>
        <p className="speak-body-secondary mt-1">
          {compact
            ? 'Answers stream here from the main window.'
            : 'Type a question and press Answer — scaffold fills as you go.'}
        </p>
      </div>
      {READY_RAILS.map((rail) => (
        <div
          key={rail.id}
          className={cn(
            'rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.015] px-4 py-3',
            compact && 'px-3 py-2.5',
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="speak-rail-label">{rail.label}</span>
            <span className="text-[11px] text-white/25">{rail.hint}</span>
          </div>
          <div className="mt-2.5 space-y-1.5 opacity-40">
            <div className="h-2 w-[70%] rounded bg-white/[0.06]" />
            <div className="h-2 w-[45%] rounded bg-white/[0.04]" />
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
      })
    }

    const next = getSpeakHighlightsBudgeted(parts, { max: 10 })
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
  }, [cardId, partsKey, streaming])
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
}: {
  cards: QACard[]
  cardIndex: number
  onCardIndex: (i: number) => void
  mode: AnswerMode
  onMode: (m: AnswerMode) => void
  preparing?: boolean
  regenerating?: boolean
  compact?: boolean
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
  /** Commitment lock: first atomic punch token freezes for the card */
  const punchLockRef = useRef<{ cardId: string; token: string } | null>(null)

  useEffect(() => {
    setExpandFull(false)
    setSpotlight('all')
    setCopied(false)
    punchLockRef.current = null
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
      // P0: 1 / 2 / 3 focus Hook / Proof / Close; 0 or Esc = all
      if (e.key === '1') {
        e.preventDefault()
        setSpotlight((s) => (s === 'hook' ? 'all' : 'hook'))
      } else if (e.key === '2') {
        e.preventDefault()
        setSpotlight((s) => (s === 'proof' ? 'all' : 'proof'))
      } else if (e.key === '3') {
        e.preventDefault()
        setSpotlight((s) => (s === 'close' ? 'all' : 'close'))
      } else if (e.key === '0' || e.key === 'Escape') {
        setSpotlight('all')
      } else if ((e.key === 'c' || e.key === 'C') && !e.shiftKey) {
        // optional: C copies when not in an input (P0 speak-sheet)
        // only if user holds nothing special — skip if they might type
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copySpeakSheet = useCallback(async () => {
    if (!card?.answer) return
    const sheet = buildSpeakSheetFromAnswer({
      star: card.answer.star,
      bullets: card.answer.bullets,
    })
    if (!sheet) return
    try {
      await navigator.clipboard.writeText(sheet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }, [card])
  const streaming = Boolean(answer?.streaming)

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

  const highlightSets = useFrozenHighlights(card?.id, highlightParts, streaming)

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
    return chipsFromSpans(parts, highlightSets, 6)
  }, [useStarLayout, starAction, starResult, bulletsKey, highlightSets])

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
        <div className="speak-measure space-y-3">
          <ImpactChipStrip chips={impactChips} />
          <ul className="grid gap-2.5">
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
                  active={spotlight === f.role}
                  onFocus={() => {
                    const r = f.role
                    if (r !== 'hook' && r !== 'proof' && r !== 'close') return
                    setSpotlight((s) => (s === r ? 'all' : r))
                  }}
                >
                  <HighlightedText text={t} spans={spans} />
                </OrbitBeat>
              )
            })}
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
          <div className="speak-measure space-y-3">
            <ImpactChipStrip chips={impactChips} />
            <div className="speak-punch speak-orbit-core">
              <span className="speak-rail-label text-[#5DD5E3]/80">
                Answer
              </span>
              <p className="speak-punch-word">
                {punch.token}
                <span className="speak-punch-period">.</span>
              </p>
            </div>
            {punch.rest ? (
              <div className="speak-beat speak-beat-peak speak-orbit-planet rounded-[14px] px-4 py-3">
                <div className="speak-rail-label mb-1">Explain</div>
                <p className="speak-body whitespace-pre-wrap text-[16px]">
                  <HighlightedText
                    text={punch.rest}
                    spans={highlightSets[0] ?? []}
                  />
                  {streaming ? (
                    <span className="stream-caret" aria-hidden />
                  ) : null}
                </p>
              </div>
            ) : streaming ? (
              <p className="text-[13px] text-white/35">Explaining…</p>
            ) : null}
          </div>
        )
      } else {
        speakBody = (
          <div className="speak-measure space-y-3">
            <ImpactChipStrip chips={impactChips} />
            <div className="speak-beat speak-beat-hook speak-orbit-core rounded-[14px] px-4 py-3.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="speak-rail-label text-[#5DD5E3]/70">
                  {beat?.label ?? 'HOOK'}
                </span>
              </div>
              <p
                className="speak-body whitespace-pre-wrap"
                style={{
                  fontSize: `${17 * (beat?.displayScale ?? 1)}px`,
                }}
              >
                <HighlightedText text={text} spans={highlightSets[0] ?? []} />
                {streaming ? (
                  <span className="stream-caret" aria-hidden />
                ) : null}
              </p>
            </div>
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
        <ul className="speak-measure space-y-2.5">
          <li className="list-none">
            <ImpactChipStrip chips={impactChips} />
          </li>
          {firstPunch ? (
            <li className="speak-punch speak-orbit-core list-none">
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
            // Glance: collapse support only — Close always full (peak-end)
            const collapsed =
              glance &&
              role !== 'close' &&
              role !== 'hook' &&
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
                active={spotlight === role}
                onFocus={() => {
                  if (role !== 'hook' && role !== 'proof' && role !== 'close')
                    return
                  setSpotlight((s) => (s === role ? 'all' : role))
                }}
              >
                <HighlightedText text={b} spans={highlightSets[i] ?? []} />
              </OrbitBeat>
            )
          })}
          {canvasStats.processMode === 'glance' && bullets.length > 2 ? (
            <li className="list-none pt-1">
              <button
                type="button"
                className="speak-expand-btn"
                onClick={() => setExpandFull((v) => !v)}
              >
                {expandFull
                  ? 'Glance mode — focus rails'
                  : 'Show full answer — nothing hidden'}
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
      )}
    >
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">
            Speak this
          </h2>
          <p className="mt-1 text-[13px] text-white/40">
            {compact
              ? 'Bold = impact · keys 1–2–3 focus rails'
              : 'Hook → Proof → Close · bold carries the answer · 1 2 3 to focus'}
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {card && hasBody ? (
        <div className="mb-4 shrink-0">
          <PathRail
            spotlight={spotlight}
            onSpot={setSpotlight}
            completeness={canvasStats.completeness}
          />
        </div>
      ) : null}

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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-2 scrollbar-thin">
        {showReadyRails && <ReadyRails compact={compact} />}

        {showPreparingSkeleton && !card && (
          <div className="space-y-3">
            <SpeakRailsSkeleton compact={compact} />
          </div>
        )}

        {card && (
          // Stable key: do NOT remount on every streaming token (was causing heavy flicker).
          // Only remount when the card identity changes (new question).
          <div key={card.id} className="space-y-3.5 pb-2">
            {/* Demoted question: single muted line, not large glass-inset card */}
            <p
              className="line-clamp-1 max-w-[66ch] text-[13px] leading-snug text-white/40"
              title={card.question}
            >
              <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wide text-white/28">
                Q
              </span>
              {card.question}
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-tight text-white/35">
                  Scaffold
                </p>
                <Badge tone="default">{answer?.mode ?? mode}</Badge>
              </div>

              {showPreparingSkeleton && (
                <SpeakRailsSkeleton compact={compact} />
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

              <MetricsChips metrics={metrics} />
            </div>
          </div>
        )}
      </div>

      {total > 0 && (
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
