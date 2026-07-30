import type { AnswerMode, SuggestedAnswer } from '@/types'
import { preferBrowserMic, resolveCopilotWsUrl } from '@/lib/api-base'
import { normalizeAnswer } from './real-api'
import { uid } from '@/lib/utils'

export type LiveEvent =
  | { type: 'status'; message?: string; listening?: boolean; device?: string }
  | { type: 'listening'; active: boolean; device?: string; message?: string }
  | { type: 'level'; level: number; state?: string; noise_floor?: number }
  | { type: 'transcript'; text: string; stt_ms?: number; final?: boolean }
  | { type: 'chatter'; text: string; reason?: string }
  | {
      type: 'answer'
      question: string
      answer: string
      bullets?: string[]
      mode?: string
      stt_ms?: number
      answer_ms?: number
      pipeline_ms?: number
    }
  | { type: 'error'; message: string }
  | { type: 'pong' }
  | { type: string; [k: string]: unknown }

export type LiveHandlers = {
  onStatus?: (message: string, listening?: boolean) => void
  onListening?: (active: boolean, device?: string) => void
  onLevel?: (level: number, state?: string) => void
  onTranscript?: (text: string) => void
  onChatter?: (text: string, reason?: string) => void
  onAnswerPending?: (question: string) => void
  onAnswer?: (answer: SuggestedAnswer) => void
  onError?: (message: string) => void
  onConnection?: (state: 'open' | 'closed' | 'error') => void
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    let n = 0
    for (let j = start; j < end; j++) {
      sum += input[j]!
      n++
    }
    out[i] = n > 0 ? sum / n : input[start] ?? 0
  }
  return out
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i] ?? 0))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/**
 * WebSocket client for continuous live interview backend.
 * On web/cloud: streams browser microphone PCM to the API.
 * Local Windows can still request system (Stereo Mix) capture.
 */
export class LiveInterviewClient {
  private ws: WebSocket | null = null
  private handlers: LiveHandlers = {}
  private intentionalClose = false
  private mode: AnswerMode = 'star'
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private wasListening = false
  private lastStartOpts: {
    jobContext?: string
    tone?: string
    mode?: AnswerMode
    source?: 'browser' | 'system'
    userAnswerModel?: string | null
    userFallbackModel?: string | null
    answerModel?: string | null
    fallbackModel?: string | null
  } | null = null

  // Browser mic streaming
  private mediaStream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private mediaSource: MediaStreamAudioSourceNode | null = null
  private micActive = false

  connect(handlers: LiveHandlers) {
    this.handlers = handlers
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.intentionalClose = false
    this.openSocket()
  }

