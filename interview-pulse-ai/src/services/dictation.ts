/**
 * Practice Dictate: capture mic PCM → 16 kHz WAV → Whisper via copilot API.
 * More reliable than browser SpeechRecognition (which often never fires onresult).
 */

const API_BASE =
  (import.meta.env.VITE_COPILOT_API as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8787'

const TARGET_RATE = 16000
/** Send a clip about this often while speaking */
const FLUSH_MS = 2800
/** Also flush after this much silence following speech */
const SILENCE_FLUSH_MS = 900
const ENERGY_THRESHOLD = 0.012

export type DictationHandlers = {
  onText?: (text: string) => void
  onLevels?: (levels: number[]) => void
  onStatus?: (message: string) => void
  onError?: (message: string) => void
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
      sum += input[j]
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

function encodeWav(int16: Int16Array, sampleRate: number): ArrayBuffer {
  const dataSize = int16.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  let o = 44
  for (let i = 0; i < int16.length; i++, o += 2) {
    view.setInt16(o, int16[i]!, true)
  }
  return buffer
}

export async function transcribeWav(wav: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
    signal,
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `Transcribe failed (${res.status})`)
  }
  const data = (await res.json()) as { text?: string }
  return (data.text || '').trim()
}

/**
 * Continuous mic dictation: holds getUserMedia open, flushes speech clips to Whisper.
 */
export class MicDictation {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private mute: GainNode | null = null
  private running = false
  private chunks: Float32Array[] = []
  private chunkSamples = 0
  private lastVoiceAt = 0
  private hadVoiceInClip = false
  private clipStartedAt = 0
  private flushing = false
  private handlers: DictationHandlers = {}
  private abort: AbortController | null = null

  get active() {
    return this.running
  }

  async start(handlers: DictationHandlers = {}) {
    await this.stop()
    this.handlers = handlers
    this.running = true
    this.chunks = []
    this.chunkSamples = 0
    this.hadVoiceInClip = false
    this.abort = new AbortController()

    handlers.onStatus?.('Requesting microphone…')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })
    } catch (e) {
      this.running = false
      const msg =
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone permission denied — allow mic access in the browser, then try Dictate again.'
          : `Could not open microphone: ${(e as Error).message || e}`
      handlers.onError?.(msg)
      throw new Error(msg)
    }

    this.ctx = new AudioContext()
    // Some browsers start suspended until a user gesture (we are in one)
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => undefined)
    }

    this.source = this.ctx.createMediaStreamSource(this.stream)
    // ScriptProcessor is deprecated but widely available; buffer size 4096
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.mute = this.ctx.createGain()
    this.mute.gain.value = 0

    this.clipStartedAt = performance.now()
    this.lastVoiceAt = 0

    this.processor.onaudioprocess = (ev) => {
      if (!this.running || !this.ctx) return
      const input = ev.inputBuffer.getChannelData(0)
      const copy = new Float32Array(input.length)
      copy.set(input)
      this.chunks.push(copy)
      this.chunkSamples += copy.length

      // Levels for waveform UI
      let sum = 0
      for (let i = 0; i < copy.length; i++) sum += copy[i]! * copy[i]!
      const rms = Math.sqrt(sum / Math.max(1, copy.length))
      if (rms >= ENERGY_THRESHOLD) {
        this.hadVoiceInClip = true
        this.lastVoiceAt = performance.now()
      }
      const levels = Array.from({ length: 32 }, (_, i) => {
        const idx = Math.floor((i / 32) * copy.length)
        return Math.min(1, Math.abs(copy[idx] ?? 0) * 8 + rms * 3)
      })
      this.handlers.onLevels?.(levels)

      const now = performance.now()
      const elapsed = now - this.clipStartedAt
      const silentLongEnough =
        this.hadVoiceInClip &&
        this.lastVoiceAt > 0 &&
        now - this.lastVoiceAt >= SILENCE_FLUSH_MS

      if (
        !this.flushing &&
        this.hadVoiceInClip &&
        (elapsed >= FLUSH_MS || silentLongEnough) &&
        this.chunkSamples > this.ctx.sampleRate * 0.35
      ) {
        void this.flush()
      }
    }

    this.source.connect(this.processor)
    // Must connect to destination for some browsers to process (muted)
    this.processor.connect(this.mute)
    this.mute.connect(this.ctx.destination)

    handlers.onStatus?.('Listening — speak your answer')
    // Warm Whisper in background so first flush is faster
    void fetch(`${API_BASE}/api/warm`, { method: 'POST' }).catch(() => undefined)
  }

  private takeClip(): Float32Array | null {
    if (!this.ctx || this.chunks.length === 0) return null
    const total = this.chunkSamples
    if (total < this.ctx.sampleRate * 0.25) return null
    const merged = new Float32Array(total)
    let o = 0
    for (const c of this.chunks) {
      merged.set(c, o)
      o += c.length
    }
    this.chunks = []
    this.chunkSamples = 0
    this.hadVoiceInClip = false
    this.clipStartedAt = performance.now()
    return downsample(merged, this.ctx.sampleRate, TARGET_RATE)
  }

  private async flush() {
    if (this.flushing || !this.running) return
    this.flushing = true
    try {
      const clip = this.takeClip()
      if (!clip || clip.length < TARGET_RATE * 0.25) return

      // Skip near-silent clips
      let peak = 0
      for (let i = 0; i < clip.length; i++) peak = Math.max(peak, Math.abs(clip[i]!))
      if (peak < 0.008) return

      this.handlers.onStatus?.('Transcribing…')
      const pcm = floatTo16BitPCM(clip)
      const wav = encodeWav(pcm, TARGET_RATE)
      const text = await transcribeWav(wav, this.abort?.signal)
      if (text) {
        this.handlers.onText?.(text)
        this.handlers.onStatus?.('Listening — speak your answer')
      } else if (this.running) {
        this.handlers.onStatus?.('Listening — speak a bit louder')
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      this.handlers.onError?.((e as Error).message || 'Transcription failed')
      if (this.running) {
        this.handlers.onStatus?.('Listening — try again')
      }
    } finally {
      this.flushing = false
    }
  }

  async stop() {
    this.running = false
    this.abort?.abort()
    this.abort = null

    // Final flush of remaining speech
    if (this.hadVoiceInClip && this.chunkSamples > 0) {
      try {
        const clip = this.takeClip()
        if (clip && clip.length >= TARGET_RATE * 0.25) {
          let peak = 0
          for (let i = 0; i < clip.length; i++) peak = Math.max(peak, Math.abs(clip[i]!))
          if (peak >= 0.008) {
            const pcm = floatTo16BitPCM(clip)
            const wav = encodeWav(pcm, TARGET_RATE)
            const text = await transcribeWav(wav)
            if (text) this.handlers.onText?.(text)
          }
        }
      } catch {
        /* ignore on stop */
      }
    }

    try {
      this.processor?.disconnect()
      this.source?.disconnect()
      this.mute?.disconnect()
    } catch {
      /* ignore */
    }
    this.processor = null
    this.source = null
    this.mute = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
    this.chunks = []
    this.chunkSamples = 0
    this.flushing = false
  }
}
