import type { AnswerMode, PipelineMetrics, SuggestedAnswer, TranscriptLine } from '@/types'
import { resolveCopilotHttpBase } from '@/lib/api-base'
import { authHeaders } from '@/services/auth'
import { uid } from '@/lib/utils'

const API_BASE = resolveCopilotHttpBase()

export interface RealPipelineCallbacks {
  onStatus?: (message: string) => void
  onTranscript?: (line: TranscriptLine) => void
  onAnswerDelta?: (answer: SuggestedAnswer) => void
  onAnswerDone?: (answer: SuggestedAnswer) => void
  onMetrics?: (m: PipelineMetrics) => void
  onListening?: (active: boolean) => void
  onError?: (message: string) => void
  onComplete?: (summary: { answered: number; segments: number }) => void
}

export async function checkCopilotHealth(): Promise<{
  ok: boolean
  openai_key?: boolean
  default_audio_wav?: string | null
  whisper_model_ready?: boolean
}> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, {
      signal: AbortSignal.timeout(8000),
      mode: 'cors',
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as {
      ok?: boolean
      openai_key?: boolean
      default_audio_wav?: string | null
      whisper_model_ready?: boolean
    }
    return {
      ok: Boolean(data.ok),
      openai_key: data.openai_key,
      default_audio_wav: data.default_audio_wav,
      whisper_model_ready: data.whisper_model_ready,
    }
  } catch {
    return { ok: false }
  }
}

/**
 * Reliable one-shot answer (JSON, not SSE).
 * Use this for typed questions + format switches so we never drop the final event.
 */
export async function fetchAnswer(
  question: string,
  opts: {
    jobContext?: string
    tone?: string
    mode?: AnswerMode
    /** Explicit override; otherwise server uses JWT user assignment */
    answerModel?: string | null
    fallbackModel?: string | null
  } = {},
  signal?: AbortSignal,
): Promise<SuggestedAnswer> {
  const mode = opts.mode ?? 'star'
  const res = await fetch(`${API_BASE}/api/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      question,
      job_context: opts.jobContext ?? 'AI/ML Engineer',
      tone: opts.tone ?? 'confident',
      mode,
      ...(opts.answerModel ? { answer_model: opts.answerModel } : {}),
      ...(opts.fallbackModel ? { fallback_model: opts.fallbackModel } : {}),
    }),
    signal,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Answer failed (${res.status}): ${errText || res.statusText}`)
  }
  const data = (await res.json()) as {
    answer?: string
    bullets?: string[]
    latency_ms?: number
    question?: string
  }
  return normalizeAnswer({
    id: uid('ans'),
    mode,
    text: data.answer ?? '',
    bullets: data.bullets,
    latencyMs: data.latency_ms,
    question: data.question || question,
  })
}

/** @deprecated Prefer fetchAnswer — kept for callers; now wraps JSON endpoint */
export async function streamAnswer(
  question: string,
  opts: {
    jobContext?: string
    tone?: string
    mode?: AnswerMode
  },
  cb: RealPipelineCallbacks,
  signal?: AbortSignal,
) {
  try {
    const ans = await fetchAnswer(question, opts, signal)
    cb.onAnswerDone?.(ans)
    if (ans.latencyMs != null) {
      cb.onMetrics?.({
        vadMs: 0,
        sttMs: 0,
        firstTokenMs: Math.round(ans.latencyMs * 0.3),
        totalMs: ans.latencyMs,
        lastUpdated: Date.now(),
      })
    }
  } catch (e) {
    cb.onError?.((e as Error).message)
    throw e
  }
}

/**
 * Interview WAV → Whisper STT → answers (SSE).
 * Passes selected mode. Flushes trailing SSE buffer so final answer_done is never lost.
 */
