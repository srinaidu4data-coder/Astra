import { SAMPLE_QUESTIONS } from '@/lib/demo-data'
import { sleep, uid } from '@/lib/utils'
import type {
  AnswerMode,
  PipelineMetrics,
  StarMemory,
  SuggestedAnswer,
  TranscriptLine,
} from '@/types'
import { rankMemories } from './parser'

export interface PipelineCallbacks {
  onTranscript?: (line: TranscriptLine) => void
  onAnswerDelta?: (answer: SuggestedAnswer) => void
  onAnswerDone?: (answer: SuggestedAnswer) => void
  onMetrics?: (m: PipelineMetrics) => void
  onListening?: (active: boolean) => void
}

/**
 * Sub-1s demo pipeline orchestrator.
 * Simulates: VAD (~100ms) → STT (~250ms) → RAG + first token (<400ms).
 * Swap generators with Deepgram/Claude/OpenAI streaming when keys present.
 */
export class InterviewPipeline {
  private running = false
  private demoTimer: ReturnType<typeof setInterval> | null = null
  private questionIdx = 0
  private memories: StarMemory[] = []
  private mode: AnswerMode = 'star'
  private jobContext = ''

  setMemories(memories: StarMemory[]) {
    // User materials only — never rehydrate with baked-in demo skill stories
    this.memories = memories.length ? memories : []
  }

  setMode(mode: AnswerMode) {
    this.mode = mode
  }

  setJobContext(ctx: string) {
    this.jobContext = ctx || ''
  }

  isRunning() {
    return this.running
  }

  /**
   * demoLoop defaults to FALSE — never auto-fire fake Q&A unless explicitly requested.
   * Prefer injectQuestion() for one-shot answers.
   */
  async start(cb: PipelineCallbacks, opts?: { demoLoop?: boolean }) {
    if (this.running) return
    this.running = true
    cb.onListening?.(true)

    // Opt-in only. Auto loop was flooding Whisper Stream with unrelated text.
    if (opts?.demoLoop === true) {
      await this.runOneTurn(cb)
      this.demoTimer = setInterval(() => {
        if (this.running) void this.runOneTurn(cb)
      }, 14000)
    }
  }

  stop(cb?: PipelineCallbacks) {
    this.running = false
    if (this.demoTimer) {
      clearInterval(this.demoTimer)
      this.demoTimer = null
    }
    cb?.onListening?.(false)
  }

  async injectQuestion(question: string, cb: PipelineCallbacks) {
    await this.processQuestion(question, cb)
  }

  private async runOneTurn(cb: PipelineCallbacks) {
    if (!SAMPLE_QUESTIONS.length) {
      // No canned skill questions — demo loop is a no-op without user materials
      return
    }
    const q = SAMPLE_QUESTIONS[this.questionIdx % SAMPLE_QUESTIONS.length]
    this.questionIdx++
    await this.processQuestion(q, cb)
  }

