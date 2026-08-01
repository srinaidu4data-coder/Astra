/**
 * SpeakCanvas v0 — sparse impact highlighting.
 * Cap 8 spans; never bold full sentences (MAX_SPAN_WORDS).
 * Mechanism: glance attention under dual-task speak load.
 */

import { Fragment, type ReactNode } from 'react'

export const HIGHLIGHT_BUDGET = 8
/** Reject spans longer than this (anti full-sentence bold) */
export const MAX_SPAN_WORDS = 4

const METRIC_RE =
  /(\$?\d+(?:[.,]\d+)?\s*(?:%|x|ms|s|k|m|b|hrs?|mins?|weeks?|days?|mo(?:nths)?|years?)?\b|\bp\d{2}\b|\bSLA\b)/gi

const OWNERSHIP_RE =
  /\b(I\s+(?:led|owned|shipped|built|designed|drove|reduced|cut|improved|delivered|launched|migrated|fixed|architected|scaled|negotiated|mentored))\b/gi

export type ImpactSpan = {
  start: number
  end: number
  kind: 'metric' | 'ownership'
  score: number
}

function scoreMatch(kind: ImpactSpan['kind']): number {
  return kind === 'metric' ? 3 : 2
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function collect(regex: RegExp, text: string, kind: ImpactSpan['kind']): ImpactSpan[] {
  const out: ImpactSpan[] = []
  const re = new RegExp(regex.source, regex.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (wordCount(m[0]) > MAX_SPAN_WORDS) continue
    out.push({ start, end, kind, score: scoreMatch(kind) })
  }
  return out
}

function nonOverlappingTop(spans: ImpactSpan[], budget: number): ImpactSpan[] {
  const sorted = [...spans].sort((a, b) => b.score - a.score || a.start - b.start)
  const picked: ImpactSpan[] = []
  for (const s of sorted) {
    if (picked.length >= budget) break
    if (picked.some((p) => !(s.end <= p.start || s.start >= p.end))) continue
    picked.push(s)
  }
  return picked.sort((a, b) => a.start - b.start)
}

/** Plan highlight spans for one text block (respect budget). */
export function planHighlights(
  text: string,
  budget: number = HIGHLIGHT_BUDGET,
): ImpactSpan[] {
  if (!text || budget <= 0) return []
  const all = [
    ...collect(METRIC_RE, text, 'metric'),
    ...collect(OWNERSHIP_RE, text, 'ownership'),
  ]
  return nonOverlappingTop(all, budget)
}

/** Render text with sparse impact emphasis. */
export function renderHighlightedText(
  text: string,
  budget: number = HIGHLIGHT_BUDGET,
): ReactNode {
  if (!text) return null
  const spans = planHighlights(text, budget)
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