export async function runTestAudioPipeline(
  opts: {
    maxQuestions?: number
    jobContext?: string
    tone?: string
    mode?: AnswerMode
    path?: string
  },
  cb: RealPipelineCallbacks,
  signal?: AbortSignal,
) {
  const mode = opts.mode ?? 'star'
  cb.onStatus?.('Loading interview file for Whisper…')

  const res = await fetch(`${API_BASE}/api/run-test-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      max_questions: opts.maxQuestions ?? 3,
      job_context: opts.jobContext ?? 'AI/ML Engineer',
      tone: opts.tone ?? 'confident',
      mode,
      path: opts.path ?? null,
    }),
    signal,
  })

  if (!res.ok || !res.body) {
    throw new Error(
      res.status === 0
        ? 'Cannot reach copilot API (start: python copilot_api.py on :8787)'
        : `Interview file failed: ${res.status}`,
    )
  }

  let sttMs = 0

  try {
    await readSSE(res.body, (event, data) => {
      if (event === 'status') {
        cb.onStatus?.(String(data.message ?? ''))
      }
      if (event === 'transcript') {
        cb.onTranscript?.({
          id: `seg_${data.index}`,
          role: 'interviewer',
          text: String(data.text ?? ''),
          ts: Date.now(),
          final: Boolean(data.final),
        })
        sttMs = Number(data.stt_ms ?? 0)
      }
      if (event === 'answer_done') {
        const text = String(data.answer ?? '')
        const question = String(data.question ?? 'Interview question')
        const ans = normalizeAnswer({
          id: uid('ans'),
          mode,
          text,
          bullets: Array.isArray(data.bullets) ? (data.bullets as string[]) : undefined,
          latencyMs: Number(data.pipeline_ms ?? 0),
          question,
        })
        cb.onAnswerDone?.(ans)
        cb.onMetrics?.({
          vadMs: 100,
          sttMs: Number(data.stt_ms ?? sttMs),
          firstTokenMs: Number(data.first_token_ms ?? 0),
          totalMs: Number(data.pipeline_ms ?? 0),
          lastUpdated: Date.now(),
        })
        sttMs = 0
      }
      if (event === 'complete') {
        cb.onComplete?.({
          answered: Number(data.answered ?? 0),
          segments: Number(data.segments ?? 0),
        })
      }
      if (event === 'error') {
        cb.onError?.(String(data.message ?? 'pipeline error'))
      }
    })
  } finally {
    cb.onListening?.(false)
  }
}

export function normalizeAnswer(input: {
  id: string
  mode: AnswerMode
  text: string
  bullets?: string[]
  latencyMs?: number
  question?: string
}): SuggestedAnswer {
  const text = (input.text || '').trim()
  let bullets =
    input.bullets?.map((b) => b.trim()).filter(Boolean) ??
    splitAnswerLines(text)

  // Guarantee something visible
  if (bullets.length === 0 && text) {
    bullets = [text]
  }

  const star = parseStar(text, bullets)
  const codeSnippet =
    input.mode === 'code'
      ? extractCode(text) ||
        `// Outline for: ${input.question ?? 'question'}\n// 1) Clarify constraints\n// 2) Sketch approach\n// 3) Walk through tradeoffs`
      : undefined

  return {
    id: input.id,
    mode: input.mode,
    bullets,
    star: input.mode === 'star' ? star : undefined,
    codeSnippet,
    metrics: extractMetrics(text),
    streaming: false,
    latencyMs: input.latencyMs,
    question: input.question,
  }
}

function parseStar(text: string, bullets: string[]) {
  const empty = { situation: '', task: '', action: '', result: '' }
  const src = bullets.length ? bullets.join('\n') : text
  const grab = (label: string) => {
    const re = new RegExp(`${label}\\s*[:—-]\\s*(.+)`, 'i')
    const m = src.match(re)
    return m?.[1]?.trim() ?? ''
  }
  const s = grab('Situation') || grab('S')
  const t = grab('Task') || grab('T')
  const a = grab('Action') || grab('A')
  const r = grab('Result') || grab('R')
  if (s || t || a || r) {
    return { situation: s, task: t, action: a, result: r }
  }
  if (bullets.length >= 4) {
    return {
      situation: bullets[0],
      task: bullets[1],
      action: bullets[2],
      result: bullets[3],
    }
  }
  return empty
}

function extractCode(text: string): string | undefined {
  const fence = text.match(/```(?:\w+)?\n?([\s\S]*?)```/)
  if (fence) return fence[1].trim()
  if (text.includes('function') || text.includes('const ') || text.includes('def ')) {
    return text
  }
  return undefined
}

function splitAnswerLines(text: string): string[] {
  if (!text.trim()) return []
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
  if (lines.length >= 2) return lines
  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
}

function extractMetrics(text: string): string[] {
  const matches = text.match(
    /\b\d+(\.\d+)?\s?(%|x|X|k|K|M|ms|s|QPS|users)?\b/g,
  )
  return matches?.slice(0, 6) ?? []
}

/** SSE reader that ALWAYS flushes the trailing buffer when the stream ends. */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'

  const consume = (chunk: string) => {
    buffer += chunk
    // Normalize Windows newlines
    buffer = buffer.replace(/\r\n/g, '\n')
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      dispatchBlock(block)
    }
  }

  const dispatchBlock = (block: string) => {
    if (!block.trim()) return
    let ev = event
    let data = ''
    for (const raw of block.split('\n')) {
      const line = raw.trimEnd()
      if (line.startsWith('event:')) {
        ev = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trimStart()
      }
    }
    if (!data) return
    try {
      onEvent(ev, JSON.parse(data) as Record<string, unknown>)
    } catch {
      onEvent(ev, { message: data })
    }
    event = 'message'
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      consume(decoder.decode())
      // Flush any remaining incomplete block as a final event
      if (buffer.trim()) {
        dispatchBlock(buffer)
        buffer = ''
      }
      break
    }
    consume(decoder.decode(value, { stream: true }))
  }
}

export { API_BASE }
