import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AnswerMode, QACard } from '@/types'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

const modes: { id: AnswerMode; label: string; hint: string }[] = [
  { id: 'shorter', label: 'Shorter', hint: '3 tight lines' },
  { id: 'technical', label: 'Technical', hint: 'depth + tradeoffs' },
  { id: 'star', label: 'STAR', hint: 'S/T/A/R story' },
  { id: 'code', label: 'Code', hint: 'sketch + speak' },
]

export function WhisperStream({
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
  // Fallback: some paths only set star fields or a single long bullet
  const hasBody =
    bullets.length > 0 ||
    Boolean(answer?.codeSnippet) ||
    Boolean(answer?.star?.situation || answer?.star?.action)

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
            Full context below · switch format to rewrite · Next when ready
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

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-2 scrollbar-thin">
        {!card && (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[22px] glass-inset px-8 py-20 text-center">
            <p className="max-w-md text-[15px] leading-relaxed text-white/40">
              {compact
                ? 'Waiting for answers from the main InterviewPulse window. Start listening or type a question there — answers stream here live.'
                : 'Type a question and press Answer, or run Interview file. Full answers appear here — scroll if they run long.'}
            </p>
          </div>
        )}

        {card && (
          // Stable key: do NOT remount on every streaming token (was causing heavy flicker).
          // Only remount when the card identity changes (new question).
          <div
            key={card.id}
            className="space-y-5 pb-2"
          >
            <div className="rounded-[22px] glass-inset px-6 py-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-tight text-white/35">
                Question
              </p>
              <p className="text-[18px] font-light leading-snug tracking-tight text-white/92">
                {card.question}
              </p>
            </div>

            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-tight text-white/35">
                  Speak this
                </p>
                <Badge tone="default">{answer?.mode ?? mode}</Badge>
              </div>

              {!hasBody && (
                <div className="rounded-[18px] glass-inset px-5 py-6 text-[14px] text-white/40">
                  No answer text yet — try Answer again or switch format.
                </div>
              )}

              {/* STAR blocks when available */}
              {answer?.mode === 'star' && answer.star && (answer.star.situation || answer.star.action) ? (
                <div className="grid gap-3.5">
                  {(
                    [
                      ['Situation', answer.star.situation],
                      ['Task', answer.star.task],
                      ['Action', answer.star.action],
                      ['Result', answer.star.result],
                    ] as const
                  )
                    .filter(([, t]) => t)
                    .map(([label, t]) => (
                      <div key={label} className="rounded-[18px] glass-inset px-5 py-4">
                        <div className="mb-1.5 text-xs font-medium uppercase tracking-tight text-white/35">
                          {label}
                        </div>
                        <p className="text-[17px] leading-[1.75] text-white/90">{t}</p>
                      </div>
                    ))}
                </div>
              ) : (
                bullets.map((b, i) => (
                  <div
                    key={`${card.id}-b-${i}`}
                    className="rounded-[18px] glass-inset px-5 py-4 text-[17px] leading-[1.75] tracking-[-0.01em] text-white/90"
                  >
                    {b}
                  </div>
                ))
              )}

              {answer?.codeSnippet ? (
                <pre className="max-h-[40vh] overflow-auto rounded-[18px] glass-inset p-5 text-[13px] leading-relaxed text-[#5DD5E3]/95">
                  <code>{answer.codeSnippet}</code>
                </pre>
              ) : null}
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
}
