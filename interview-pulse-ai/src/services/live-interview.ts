import type { AnswerMode, SuggestedAnswer } from '@/types'
import { normalizeAnswer } from './real-api'
import { uid } from '@/lib/utils'

const WS_URL =
  import.meta.env.VITE_COPILOT_WS ?? 'ws://127.0.0.1:8787/ws/interview'

export type LiveEvent =
  | { type: 'status'; message?: string; listening?: boolean; device?: string }
  | { type: 'listening'; active: boolean; device?: string; message?: string }
  | { type: 'level'; level: number; state?: string; noise_floor?: number }
  | { type: 'transcript'; text: string; stt_ms?: number; final?: boolean }
  | { type: 'question'; text: string; raw?: string }
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
  onQuestion?: (text: string) => void
  onChatter?: (text: string, reason?: string) => void
  onAnswerPending?: (question: string) => void
  onAnswer?: (answer: SuggestedAnswer) => void
  onError?: (message: string) => void
  onConnection?: (state: 'open' | 'closed' | 'error') => void
}

/**
 * WebSocket client for continuous live interview backend.
 * Start once → stays connected and listening until stop().
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
  } | null = null

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
      const ws = new WebSocket(WS_URL)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectAttempt = 0
        this.handlers.onConnection?.('open')
        this.handlers.onStatus?.('Backend connected')
        // Resume live session after reconnect if we were listening
        if (this.wasListening && this.lastStartOpts) {
          try {
            this.send({
              type: 'start',
              job_context: this.lastStartOpts.jobContext ?? 'AI/ML Engineer',
              tone: this.lastStartOpts.tone ?? 'confident',
              mode: this.lastStartOpts.mode ?? this.mode,
            })
            this.handlers.onStatus?.('Reconnected — live session resumed')
          } catch {
            // ignore
          }
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

  private scheduleReconnect() {
    if (this.intentionalClose) return
    if (this.reconnectTimer) return
    this.reconnectAttempt += 1
    const delay = Math.min(8000, 800 * this.reconnectAttempt)
    this.handlers.onStatus?.(
      `Backend offline — retry in ${Math.round(delay / 1000)}s (start: python copilot_api.py)`,
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
      case 'question':
        this.handlers.onQuestion?.(String((data as { text?: string }).text ?? ''))
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
        }
        const mode = (a.mode as AnswerMode) || this.mode
        const text = a.answer ?? ''
        const bullets =
          Array.isArray(a.bullets) && a.bullets.length
            ? a.bullets
            : text
              ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
              : ['(empty answer from model)']
        const ans = normalizeAnswer({
          id: uid('ans'),
          mode,
          text,
          bullets,
          latencyMs: a.pipeline_ms,
          question: a.question,
        })
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
      throw new Error('Backend WebSocket not open — is copilot_api.py running?')
    }
  }

  async start(opts: {
    jobContext?: string
    tone?: string
    mode?: AnswerMode
  }) {
    await this.ensureOpen()
    this.mode = opts.mode ?? 'star'
    this.lastStartOpts = { ...opts, mode: this.mode }
    this.wasListening = true
    this.send({
      type: 'start',
      job_context: opts.jobContext ?? 'AI/ML Engineer',
      tone: opts.tone ?? 'confident',
      mode: this.mode,
    })
  }

  stop() {
    this.wasListening = false
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
