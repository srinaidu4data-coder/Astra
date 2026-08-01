import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  planSpeakCanvas,
  starFieldWeights,
  type SpeakCanvasStats,
} from '@/lib/speak-canvas-engine'
import {
  getSpeakHighlightsBudgeted,
  splitHighlighted,
  type SpeakHighlightSpan,
} from '@/lib/speak-highlight'
import { cn } from '@/lib/utils'
import type { AnswerMode, QACard } from '@/types'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { memo, useMemo, useRef, useState, type ReactNode } from 'react'

const modes: { id: AnswerMode; label: string; hint: string }[] = [
  { id: 'shorter', label: 'Shorter', hint: '3 tight lines' },
  { id: 'technical', label: 'Technical', hint: 'depth + tradeoffs' },
  { id: 'star', label: 'STAR', hint: 'S/T/A/R story' },
  { id: 'code', label: 'Code', hint: 'sketch + speak' },
]

const READY_RAILS = [
  { id: 'hook', label: 'Hook', hint: 'Primacy · first fixation' },
  { id: 'proof', label: 'Proof', hint: 'Peak · action + metric' },
  { id: 'close', label: 'Close', hint: 'Peak-end · last word' },
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
          <span
            key={i}
            className={cn(
              'speak-keyword',
              // von Restorff: metrics slightly louder than ownership
            )}
          >
            {n.text}
          </span>
        ) : (
          <span key={i}>{n.text}</span>
        ),
      )}
    </span>
  )
}

/** Attention mass bar — visual softmax a_i */
function AttentionBar({ a }: { a: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, a)) * 100)
  return (
    <span
      className="speak-attn-bar"
      title={`Attention aᵢ = ${(a * 100).toFixed(0)}% (softmax)`}
      style={{ width: `${Math.max(8, pct)}%` }}
    />
  )
}

function IntentionStrip({ text }: { text: string }) {
  return (
    <div className="speak-intention" title="Implementation intention (Gollwitzer)">
      <span className="speak-intention-tag">When → Then</span>
      <span className="min-w-0 truncate">{text}</span>
    </div>
  )
}

