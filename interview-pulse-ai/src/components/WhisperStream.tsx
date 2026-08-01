import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getSpeakHighlightsBudgeted,
  splitHighlighted,
  type SpeakHighlightSpan,
} from '@/lib/speak-highlight'
import { cn } from '@/lib/utils'
import type { AnswerMode, QACard } from '@/types'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { memo, useMemo, useRef, type ReactNode } from 'react'

const modes: { id: AnswerMode; label: string; hint: string }[] = [
  { id: 'shorter', label: 'Shorter', hint: '3 tight lines' },
  { id: 'technical', label: 'Technical', hint: 'depth + tradeoffs' },
  { id: 'star', label: 'STAR', hint: 'S/T/A/R story' },
  { id: 'code', label: 'Code', hint: 'sketch + speak' },
]

const READY_RAILS = [
  { id: 'hook', label: 'Hook', hint: 'One-line frame' },
  { id: 'proof', label: 'Proof', hint: 'Action + metric' },
  { id: 'close', label: 'Close', hint: 'Outcome / offer' },
] as const

function HighlightedText({
  text,
  spans,
  className,
}: {
  text: string
  spans: SpeakHighlightSpan[]
  className?: string
}) {
  const nodes = splitHighlighted(text, spans)
  return (
    <span className={className}>
      {nodes.map((n, i) =>
        n.highlight ? (
          <span key={i} className="speak-keyword">
            {n.text}
          </span>
        ) : (
          <span key={i}>{n.text}</span>
        ),
      )}
    </span>
  )
}

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
        max: 8,
      })
    }

    const next = getSpeakHighlightsBudgeted(parts, { max: 8 })
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

  if (card && hasBody) {
    if (useStarLayout && answer?.star) {
      const starFields = (
        [
          ['Situation', answer.star.situation, 'muted'],
          ['Task', answer.star.task, 'muted'],
          ['Action', answer.star.action, 'primary'],
          ['Result', answer.star.result, 'secondary'],
        ] as const
      ).filter(([, t]) => Boolean(t))

      speakBody = (
        <div className="speak-measure grid gap-2.5">
          {starFields.map(([label, t, weight]) => {
            const isAction = weight === 'primary'
            const isMuted = weight === 'muted'
            const hlIndex = label === 'Action' ? 0 : label === 'Result' ? 1 : -1
            const spans = hlIndex >= 0 ? highlightSets[hlIndex] ?? [] : []
            return (
              <div
                key={label}
                className={cn(
                  'rounded-[14px] px-4',
                  isAction
                    ? 'border border-white/[0.08] bg-white/[0.03] py-3.5'
                    : isMuted
                      ? 'border border-transparent py-1.5'
                      : 'border border-white/[0.05] bg-white/[0.015] py-3',
                )}
              >
                <div
                  className={cn(
                    'speak-rail-label mb-1',
                    isAction && 'text-[#5DD5E3]/70',
                    isMuted && 'mb-0.5',
                  )}
                >
                  {label}
                </div>
                {isMuted ? (
                  <p
                    className="line-clamp-1 text-[13px] leading-snug text-white/40"
                    title={t}
                  >
                    {t}
                  </p>
                ) : (
                  <p
                    className={cn(
                      'speak-body',
                      isAction
                        ? 'text-[17px] font-medium leading-[1.65] text-white/92'
                        : 'text-[16px] leading-[1.6] text-white/82',
                    )}
                  >
                    <HighlightedText text={t!} spans={spans} />
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )
    } else if (bullets.length <= 1) {
      // Single growing stream block — anti-flicker stable surface
      const text = bullets[0] || answer?.bullets?.join('\n') || ''
      speakBody = (
        <div className="speak-measure rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
          <p className="speak-body whitespace-pre-wrap">
            <HighlightedText text={text} spans={highlightSets[0] ?? []} />
            {streaming ? <span className="stream-caret" aria-hidden /> : null}
          </p>
        </div>
      )
    } else {
      // Short glanceable bullets — not dense multi-paragraph cards
      speakBody = (
        <ul className="speak-measure space-y-2">
          {bullets.map((b, i) => (
            <li
              key={`${card.id}-b-${i}`}
              className="flex gap-2.5 rounded-[12px] border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5"
            >
              <span
                className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#5DD5E3]/70"
                aria-hidden
              />
              <p className="speak-body min-w-0 text-[16px] leading-[1.6]">
                <HighlightedText text={b} spans={highlightSets[i] ?? []} />
              </p>
            </li>
          ))}
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
      <div className="mb-5 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">
            Your answer
          </h2>
          <p className="mt-1 text-[13px] text-white/40">
            {compact
              ? 'Speak scaffold · formats rewrite live'
              : 'Glance · speak · switch format to rewrite'}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-tight text-white/35">
                  Speak this
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
