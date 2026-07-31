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
 * Prefer browser mic for the live interview path.
 *
 * Stereo Mix / system loopback is opt-in only (local Windows advanced). Defaulting
 * localhost to system audio was breaking the flow for most users (silent capture,
 * no transcript, no answer).
 */
export function preferBrowserMic(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const forced = localStorage.getItem('ip_audio_source')
    if (forced === 'system') return false
    if (forced === 'browser') return true
  } catch {
    /* ignore */
  }
  // Default: always browser mic (works on web + localhost)
  return true
}
