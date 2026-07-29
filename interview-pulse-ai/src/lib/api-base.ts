/**
 * Resolve copilot API / WebSocket bases for local + production.
 * Prefer Vite env; fall back by hostname so production never sticks on localhost.
 */

function stripSlash(u: string) {
  return u.replace(/\/$/, '')
}

export function resolveCopilotHttpBase(): string {
  const fromEnv = (
    (import.meta.env.VITE_COPILOT_API as string | undefined) ||
    (import.meta.env.VITE_COPILOT_API_URL as string | undefined) ||
    ''
  ).trim()
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

/** Prefer browser mic on public web / HTTPS; system audio only for local Windows-style setups. */
export function preferBrowserMic(): boolean {
  if (typeof window === 'undefined') return true
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    // Local UI can use Stereo Mix when backend is local Windows
    return false
  }
  // Production / pages.dev / any remote host → browser mic
  return true
}
