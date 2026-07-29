/** Detect Electron shell vs browser. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!window.interviewPulse
}

export type DesktopOs = 'windows' | 'mac' | 'linux' | 'other'

export function detectDesktopOs(): DesktopOs {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows'
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) return 'mac'
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux'
  return 'other'
}

/**
 * Installer / download URL.
 * Prefer VITE_DESKTOP_DOWNLOAD_URL (e.g. GitHub Releases or CDN).
 * Fallback: static file under public/downloads/ served with the web app.
 */
export function getDesktopDownloadUrl(os: DesktopOs = detectDesktopOs()): string {
  const fromEnv = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv

  if (os === 'mac') {
    const mac = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL_MAC as string | undefined)?.trim()
    if (mac) return mac
    return '/downloads/InterviewPulse-Mac.dmg'
  }

  // Default / Windows
  return '/downloads/InterviewPulse-Setup.exe'
}

/** Custom protocol registered by the packaged Electron app. */
export const DESKTOP_PROTOCOL = 'interviewpulse://open'

/**
 * Try to launch the installed desktop app via custom protocol.
 * Resolves true if the page is likely to hand off (best-effort — browsers
 * do not expose a reliable "app opened" signal).
 */
export function tryOpenDesktopApp(): void {
  // Hidden iframe is less disruptive than top-level navigation for some browsers.
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = DESKTOP_PROTOCOL
  document.body.appendChild(iframe)
  window.setTimeout(() => {
    iframe.remove()
  }, 2000)
}

export function startDesktopDownload(os: DesktopOs = detectDesktopOs()): void {
  const url = getDesktopDownloadUrl(os)
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.rel = 'noopener'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