  private async processQuestion(question: string, cb: PipelineCallbacks) {
    const t0 = performance.now()

    // 1) Local VAD end-of-turn (~100ms)
    await sleep(90 + Math.random() * 40)
    const vadMs = performance.now() - t0

    // 2) Streaming STT deltas
    const sttStart = performance.now()
    const partials = chunkWords(question, 4)
    let acc = ''
    const lineId = uid('tr')
    for (const part of partials) {
      acc = acc ? `${acc} ${part}` : part
      cb.onTranscript?.({
        id: lineId,
        role: 'interviewer',
        text: acc,
        ts: Date.now(),
        final: false,
      })
      await sleep(40 + Math.random() * 50)
    }
    cb.onTranscript?.({
      id: lineId,
      role: 'interviewer',
      text: question,
      ts: Date.now(),
      final: true,
    })
    const sttMs = performance.now() - sttStart

    // 3) Prompt orchestrator + top-3 memories
    const top = rankMemories(question, this.memories, 3)
    const draft = buildAnswer(question, top, this.mode, this.jobContext)

    // 4) LLM streaming first token target <400ms from end of STT
    const llmStart = performance.now()
    await sleep(180 + Math.random() * 120)
    const firstTokenMs = performance.now() - llmStart

    const answerId = uid('ans')
    const streaming: SuggestedAnswer = {
      id: answerId,
      mode: this.mode,
      bullets: [],
      star: this.mode === 'star' ? { situation: '', task: '', action: '', result: '' } : undefined,
      codeSnippet: this.mode === 'code' ? '' : undefined,
      metrics: draft.metrics,
      streaming: true,
    }

    // Stream STAR / bullets
    if (this.mode === 'star' && draft.star) {
      for (const key of ['situation', 'task', 'action', 'result'] as const) {
        const full = draft.star[key]
        let built = ''
        for (const ch of full) {
          built += ch
          streaming.star = { ...streaming.star!, [key]: built }
          cb.onAnswerDelta?.({ ...streaming })
          await sleep(8)
        }
      }
    }

    streaming.bullets = []
    for (const bullet of draft.bullets) {
      let built = ''
      const idx = streaming.bullets.length
      streaming.bullets = [...streaming.bullets, '']
      for (const word of bullet.split(' ')) {
        built = built ? `${built} ${word}` : word
        streaming.bullets[idx] = built
        cb.onAnswerDelta?.({ ...streaming, bullets: [...streaming.bullets] })
        await sleep(18)
      }
    }

    if (this.mode === 'code' && draft.codeSnippet) {
      let built = ''
      for (const line of draft.codeSnippet.split('\n')) {
        built += (built ? '\n' : '') + line
        streaming.codeSnippet = built
        cb.onAnswerDelta?.({ ...streaming })
        await sleep(40)
      }
    }

    const totalMs = performance.now() - t0
    const final: SuggestedAnswer = {
      ...streaming,
      streaming: false,
      latencyMs: totalMs,
      bullets: draft.bullets,
      star: draft.star,
      codeSnippet: draft.codeSnippet,
      metrics: draft.metrics,
      question,
    }
    cb.onAnswerDone?.(final)
    cb.onMetrics?.({
      vadMs,
      sttMs,
      firstTokenMs,
      totalMs,
      lastUpdated: Date.now(),
    })
  }
}

function chunkWords(text: string, size: number): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < words.length; i += size) {
    out.push(words.slice(i, i + size).join(' '))
  }
  return out
}

function buildAnswer(
  question: string,
  memories: StarMemory[],
  mode: AnswerMode,
  jobContext: string,
): SuggestedAnswer {
  const primary = memories[0]
  const metrics = primary?.metrics?.length
    ? primary.metrics
    : ['sub-second latency', 'measurable impact']

  const star = {
    situation:
      primary?.situation ||
      `In a recent ${jobContext} project, we faced a high-stakes delivery window.`,
    task:
      primary?.task ||
      `I owned the response plan while keeping quality bars for ${jobContext}.`,
    action:
      primary?.action ||
      'I broke the problem into measurable slices, validated with data, and shipped iteratively with tight feedback loops.',
    result:
      primary?.result ||
      `We hit the target outcome and created a repeatable playbook for the team.`,
  }

  if (mode === 'shorter') {
    return {
      id: uid('ans'),
      mode,
      bullets: [
        `Context: ${star.situation}`,
        `Action: ${star.action}`,
        `Result: ${star.result}`,
      ],
      metrics,
      streaming: false,
    }
  }

  if (mode === 'technical') {
    return {
      id: uid('ans'),
      mode,
      bullets: [
        `Architecture lens: ${question.includes('design') ? 'edge capture → VAD → WS STT → RAG → stream LLM' : 'profile → isolate bottleneck → instrument → ship'}`,
        `Implementation detail: ${star.action}`,
        `Validation: metrics ${metrics.join(', ')} under production-like load`,
        `Tradeoff: favor deterministic local VAD over cloud-only endpointer for ~100ms turn detection`,
      ],
      metrics,
      streaming: false,
    }
  }

  if (mode === 'code') {
    return {
      id: uid('ans'),
      mode,
      bullets: [
        'Outline first, then implement the critical path.',
        'Call out complexity and failure modes briefly.',
      ],
      codeSnippet: `// Real-time turn pipeline sketch
async function onAudioFrame(frame: Float32Array) {
  if (!vad.isSpeechEnd(frame)) return;
  const partial = await stt.stream(frame);      // ~250ms
  const ctx = await rag.topK(partial, 3);       // resume snippets
  for await (const token of llm.stream({ q: partial, ctx })) {
    overlay.write(token);                       // first token <400ms
  }
}`,
      metrics,
      streaming: false,
    }
  }

  // STAR default
  return {
    id: uid('ans'),
    mode: 'star',
    bullets: [
      `S — ${star.situation}`,
      `T — ${star.task}`,
      `A — ${star.action}`,
      `R — ${star.result}`,
    ],
    star,
    metrics,
    streaming: false,
  }
}

export const pipeline = new InterviewPipeline()