function EngineStrip({ stats }: { stats: SpeakCanvasStats }) {
  const [open, setOpen] = useState(false)
  const loadTone =
    stats.cognitiveLoad > 1.05
      ? 'high'
      : stats.cognitiveLoad > 0.75
        ? 'mid'
        : 'ok'
  return (
    <div className="speak-engine">
      <button
        type="button"
        className="speak-engine-toggle"
        onClick={() => setOpen((v) => !v)}
        title="Psych-math engine (softmax, serial position, load, Zipf budget)"
      >
        <span>
          L={stats.cognitiveLoad.toFixed(2)} · B={stats.highlightBudget} · U=
          {stats.timeUtility.toFixed(2)}
        </span>
        <span className={cn('speak-load-dot', `is-${loadTone}`)} />
        <span className="text-white/30">{open ? 'Hide math' : 'Psych-math'}</span>
      </button>
      {open && (
        <ul className="speak-engine-formulas">
          {stats.formulas.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
          <li className="text-white/35">
            Techniques: primacy · recency · peak-end · isolation · chunking ·
            implementation intentions · cognitive load
          </li>
        </ul>
      )}
    </div>
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

  // Psych-math plan for multi-beat bullets (primacy / peak / recency)
  const canvasStats = useMemo(() => {
    const parts = useStarLayout
      ? [starAction, starResult].filter(Boolean)
      : bullets.length
        ? bullets
        : []
    const hits = highlightSets.reduce((n, s) => n + s.length, 0)
    return planSpeakCanvas(parts, { highlightHits: hits })
  }, [useStarLayout, starAction, starResult, bulletsKey, highlightSets])

  if (card && hasBody) {
    if (useStarLayout && answer?.star) {
      const starFields = starFieldWeights().filter(
        (f) => Boolean(answer.star?.[f.key]),
      )

      speakBody = (
        <div className="speak-measure grid gap-2.5">
          {starFields.map((f) => {
            const t = answer.star![f.key]
            const isAction = f.weight === 'primary'
            const isMuted = f.weight === 'muted'
            const hlIndex =
              f.key === 'action' ? 0 : f.key === 'result' ? 1 : -1
            const spans = hlIndex >= 0 ? highlightSets[hlIndex] ?? [] : []
            return (
              <div
                key={f.key}
                className={cn(
                  'speak-beat rounded-[14px] px-4',
                  isAction && 'speak-beat-peak',
                  isMuted && 'speak-beat-muted',
                  !isAction && !isMuted && 'speak-beat-close',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div
                    className={cn(
                      'speak-rail-label',
                      isAction && 'text-[#5DD5E3]/70',
                    )}
                  >
                    {f.label}
                  </div>
                  <span className="speak-tech-hint">{f.technique}</span>
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
                    style={
                      isAction
                        ? { fontSize: `${17 * 1.06}px` }
                        : undefined
                    }
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
      // Single growing stream — primacy surface (anti-flicker)
      const text = bullets[0] || answer?.bullets?.join('\n') || ''
      const beat = canvasStats.beats[0]
      speakBody = (
        <div className="speak-measure speak-beat speak-beat-hook rounded-[14px] px-4 py-3.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="speak-rail-label text-[#5DD5E3]/70">
              {beat?.label ?? 'HOOK'}
            </span>
            <span className="speak-tech-hint">
              {beat?.technique ?? 'Primacy · open here'}
            </span>
          </div>
          <p
            className="speak-body whitespace-pre-wrap"
            style={{
              fontSize: `${17 * (beat?.displayScale ?? 1)}px`,
            }}
          >
            <HighlightedText text={text} spans={highlightSets[0] ?? []} />
            {streaming ? <span className="stream-caret" aria-hidden /> : null}
          </p>
          {beat ? (
            <div className="mt-2.5">
              <AttentionBar a={beat.attention} />
            </div>
          ) : null}
        </div>
      )
    } else {
      // Multi-beat: Hook / Proof / Close with softmax attention scales
      speakBody = (
        <ul className="speak-measure space-y-2.5">
          {bullets.map((b, i) => {
            const beat = canvasStats.beats[i]
            const role = beat?.role ?? 'support'
            return (
              <li
                key={`${card.id}-b-${i}`}
                className={cn(
                  'speak-beat rounded-[12px] px-3.5 py-2.5',
                  role === 'hook' && 'speak-beat-hook',
                  role === 'proof' && 'speak-beat-peak',
                  role === 'close' && 'speak-beat-close',
                  role === 'support' && 'speak-beat-support',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="speak-rail-label">
                    {beat?.label ?? `BEAT ${i + 1}`}
                  </span>
                  <span className="speak-tech-hint">
                    {beat?.technique ?? 'Chunk'}
                    {beat
                      ? ` · a=${(beat.attention * 100).toFixed(0)}%`
                      : ''}
                  </span>
                </div>
                <p
                  className="speak-body min-w-0 leading-[1.6] text-white/90"
                  style={{
                    fontSize: `${15.5 * (beat?.displayScale ?? 1)}px`,
                  }}
                >
                  <HighlightedText text={b} spans={highlightSets[i] ?? []} />
                </p>
                {beat ? (
                  <div className="mt-2">
                    <AttentionBar a={beat.attention} />
                  </div>
                ) : null}
              </li>
            )
          })}
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
            Speak this
          </h2>
          <p className="mt-1 text-[13px] text-white/40">
            {compact
              ? 'Primacy · peak · end · glance only'
              : 'HOOK → PROOF → CLOSE · isolation highlights · glance, don’t read'}
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-tight text-white/35">
                  Scaffold
                </p>
                <Badge tone="default">{answer?.mode ?? mode}</Badge>
              </div>

              {/* Implementation intention (Gollwitzer) */}
              {hasBody && (
                <IntentionStrip text={canvasStats.intention} />
              )}

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

              {/* Psych-math strip: softmax, load L, Zipf B, utility U */}
              {hasBody && !compact && <EngineStrip stats={canvasStats} />}
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