  private openSocket() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      const wsUrl = resolveCopilotWsUrl()
      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectAttempt = 0
        this.handlers.onConnection?.('open')
        this.handlers.onStatus?.('Backend connected')
        // Resume live session after reconnect if we were listening
        if (this.wasListening && this.lastStartOpts) {
          void this.resumeAfterReconnect()
        }
      }
      ws.onclose = () => {
        this.ws = null
        this.handlers.onConnection?.('closed')
        if (!this.intentionalClose) {
          this.handlers.onError?.('Backend connection closed — reconnecting…')
          this.handlers.onListening?.(false)
          this.scheduleReconnect()
        }
      }
      ws.onerror = () => {
        this.handlers.onConnection?.('error')
        // onclose will schedule reconnect
      }
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as LiveEvent
          this.dispatch(data)
        } catch {
          // ignore
        }
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private modelPayload(opts: {
    userAnswerModel?: string | null
    userFallbackModel?: string | null
    answerModel?: string | null
    fallbackModel?: string | null
  }) {
    return {
      ...(opts.userAnswerModel
        ? { user_answer_model: opts.userAnswerModel }
        : {}),
      ...(opts.userFallbackModel
        ? { user_fallback_model: opts.userFallbackModel }
        : {}),
      ...(opts.answerModel ? { answer_model: opts.answerModel } : {}),
      ...(opts.fallbackModel ? { fallback_model: opts.fallbackModel } : {}),
    }
  }

  private async resumeAfterReconnect() {
    if (!this.lastStartOpts) return
    try {
      this.send({
        type: 'start',
        job_context: this.lastStartOpts.jobContext ?? 'AI/ML Engineer',
        tone: this.lastStartOpts.tone ?? 'confident',
        mode: this.lastStartOpts.mode ?? this.mode,
        source: this.lastStartOpts.source ?? 'browser',
        ...this.modelPayload(this.lastStartOpts),
      })
      if ((this.lastStartOpts.source ?? 'browser') === 'browser' && !this.micActive) {
        await this.startBrowserMic()
      }
      this.handlers.onStatus?.('Reconnected — live session resumed')
    } catch {
      // ignore
    }
  }

  private scheduleReconnect() {
    if (this.intentionalClose) return
    if (this.reconnectTimer) return
    this.reconnectAttempt += 1
    const delay = Math.min(8000, 800 * this.reconnectAttempt)
    this.handlers.onStatus?.(
      `Backend offline — retry in ${Math.round(delay / 1000)}s`,
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
  }

  private dispatch(data: LiveEvent) {
    switch (data.type) {
      case 'status':
        this.handlers.onStatus?.(
          String(data.message ?? ''),
          data.listening as boolean | undefined,
        )
        break
      case 'listening':
        this.handlers.onListening?.(
          Boolean((data as { active?: boolean }).active),
          (data as { device?: string }).device,
        )
        if ((data as { message?: string }).message) {
          this.handlers.onStatus?.(String((data as { message?: string }).message))
        }
        break
      case 'level':
        this.handlers.onLevel?.(
          Number((data as { level?: number }).level ?? 0),
          (data as { state?: string }).state,
        )
        break
      case 'transcript':
        this.handlers.onTranscript?.(String((data as { text?: string }).text ?? ''))
        break
      case 'answer_pending':
        this.handlers.onAnswerPending?.(
          String((data as { question?: string }).question ?? ''),
        )
        break
      case 'chatter':
        this.handlers.onChatter?.(
          String((data as { text?: string }).text ?? ''),
          (data as { reason?: string }).reason,
        )
        break
      case 'answer': {
        const a = data as {
          question?: string
          answer?: string
          bullets?: string[]
          mode?: string
          pipeline_ms?: number
          first_token_ms?: number
          answer_ms?: number
          streaming?: boolean
        }
        const mode = (a.mode as AnswerMode) || this.mode
        const text = a.answer ?? ''
        const bullets =
          Array.isArray(a.bullets) && a.bullets.length
            ? a.bullets
            : text
              ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
              : ['(empty answer from model)']
        // Prefer first-token latency for the Latency tile (sub-1s target)
        const latency =
          a.first_token_ms ?? a.pipeline_ms ?? a.answer_ms
        const ans = normalizeAnswer({
          id: uid('ans'),
          mode,
          text,
          bullets,
          latencyMs: latency,
          question: a.question,
        })
        ans.streaming = Boolean(a.streaming)
        // Guarantee UI has something to render
        if (!ans.bullets.length && text) ans.bullets = [text]
        this.handlers.onAnswer?.(ans)
        break
      }
      case 'error':
        this.handlers.onError?.(String((data as { message?: string }).message ?? 'error'))
        break
      default:
        break
    }
  }

  private send(obj: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to backend')
    }
    this.ws.send(JSON.stringify(obj))
  }

  private sendPcm(int16: Int16Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || int16.length === 0) return
    // Copy into a standalone ArrayBuffer (avoid SharedArrayBuffer typing issues)
    const buf = new ArrayBuffer(int16.byteLength)
    new Int16Array(buf).set(int16)
    this.ws.send(buf)
  }

  async ensureOpen(timeoutMs = 4000) {
    const isOpen = () => this.ws != null && this.ws.readyState === 1 // OPEN
    if (isOpen()) return
    this.connect(this.handlers)
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (isOpen()) return
      if (this.ws != null && this.ws.readyState === 3) break // CLOSED
      await new Promise((r) => setTimeout(r, 50))
    }
    if (!isOpen()) {
      throw new Error(
        `Backend WebSocket not open (${resolveCopilotWsUrl()}). Is the API running?`,
      )
    }
  }

  private async startBrowserMic() {
    if (this.micActive) return
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser microphone not available (use HTTPS or localhost)')
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
      video: false,
    })
    this.mediaStream = stream

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    this.audioCtx = ctx
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const source = ctx.createMediaStreamSource(stream)
    this.mediaSource = source
    // ScriptProcessor is deprecated but widely supported for PCM tap without worklet deploy
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    this.processor = processor
    const inputRate = ctx.sampleRate
    const targetRate = 16000

    processor.onaudioprocess = (ev) => {
      if (!this.micActive) return
      const input = ev.inputBuffer.getChannelData(0)
      const copy = new Float32Array(input.length)
      copy.set(input)
      const down = downsample(copy, inputRate, targetRate)
      const pcm = floatTo16BitPCM(down)
      this.sendPcm(pcm)

      // Local waveform feedback while waiting for server levels
      let sum = 0
      for (let i = 0; i < copy.length; i++) sum += copy[i]! * copy[i]!
      const rms = Math.sqrt(sum / Math.max(1, copy.length))
      this.handlers.onLevel?.(Math.min(1, rms * 4), 'hearing')
    }

    source.connect(processor)
    // Keep graph alive without audible monitor (avoid feedback)
    const mute = ctx.createGain()
    mute.gain.value = 0
    processor.connect(mute)
    mute.connect(ctx.destination)
    this.micActive = true
  }

  private stopBrowserMic() {
    this.micActive = false
    try {
      this.processor?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      this.mediaSource?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      this.mediaStream?.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    try {
      void this.audioCtx?.close()
    } catch {
      /* ignore */
    }
    this.processor = null
    this.mediaSource = null
    this.mediaStream = null
    this.audioCtx = null
  }

  async start(opts: {
    jobContext?: string
    tone?: string
    mode?: AnswerMode
    source?: 'browser' | 'system'
    /** User-assigned primary from admin console */
    userAnswerModel?: string | null
    /** User-assigned fallback from admin console */
    userFallbackModel?: string | null
    answerModel?: string | null
    fallbackModel?: string | null
  }) {
    await this.ensureOpen()
    this.mode = opts.mode ?? 'star'
    const source = opts.source ?? (preferBrowserMic() ? 'browser' : 'system')
    this.lastStartOpts = { ...opts, mode: this.mode, source }
    this.wasListening = true
    const models = this.modelPayload(opts)

    if (source === 'browser') {
      // Open mic first so permission UX is immediate; then start server session
      await this.startBrowserMic()
      this.send({
        type: 'start',
        job_context: opts.jobContext ?? 'AI/ML Engineer',
        tone: opts.tone ?? 'confident',
        mode: this.mode,
        source: 'browser',
        ...models,
      })
      this.handlers.onStatus?.(
        'Listening via browser mic — play interviewer audio aloud or speak questions',
        true,
      )
    } else {
      this.send({
        type: 'start',
        job_context: opts.jobContext ?? 'AI/ML Engineer',
        tone: opts.tone ?? 'confident',
        mode: this.mode,
        source: 'system',
        ...models,
      })
    }
  }

  stop() {
    this.wasListening = false
    this.stopBrowserMic()
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'stop' })
      }
    } catch {
      // ignore
    }
  }

  setMode(mode: AnswerMode) {
    this.mode = mode
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'set_mode', mode })
      }
    } catch {
      // ignore
    }
  }

  disconnect() {
    this.intentionalClose = true
    this.wasListening = false
    this.stopBrowserMic()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stop()
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    this.ws = null
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

export const liveInterview = new LiveInterviewClient()
