/**
 * SpeakCanvas v0 — speech scaffold, not a document.
 *
 * Sprint 0 (validated):
 * - Ready rails empty / preparing skeleton
 * - Demoted question (one muted line)
 * - Typography: max-w-[66ch], speak line-height
 * - Sparse impact highlights (cap 8)
 * - Action-weighted STAR
 * - Metric chips from answer.metrics
 * - No new AnswerMode enum
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  HIGHLIGHT_BUDGET,
  planHighlights,
  renderHighlightedText,
} from '@/lib/impact-highlight'
import { cn } from '@/lib/utils'
import type { AnswerMode, QACard, SuggestedAnswer } from '@/types'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { memo, useMemo, type ReactNode } from 'react'

const modes: { id: AnswerMode; label: string; hint: string }[] = [
  { id: 'shorter', label: 'Shorter', hint: '3 tight lines' },
  { id: 'technical', label: 'Technical', hint: 'depth + tradeoffs' },
  { id: 'star', label: 'STAR', hint: 'S/T/A/R story' },
  { id: 'code', label: 'Code', hint: 'sketch + speak' },
]

const BEAT_LABELS = ['HOOK', 'PROOF', 'CLOSE'] as const

const speakBody =
  'max-w-[66ch] text-[17px] font-normal leading-[1.65] tracking-[-0.01em] text-white/90'
const speakHook =
  'max-w-[66ch] text-[19px] font-medium leading-[1.5] tracking-[-0.015em] text-white/95'
const beatLabel =
  'text-[10px] font-medium uppercase tracking-[0.08em] text-white/35'

function ReadyRails({
  preparing,
  compact,
}: {
  preparing?: boolean
  compact?: boolean
}) {
  return (
    <div className="flex h-full min-h-[280px] flex-col justify-center space-y-4 px-1 py-6">
      <div className="space-y-1">
        <p className="text-[13px] font-medium tracking-tight text-white/70">
          {preparing
            ? 'Drafting speak rails…'
            : 'Ready · glance here when answering'}
        </p>
        <p className="text-[12px] text-white/35">
          {compact
            ? 'Answers stream from the main InterviewPulse window.'
            : 'Start interview or paste a question. First line appears when the model opens.'}
        </p>
        <p className="text-[11px] text-white/28">
          Glance, don&apos;t read — short beats only.
        </p>
      </div>
      <div className="space-y-3">
        {BEAT_LABELS.map((label, i) => (
          <div
            key={label}
            className={cn(
              'rounded-[16px] border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-3',
              preparing && 'animate-pulse',
            )}
          >
            <div className={beatLabel}>{label}</div>
            <div
              className={cn(
                'mt-2 h-4 rounded-sm bg-white/[0.06]',
                i === 0 ? 'w-[92%]' : i === 1 ? 'w-[70%]' : 'w-[55%]',
              )}
            />
            {i === 1 && (
              <div className="mt-2 flex gap-1.5">
                <span className="h-5 w-14 rounded-full bg-white/[0.05]" />
                <span className="h-5 w-12 rounded-full bg-white/[0.05]" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricChips({ metrics }: { metrics: string[] }) {
  const clean = metrics.map((m) => m.trim()).filter(Boolean).slice(0, 6)
  if (!clean.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {clean.map((m) => (
        <span
          key={m}
          className="inline-flex items-center rounded-full border border-[#20B8CD]/25 bg-[#20B8CD]/10 px-2.5 py-0.5 text-[12px] font-medium tabular-nums text-[#5DD5E3]"
        >
          {m}
        </span>
      ))}
    </div>
  )
}

function BeatBlock({
  label,
  children,
  emphasis = 'normal',
}: {
  label: string
  children: ReactNode
  emphasis?: 'hook' | 'action' | 'normal' | 'soft'
}) {
  return (
    <div
      className={cn(
        'rounded-[16px] px-4 py-3.5',
        emphasis === 'action' &&
          'border border-[#20B8CD]/20 bg-[#20B8CD]/10',
        emphasis === 'hook' && 'border border-white/[0.08] bg-white/[0.04]',
        emphasis === 'normal' && 'border border-white/[0.06] bg-white/[0.03]',
        emphasis === 'soft' && 'border border-white/[0.04] bg-white/[0.02]',
      )}
    >
      <div className={beatLabel}>{label}</div>
      <div
        className={cn(
          'mt-2',
          emphasis === 'hook' && speakHook,
          emphasis === 'action' && cn(speakBody, 'font-medium'),
          emphasis === 'soft' &&
            'line-clamp-2 max-w-[66ch] text-[14px] leading-relaxed text-white/55',
          emphasis === 'normal' && speakBody,
        )}
      >
        {children}
      </div>
    </div>
  )
}

function SpeakBeats({
  bullets,
  streaming,
}: {
  bullets: string[]
  streaming?: boolean
}) {
  const parts = bullets.filter(Boolean)
  if (!parts.length) return null

  // Single streaming blob → one HOOK surface (anti multi-card remount flicker)
  if (parts.length === 1) {
    return (
      <BeatBlock
        label={streaming ? 'HOOK · streaming' : 'HOOK'}
        emphasis="hook"
      >
        <span className="whitespace-pre-wrap">
          {renderHighlightedText(parts[0]!, HIGHLIGHT_BUDGET)}
        </span>
      </BeatBlock>
    )
  }

  let remaining = HIGHLIGHT_BUDGET
  return (
    <div className="space-y-3">
      {parts.map((text, i) => {
        const n = planHighlights(text, remaining).length
        const node = renderHighlightedText(text, remaining)
        remaining = Math.max(0, remaining - n)
        const label =
          i < BEAT_LABELS.length ? BEAT_LABELS[i]! : `BEAT ${i + 1}`
        const emphasis: 'hook' | 'normal' | 'soft' =
          i === 0 ? 'hook' : i >= 3 ? 'soft' : 'normal'
        return (
          <BeatBlock key={`beat-${i}`} label={label} emphasis={emphasis}>
            <span className="whitespace-pre-wrap">{node}</span>
          </BeatBlock>
        )
      })}
    </div>
  )
}

function StarWeighted({
  star,
}: {
  star: NonNullable<SuggestedAnswer['star']>
}) {
  let remaining = HIGHLIGHT_BUDGET
  const rows: {
    label: string
    text: string
    emphasis: 'hook' | 'action' | 'soft'
  }[] = []

  // Speak order S→T→A→R; visual weight Action > Result > Situation/Task
  if (star.situation?.trim()) {
    rows.push({
      label: 'S · Situation',
      text: star.situation,
      emphasis: 'soft',
    })
  }
  if (star.task?.trim()) {
    rows.push({ label: 'T · Task', text: star.task, emphasis: 'soft' })
  }
  if (star.action?.trim()) {
    rows.push({
      label: 'A · Action · speak most of this',
      text: star.action,
      emphasis: 'action',
    })
  }
  if (star.result?.trim()) {
    rows.push({
      label: 'R · Result',
      text: star.result,
      emphasis: 'hook',
    })
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const n = planHighlights(r.text, remaining).length
        const node = renderHighlightedText(r.text, remaining)
        remaining = Math.max(0, remaining - n)
        return (
          <BeatBlock key={r.label} label={r.label} emphasis={r.emphasis}>
            {node}
          </BeatBlock>
        )
      })}
    </div>
  )
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
  const bullets = useMemo(
    () => answer?.bullets?.filter(Boolean) ?? [],
    [answer?.bullets],
  )
  const hasBody =
    bullets.length > 0 ||
    Boolean(answer?.codeSnippet) ||
    Boolean(answer?.star?.situation || answer?.star?.action)

  const metrics = answer?.metrics?.filter(Boolean) ?? []
  const showRails = !card || !hasBody
  const isStar =
    answer?.mode === 'star' &&
    Boolean(answer.star && (answer.star.situation || answer.star.action))

  return (
    <div
      className={cn(
        'glass flex h-full min-h-[min(78vh,900px)] flex-col rounded-[28px] p-7 md:p-9',
        compact && 'min-h-0 rounded-[20px] p-4 sm:rounded-[24px] sm:p-5',
      )}
    >
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">
            Speak this
          </h2>
          <p className="mt-1 text-[12px] text-white/40">
            HOOK · PROOF · CLOSE · glance, don&apos;t read · format rewrites
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(preparing || regenerating) && (
            <Badge tone="amber">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              {regenerating
                ? 'Rewriting…'
                : preparing
                  ? 'Drafting…'
                  : 'Working…'}
            </Badge>
          )}
          {total > 0 && (
            <Badge tone="indigo">
              {cardIndex + 1} / {total}
            </Badge>
          )}
        </div>
      </div>

      <div className="mb-4 flex shrink-0 flex-wrap gap-2">
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
        {showRails && (
          <ReadyRails
            preparing={Boolean(preparing && !hasBody)}
            compact={compact}
          />
        )}

        {card && hasBody && (
          <div key={card.id} className="space-y-4 pb-2">
            {card.question?.trim() ? (
              <p className="line-clamp-2 max-w-[66ch] text-[13px] leading-snug text-white/40">
                <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide text-white/25">
                  Q
                </span>
                {card.question}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className={beatLabel}>Live scaffold</span>
              <Badge tone="default">{answer?.mode ?? mode}</Badge>
              {answer?.streaming ? (
                <span className="text-[11px] text-white/30">streaming…</span>
              ) : null}
            </div>

            <MetricChips metrics={metrics} />

            {isStar && answer?.star ? (
              <StarWeighted star={answer.star} />
            ) : (
              <SpeakBeats
                bullets={bullets}
                streaming={Boolean(answer?.streaming)}
              />
            )}

            {answer?.codeSnippet ? (
              <div className="space-y-1.5">
                <div className={beatLabel}>Code sketch</div>
                <pre className="max-h-[40vh] max-w-[72ch] overflow-auto rounded-[16px] border border-white/[0.06] bg-black/30 p-4 text-[13px] leading-relaxed text-[#5DD5E3]/95">
                  <code>{answer.codeSnippet}</code>
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-5 flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
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
            {canNext
              ? 'Next when ready'
              : preparing
                ? 'More coming…'
                : 'End of list'}
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
