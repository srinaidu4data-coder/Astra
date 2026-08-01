/**
 * SpeakCanvas v0 — sparse impact highlighting (compat surface).
 * Canonical engine: speak-highlight.ts (budget, freeze, multi-part).
 * This module re-exports constants + single-block helpers for any legacy callers.
 */

import { Fragment, type ReactNode } from 'react'
import {
  HIGHLIGHT_BUDGET,
  MAX_SPAN_WORDS,
  planSpeakHighlights,
  type SpeakHighlightSpan,
} from '@/lib/speak-highlight'

export { HIGHLIGHT_BUDGET, MAX_SPAN_WORDS }
export type ImpactSpan = SpeakHighlightSpan

/** Plan highlight spans for one text block (respect budget). */
export function planHighlights(
  text: string,
  budget: number = HIGHLIGHT_BUDGET,
): ImpactSpan[] {
  return planSpeakHighlights(text, budget)
}

/** Render text with sparse impact emphasis. */
export function renderHighlightedText(
  text: string,
  budget: number = HIGHLIGHT_BUDGET,
): ReactNode {
  if (!text) return null
  const spans = planSpeakHighlights(text, budget)
  if (!spans.length) return text

  const nodes: ReactNode[] = []
  let cursor = 0
  spans.forEach((s, i) => {
    if (s.start > cursor) {
      nodes.push(
        <Fragment key={`t-${i}-pre`}>{text.slice(cursor, s.start)}</Fragment>,
      )
    }
    const slice = text.slice(s.start, s.end)
    nodes.push(
      <strong
        key={`h-${i}-${s.start}`}
        className={
          s.kind === 'metric'
            ? 'font-semibold tabular-nums text-[#5DD5E3]'
            : 'font-semibold text-white'
        }
      >
        {slice}
      </strong>,
    )
    cursor = s.end
  })
  if (cursor < text.length) {
    nodes.push(<Fragment key="t-tail">{text.slice(cursor)}</Fragment>)
  }
  return nodes
}
