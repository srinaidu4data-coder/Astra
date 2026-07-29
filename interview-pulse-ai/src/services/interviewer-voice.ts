/**
 * Spoken interviewer for audio mock interviews.
 * Prefers OpenAI TTS via /v1/mock/tts; falls back to browser SpeechSynthesis.
 */

import { resolveCopilotHttpBase } from '@/lib/api-base'
import type { MockPersona } from './mock-interview'

const API_BASE = resolveCopilotHttpBase()

export type SpeakOptions = {
  persona?: MockPersona
  /** Prefer browser voice only (skip network TTS) */
  browserOnly?: boolean
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

let currentAudio: HTMLAudioElement | null = null
let speaking = false

export function stopInterviewerSpeech() {
  speaking = false
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.src = ''
    } catch {
      /* ignore */
    }
    currentAudio = null
  }
}

export function isInterviewerSpeaking() {
  return speaking
}

function personaRate(persona: MockPersona | undefined): number {
  switch (persona) {
    case 'friendly-recruiter':
      return 1.05
    case 'behavioral-hr':
      return 0.98
    case 'system-design':
      return 0.95
    case 'strict-tech-lead':
    default:
      return 0.96
  }
}

function pickBrowserVoice(persona: MockPersona | undefined): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const en = voices.filter((v) => /^en(-|_)/i.test(v.lang) || /english/i.test(v.name))
  const pool = en.length ? en : voices

  const prefer = (preds: ((v: SpeechSynthesisVoice) => boolean)[]) => {
    for (const p of preds) {
      const hit = pool.find(p)
      if (hit) return hit
    }
    return null
  }

  if (persona === 'friendly-recruiter' || persona === 'behavioral-hr') {
    return (
      prefer([
        (v) => /female|samantha|victoria|zira|google us english/i.test(v.name),
        (v) => /en-US/i.test(v.lang),
      ]) || pool[0]!
    )
  }
  return (
    prefer([
      (v) => /male|david|mark|daniel|google uk english male|microsoft david/i.test(v.name),
      (v) => /en-US|en-GB/i.test(v.lang),
    ]) || pool[0]!
  )
}

function speakBrowser(text: string, opts: SpeakOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('Speech synthesis not available'))
      return
    }
    // Chrome often returns empty voices until this event
    const start = () => {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = personaRate(opts.persona)
      u.pitch = opts.persona === 'friendly-recruiter' ? 1.05 : 1.0
      u.volume = 1
      const voice = pickBrowserVoice(opts.persona)
      if (voice) u.voice = voice

      u.onstart = () => {
        speaking = true
        opts.onStart?.()
      }
      u.onend = () => {
        speaking = false
        opts.onEnd?.()
        resolve()
      }
      u.onerror = () => {
        speaking = false
        opts.onError?.('Speech synthesis error')
        // Still resolve so interview flow continues
        resolve()
      }
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    }

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => start()
      // Fallback if event never fires
      window.setTimeout(start, 250)
    } else {
      start()
    }
  })
}

async function speakOpenAiTts(text: string, opts: SpeakOptions): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/mock/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, persona: opts.persona || 'strict-tech-lead' }),
  })
  if (!res.ok) {
    throw new Error(`TTS ${res.status}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(url)
    currentAudio = audio
    audio.onplay = () => {
      speaking = true
      opts.onStart?.()
    }
    audio.onended = () => {
      speaking = false
      currentAudio = null
      URL.revokeObjectURL(url)
      opts.onEnd?.()
      resolve()
    }
    audio.onerror = () => {
      speaking = false
      currentAudio = null
      URL.revokeObjectURL(url)
      reject(new Error('Audio playback failed'))
    }
    void audio.play().catch(reject)
  })
}

/**
 * Speak interviewer line. Stops any current speech first.
 * Returns when finished (or on soft failure after browser fallback).
 */
export async function speakInterviewer(text: string, opts: SpeakOptions = {}): Promise<void> {
  const line = (text || '').trim()
  if (!line) {
    opts.onEnd?.()
    return
  }
  stopInterviewerSpeech()

  if (!opts.browserOnly) {
    try {
      await speakOpenAiTts(line, opts)
      return
    } catch {
      // fall through to browser
    }
  }

  try {
    await speakBrowser(line, opts)
  } catch (e) {
    speaking = false
    opts.onError?.((e as Error).message)
    opts.onEnd?.()
  }
}
