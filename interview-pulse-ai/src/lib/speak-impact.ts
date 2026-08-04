/**
 * SpeakCanvas impact chips + speak-sheet helpers.
 * Pulls the few words that carry the answer for a glance strip —
 * never replaces the full body.
 */

import {
  collectSpeakCandidates,
  type SpeakHighlightKind,
  type SpeakHighlightSpan,
} from '@/lib/speak-highlight'

const KIND_RANK: Record<SpeakHighlightKind, number> = {
  punch: 6,
  decision: 5,
  metric: 4,
  buzz: 3.5,
  term: 3,
  ownership: 2,
  outcome: 2,
}

export type ImpactChip = {
  text: string
  kind: SpeakHighlightKind
  score: number
}

/** Top impact tokens across all answer parts (deduped, max n). */
export function collectImpactChips(
  parts: string[],
  max = 6,
): ImpactChip[] {
  const pool: ImpactChip[] = []
  for (const part of parts) {
    if (!part?.trim()) continue
    for (const s of collectSpeakCandidates(part)) {
      const text = part.slice(s.start, s.end).trim()
      if (!text || text.length > 40) continue
      pool.push({
        text,
        kind: s.kind,
        score: s.score * (KIND_RANK[s.kind] ?? 1),
      })
    }
  }
  // Prefer higher score; dedupe case-insensitive
  pool.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: ImpactChip[] = []
  for (const c of pool) {
    const k = c.text.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
    if (out.length >= max) break
  }
  return out
}

/** Plain speak sheet: labels + body for clipboard. */
export function buildSpeakSheet(
  rows: Array<{ label: string; text: string }>,
): string {
  return rows
    .filter((r) => r.text.trim())
    .map((r) => `${r.label}\n${r.text.trim()}`)
    .join('\n\n')
}

/**
 * Build a speak sheet from STAR or bullet answers.
 * Splits atomic "Hook: Token." + rest into Answer + Explain when present.
 */
export function buildSpeakSheetFromAnswer(answer: {
  star?: Partial<
    Record<'situation' | 'task' | 'action' | 'result', string | undefined>
  > | null
  bullets?: string[] | null
}): string {
  const rows: Array<{ label: string; text: string }> = []
  const star = answer.star
  if (star && (star.situation || star.task || star.action || star.result)) {
    const order: Array<['situation' | 'task' | 'action' | 'result', string]> = [
      ['situation', 'S · Situation'],
      ['task', 'T · Task'],
      ['action', 'A · Action'],
      ['result', 'R · Result'],
    ]
    for (const [k, lab] of order) {
      const t = star[k]
      if (t?.trim()) rows.push({ label: lab, text: t })
    }
    return buildSpeakSheet(rows)
  }
  const bullets = (answer.bullets || []).filter((b) => b?.trim())
  if (!bullets.length) return ''
  // Atomic punch on first bullet
  const first = bullets[0]!
  const m = first
    .split(/\r?\n/)[0]
    ?.trim()
    .match(
      /^(?:(?:Hook|Answer|Thesis)\s*[:—–-]\s*)?([A-Za-z0-9][\w./+-]*(?:\s+[A-Za-z0-9][\w./+-]*){0,3})\s*\.\s*$/i,
    )
  if (m) {
    rows.push({ label: 'Answer', text: `${m[1]!.trim()}.` })
    const rest = first.slice(first.split(/\r?\n/)[0]!.length).replace(/^\s*\n?/, '').trim()
    if (rest) rows.push({ label: 'Explain', text: rest })
    bullets.slice(1).forEach((b, i) => {
      rows.push({ label: i === 0 ? 'Proof' : i === bullets.length - 2 ? 'Close' : `Beat ${i + 2}`, text: b })
    })
  } else {
    bullets.forEach((b, i) => {
      const lab =
        /^(?:Cool|Wit|Spark)\s*[:—–-]/i.test(b.trim())
          ? 'Cool'
          : i === 0
            ? 'Hook'
            : i === bullets.length - 1 && bullets.length > 1
              ? 'Close'
              : i === 1 && bullets.length >= 3
                ? 'Proof'
                : `Beat ${i + 1}`
      rows.push({ label: lab, text: b })
    })
  }
  return buildSpeakSheet(rows)
}

/** Map highlight spans to chip-friendly display from already-planned spans. */
export function chipsFromSpans(
  parts: string[],
  spanSets: SpeakHighlightSpan[][],
  max = 6,
): ImpactChip[] {
  const pool: ImpactChip[] = []
  parts.forEach((part, i) => {
    for (const s of spanSets[i] ?? []) {
      const text = part.slice(s.start, s.end).trim()
      if (!text) continue
      pool.push({
        text,
        kind: s.kind,
        score: s.score * (KIND_RANK[s.kind] ?? 1),
      })
    }
  })
  pool.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: ImpactChip[] = []
  for (const c of pool) {
    const k = c.text.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
    if (out.length >= max) break
  }
  // Fallback: scan full candidates if freeze left us empty mid-stream
  if (out.length < 2) {
    return collectImpactChips(parts, max)
  }
  return out
}
