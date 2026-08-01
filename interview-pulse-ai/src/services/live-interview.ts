import type { AnswerMode, PipelineMetrics, SuggestedAnswer } from '@/types'
import {
  resolveCopilotWsUrl,
  resolveInterviewAudioSource,
  type InterviewAudioSource,
} from '@/lib/api-base'
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
  /** Deepgram interim partials while interviewer is still speaking */
  onTranscriptPartial?: (text: string, meta?: { final?: boolean; stt_provider?: string }) => void
  onChatter?: (text: string, reason?: string) => void
  onAnswerPending?: (question: string) => void
  onAnswer?: (answer: SuggestedAnswer) => void
  onMetrics?: (m: PipelineMetrics) => void
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
 * Default: speakers only (share-tab audio or system Stereo Mix) so the
 * candidate's mic answers are never transcribed. Mic is explicit opt-in only.
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
    /** Wire protocol to backend: browser = client PCM, system = server loopback */
    source?: 'browser' | 'system'
    audioMode?: InterviewAudioSource
    userAnswerModel?: string | null
    userFallbackModel?: string | null
    answerModel?: string | null
    fallbackModel?: string | null
  } | null = null

  // Client-side PCM capture (display/system audio or explicit mic fallback)
  private mediaStream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private mediaSource: MediaStreamAudioSourceNode | null = null
  private micActive = false
  private clientCaptureMode: 'display' | 'mic' | null = null
  /** Throttle streaming answer UI paints to cut flicker */
  private _lastStreamUiAt = 0
  private _lastStreamLen = 0
  private _lastLevelUiAt = 0

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
      // Re-open client capture only for display/mic paths (not pure server system)
      const mode = this.lastStartOpts.audioMode ?? resolveInterviewAudioSource()
      if (mode !== 'system' && !this.micActive) {
        if (mode === 'display') await this.startSpeakerCapture()
        else await this.startBrowserMic()
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
      case 'level': {
        // Cap level events ~4/s — higher rates re-painted the whole copilot UI
        const now = Date.now()
        if (now - this._lastLevelUiAt < 220) break
        this._lastLevelUiAt = now
        this.handlers.onLevel?.(
          Number((data as { level?: number }).level ?? 0),
          (data as { state?: string }).state,
        )
        break
      }
      case 'transcript':
        this.handlers.onTranscript?.(String((data as { text?: string }).text ?? ''))
        break
      case 'transcript_partial': {
        const p = data as {
          text?: string
          final?: boolean
          stt_provider?: string
        }
        this.handlers.onTranscriptPartial?.(String(p.text ?? ''), {
          final: p.final,
          stt_provider: p.stt_provider,
        })
        break
      }
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
          llm_first_token_ms?: number
          answer_ms?: number
          full_answer_ms?: number
          total_pipeline_ms?: number
          stt_ms?: number
          classify_ms?: number
          cache_ms?: number
          outline_ms?: number
          streaming?: boolean
          source?: string
          depth?: string
          job_id?: number | string
          stages?: Record<string, number | null | undefined>
          latency_trace?: Record<string, unknown>
        }
        const mode = (a.mode as AnswerMode) || this.mode
        const text = a.answer ?? ''
        const bullets =
          Array.isArray(a.bullets) && a.bullets.length
            ? a.bullets
            : text
              ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
              : ['(empty answer from model)']
        // Prefer first-token latency for the Latency tile (honest first paint)
        const latency =
          a.first_token_ms ?? a.pipeline_ms ?? a.answer_ms
        // Stable id per question so streaming tokens don't remount the whole panel
        const qKey = String(a.question || '').trim().toLowerCase().slice(0, 80)
        const stableId =
          a.job_id != null
            ? `job_${a.job_id}`
            : qKey
              ? `q_${qKey.replace(/\s+/g, '_').slice(0, 48)}`
              : uid('ans')
        const ans = normalizeAnswer({
          id: stableId,
          mode,
          text,
          bullets,
          latencyMs: latency,
          question: a.question,
        })
        ans.streaming = Boolean(a.streaming)
        // Guarantee UI has something to render
        if (!ans.bullets.length && text) ans.bullets = [text]
        // Throttle intermediate stream paints (~3/s) — finals always pass
        if (a.streaming) {
          const now = Date.now()
          if (
            now - this._lastStreamUiAt < 280 &&
            text.length - this._lastStreamLen < 48
          ) {
            return
          }
          this._lastStreamUiAt = now
          this._lastStreamLen = text.length
        } else {
          this._lastStreamLen = 0
        }
        this.handlers.onAnswer?.(ans)
        // Full stage metrics for competitor dashboard
        if (!a.streaming) {
          this.handlers.onMetrics?.({
            vadMs: 0,
            sttMs: Number(a.stt_ms ?? 0),
            firstTokenMs: Number(a.first_token_ms ?? latency ?? 0),
            totalMs: Number(a.first_token_ms ?? latency ?? 0),
            lastUpdated: Date.now(),
            classifyMs: a.classify_ms != null ? Number(a.classify_ms) : undefined,
            cacheMs: a.cache_ms != null ? Number(a.cache_ms) : undefined,
            outlineMs: a.outline_ms != null ? Number(a.outline_ms) : undefined,
            llmFirstTokenMs:
              a.llm_first_token_ms != null ? Number(a.llm_first_token_ms) : undefined,
            fullAnswerMs: Number(a.full_answer_ms ?? a.answer_ms ?? 0) || undefined,
            totalPipelineMs:
              a.total_pipeline_ms != null ? Number(a.total_pipeline_ms) : undefined,
            source: a.source,
            depth: a.depth,
          })
        }
        break
      }
      case 'latency': {
        const L = data as {
          stt_ms?: number
          first_token_ms?: number
          full_answer_ms?: number
          total_ms?: number
          outline_ms?: number
          cache_ms?: number
          classify_ms?: number
          llm_first_token_ms?: number
          source?: string
          depth?: string
        }
        this.handlers.onMetrics?.({
          vadMs: 0,
          sttMs: Number(L.stt_ms ?? 0),
          firstTokenMs: Number(L.first_token_ms ?? 0),
          totalMs: Number(L.first_token_ms ?? L.total_ms ?? 0),
          lastUpdated: Date.now(),
          classifyMs: L.classify_ms != null ? Number(L.classify_ms) : undefined,
          cacheMs: L.cache_ms != null ? Number(L.cache_ms) : undefined,
          outlineMs: L.outline_ms != null ? Number(L.outline_ms) : undefined,
          llmFirstTokenMs:
            L.llm_first_token_ms != null ? Number(L.llm_first_token_ms) : undefined,
          fullAnswerMs: L.full_answer_ms != null ? Number(L.full_answer_ms) : undefined,
          totalPipelineMs: L.total_ms != null ? Number(L.total_ms) : undefined,
          source: L.source,
          depth: L.depth,
        })
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

  /**
   * Capture what plays on speakers / shared tab — NOT the candidate mic.
   * Uses getDisplayMedia (same pattern as web interview copilots).
   * User should share the Teams/Zoom tab or "System audio" / entire screen with audio.
   */
  private async startSpeakerCapture() {
    if (this.micActive) return
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        'Speaker capture needs a modern browser (Chrome/Edge). ' +
          'Share the interview tab with audio, or enable Stereo Mix (system mode).',
      )
    }

    // Chromium: systemAudio + prefer tab surface. Video track is required by the
    // API but stopped immediately — we only keep audio (interviewer / meeting).
    const constraints: DisplayMediaStreamOptions = {
      video: {
        // Prefer sharing a browser tab (Teams/Meet in Chrome)
        displaySurface: 'browser',
        width: { max: 1 },
        height: { max: 1 },
        frameRate: { max: 1 },
      } as MediaTrackConstraints,
      audio: {
        // Critical: do not process as a "voice call" mic — keep meeting mix clean
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      } as MediaTrackConstraints,
      // @ts-expect-error Chromium extensions
      systemAudio: 'include',
      // @ts-expect-error Chromium
      preferCurrentTab: false,
      // @ts-expect-error Chromium
      selfBrowserSurface: 'exclude',
      // @ts-expect-error Chromium
      monitorTypeSurfaces: 'include',
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(constraints)
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      if (name === 'NotAllowedError') {
        throw new Error(
          'Screen/tab share cancelled. To hear the interviewer only: share the ' +
            'Teams/Zoom tab and enable "Share tab audio" (or system audio). ' +
            'We do not use your microphone by default.',
        )
      }
      throw e
    }

    // Drop video immediately — audio-only pipeline
    stream.getVideoTracks().forEach((t) => {
      try {
        t.stop()
      } catch {
        /* ignore */
      }
    })
    const audioTracks = stream.getAudioTracks()
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error(
        'No audio in the share. In Chrome: share a tab and check "Also share tab audio", ' +
          'or share the entire screen with system audio. Mic is not used for interviews.',
      )
    }

    // If user stops sharing, end capture cleanly
    audioTracks[0]!.onended = () => {
      this.handlers.onStatus?.(
        'Speaker share ended — interview audio stopped. Start again and re-share the meeting tab.',
        false,
      )
      this.stop()
    }

    this.mediaStream = new MediaStream(audioTracks)
    this.clientCaptureMode = 'display'
    await this._wirePcmFromStream(this.mediaStream)
  }

  /** Explicit mic fallback only (not recommended — captures your answers too). */
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
    this.clientCaptureMode = 'mic'
    await this._wirePcmFromStream(stream)
  }

  private async _wirePcmFromStream(stream: MediaStream) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    this.audioCtx = ctx
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const source = ctx.createMediaStreamSource(stream)
    this.mediaSource = source
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

      let sum = 0
      for (let i = 0; i < copy.length; i++) sum += copy[i]! * copy[i]!
      const rms = Math.sqrt(sum / Math.max(1, copy.length))
      this.handlers.onLevel?.(Math.min(1, rms * 4), 'hearing')
    }

    source.connect(processor)
    const mute = ctx.createGain()
    mute.gain.value = 0
    processor.connect(mute)
    mute.connect(ctx.destination)
    this.micActive = true
  }

  private stopBrowserMic() {
    this.micActive = false
    this.clientCaptureMode = null
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
    /**
     * High-level capture mode. Default: speakers only (system or display).
     * Never uses mic unless explicitly set to 'mic'.
     */
    audioMode?: InterviewAudioSource
    /** Low-level wire source override (advanced) */
    source?: 'browser' | 'system'
    userAnswerModel?: string | null
    userFallbackModel?: string | null
    answerModel?: string | null
    fallbackModel?: string | null
    deepgramKey?: string | null
    sttProvider?: 'auto' | 'deepgram' | 'whisper' | null
  }) {
    await this.ensureOpen()
    this.mode = opts.mode ?? 'star'
    const audioMode = opts.audioMode ?? resolveInterviewAudioSource()
    // Backend: "system" = server loopback; "browser" = client PCM stream
    const wireSource: 'browser' | 'system' =
      opts.source ?? (audioMode === 'system' ? 'system' : 'browser')
    this.lastStartOpts = {
      ...opts,
      mode: this.mode,
      source: wireSource,
      audioMode,
    }
    this.wasListening = true
    const models = this.modelPayload(opts)
    const sttPayload = {
      ...(opts.deepgramKey
        ? { deepgram_api_key: opts.deepgramKey, deepgram_key: opts.deepgramKey }
        : {}),
      ...(opts.sttProvider && opts.sttProvider !== 'auto'
        ? { stt_provider: opts.sttProvider }
        : {}),
    }

    const baseStart = {
      type: 'start' as const,
      job_context: opts.jobContext ?? 'AI/ML Engineer',
      tone: opts.tone ?? 'confident',
      mode: this.mode,
      ...models,
      ...sttPayload,
    }

    if (audioMode === 'system') {
      // Server captures PC speakers (Stereo Mix / WASAPI). No mic opened.
      this.send({ ...baseStart, source: 'system' })
      this.handlers.onStatus?.(
        'Listening to PC speakers (system audio) — your mic is off. Play the interview on this computer.',
        true,
      )
      return
    }

    if (audioMode === 'display') {
      // Share meeting tab / system audio — not the candidate microphone
      await this.startSpeakerCapture()
      this.send({ ...baseStart, source: 'browser' })
      this.handlers.onStatus?.(
        'Listening to shared tab/system audio — your mic is off. Keep the interview tab shared with audio.',
        true,
      )
      return
    }

    // Explicit mic fallback only
    await this.startBrowserMic()
    this.send({ ...baseStart, source: 'browser' })
    this.handlers.onStatus?.(
      '⚠ Mic mode — your spoken answers may be transcribed. Prefer Speakers / share-tab audio.',
      true,
    )
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

  /** Manual question inject when STT lags (skips audio path). */
  injectQuestion(question: string, opts?: { depth?: string; jobContext?: string }) {
    const q = (question || '').trim()
    if (!q) throw new Error('Empty question')
    this.send({
      type: 'inject',
      question: q,
      ...(opts?.depth ? { depth: opts.depth } : {}),
      ...(opts?.jobContext ? { job_context: opts.jobContext } : {}),
    })
  }

  setDepth(depth: 'fast' | 'balanced' | 'deep') {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'set_depth', depth })
      }
    } catch {
      // ignore
    }
  }

  requestLatencySnapshot() {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'latency_snapshot' })
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
