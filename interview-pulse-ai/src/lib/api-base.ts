/**
 * Resolve copilot API / WebSocket bases for local + production.
 * Prefer Vite env; fall back by hostname so production never sticks on localhost.
 *
 * Localhost: use same-origin (empty base) so Vite proxy forwards /api and /v1
 * to :8787 — fixes "Failed to fetch" when UI is open but direct cross-port
 * calls fail or the API host string is wrong.
 */

function stripSlash(u: string) {
  return u.replace(/\/$/, '')
}

function isLocalHostName(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host)
  )
}

export function resolveCopilotHttpBase(): string {
  const fromEnv = (
    (import.meta.env.VITE_COPILOT_API as string | undefined) ||
    (import.meta.env.VITE_COPILOT_API_URL as string | undefined) ||
    ''
  ).trim()
  // On local dev, ignore env pointing at production so Job Search lab works
  if (typeof window !== 'undefined' && isLocalHostName(window.location.hostname)) {
    // Same-origin → Vite proxy (/api, /v1) → copilot_api :8787
    if (!fromEnv || fromEnv.includes('jobinterviewcracker.com')) {
      return '' // relative URLs: /api/..., /v1/...
    }
    return stripSlash(fromEnv)
  }
  if (fromEnv) return stripSlash(fromEnv)

  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'jobinterviewcracker.com' || host === 'www.jobinterviewcracker.com') {
      return 'https://api.jobinterviewcracker.com'
    }
    if (host.endsWith('.pages.dev')) {
      return 'https://api.jobinterviewcracker.com'
    }
  }
  return 'http://127.0.0.1:8787'
}

export function resolveCopilotWsUrl(): string {
  const fromEnv = (import.meta.env.VITE_COPILOT_WS as string | undefined)?.trim()
  if (typeof window !== 'undefined' && isLocalHostName(window.location.hostname)) {
    if (!fromEnv || fromEnv.includes('jobinterviewcracker.com')) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${proto}//${window.location.host}/ws/interview`
    }
    return fromEnv
  }
  if (fromEnv) return fromEnv

  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (
      host === 'jobinterviewcracker.com' ||
      host === 'www.jobinterviewcracker.com' ||
      host.endsWith('.pages.dev')
    ) {
      return 'wss://api.jobinterviewcracker.com/ws/interview'
    }
  }
  return 'ws://127.0.0.1:8787/ws/interview'
}

/**
 * Interview audio source — **speakers / loopback only by default**.
 *
 * Competitors (Final Round, Cluely, LockedIn desktop) listen to PC output so the
 * candidate's own spoken answers are NOT transcribed. Mic is never the default.
 *
 * - `system`  — server-side Stereo Mix / WASAPI loopback (best on local Windows)
 * - `display` — browser getDisplayMedia tab/system audio (web + cloud)
 * - `mic`     — last-resort getUserMedia (explicit opt-in only; picks up your voice)
 *
 * Override: localStorage `ip_audio_source` = system | display | mic | browser
 * (browser is treated as mic for backward compatibility)
 */
export type InterviewAudioSource = 'system' | 'display' | 'mic'

/** True when the copilot API is not on this machine (cloud / remote). */
export function isRemoteCopilotApi(): boolean {
  const base = resolveCopilotHttpBase()
  if (!base) {
    // Same-origin: only local if page itself is local
    if (typeof window === 'undefined') return false
    return !isLocalHostName(window.location.hostname)
  }
  try {
    const u = new URL(base)
    return !isLocalHostName(u.hostname)
  } catch {
    return true
  }
}

/**
 * Resolve capture mode. Cloud API never uses server `system` loopback
 * (Railway has no Stereo Mix) — support ticket #2.
 */
export function resolveInterviewAudioSource(): InterviewAudioSource {
  if (typeof window === 'undefined') return 'display'
  let forced = ''
  try {
    forced = (localStorage.getItem('ip_audio_source') || '').trim().toLowerCase()
  } catch {
    /* ignore */
  }
  // Remote API: system loopback is on the *server* and will fail — force display
  if (isRemoteCopilotApi()) {
    if (forced === 'mic' || forced === 'browser' || forced === 'microphone') return 'mic'
    return 'display'
  }
  if (forced === 'system') return 'system'
  if (forced === 'display' || forced === 'speaker' || forced === 'speakers') return 'display'
  if (forced === 'mic' || forced === 'browser' || forced === 'microphone') return 'mic'
  // Localhost → prefer OS loopback on the Python host (no mic)
  if (isLocalHostName(window.location.hostname)) return 'system'
  // Production web → share tab / system audio dialog (no mic)
  return 'display'
}

/** @deprecated use resolveInterviewAudioSource — kept for older callers */
export function preferBrowserMic(): boolean {
  return resolveInterviewAudioSource() === 'mic'
}
