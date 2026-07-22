import type { AudioDeviceInfo } from '@/types'

/** Enumerate browser media devices (mic). System loopback needs Electron native hooks. */
export async function listAudioDevices(): Promise<AudioDeviceInfo[]> {
  try {
    // Prompt once so labels are populated
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch {
    // permission denied — still list what we can
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `${d.kind} (${d.deviceId.slice(0, 6)})`,
      kind: d.kind as 'audioinput' | 'audiooutput',
    }))
}

export class WaveformMonitor {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private raf = 0
  private data: Uint8Array | null = null

  async start(deviceId?: string, onLevels?: (levels: number[]) => void) {
    await this.stop()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    })
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 64
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.analyser)
    this.data = new Uint8Array(this.analyser.frequencyBinCount)

    const tick = () => {
      if (!this.analyser || !this.data) return
      this.analyser.getByteFrequencyData(this.data as unknown as Uint8Array<ArrayBuffer>)
      const levels = Array.from(this.data)
        .slice(0, 24)
        .map((v) => v / 255)
      onLevels?.(levels)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  async stop() {
    cancelAnimationFrame(this.raf)
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.analyser = null
    this.source = null
    this.stream = null
    this.data = null
  }
}

/**
 * Lightweight energy-based VAD stand-in for Silero.
 * Production path: ONNX Silero VAD for ~100ms end-of-turn.
 */
export class EnergyVAD {
  private threshold: number
  private silenceMs: number
  private lastVoice = 0
  private speaking = false

  constructor(threshold = 0.08, silenceMs = 700) {
    this.threshold = threshold
    this.silenceMs = silenceMs
  }

  /** levels: normalized 0-1 bands */
  update(levels: number[]): 'speech' | 'end' | 'silence' {
    const energy = levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length)
    const now = performance.now()
    if (energy >= this.threshold) {
      this.lastVoice = now
      this.speaking = true
      return 'speech'
    }
    if (this.speaking && now - this.lastVoice >= this.silenceMs) {
      this.speaking = false
      return 'end'
    }
    return this.speaking ? 'speech' : 'silence'
  }
}
