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
 *
 * Prefer VITE_DESKTOP_DOWNLOAD_URL (CDN / GitHub Release).
 * Default Windows: GitHub Release asset (CF Pages cannot host ~100MB+ EXEs —
 * SPA fallback used to serve index.html as "Setup.exe" → "file is corrupted").
 */
const DEFAULT_WIN_INSTALLER =
  'https://github.com/srinaidu4data-coder/Astra/releases/latest/download/InterviewPulse-Setup.exe'

export function getDesktopDownloadUrl(os: DesktopOs = detectDesktopOs()): string {
  const fromEnv = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv

  if (os === 'mac') {
    const mac = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL_MAC as string | undefined)?.trim()
    if (mac) return mac
    return '/downloads/InterviewPulse-Mac.dmg'
  }

  // Windows — never rely on CF Pages for the binary (25MB file limit + SPA HTML)
  return DEFAULT_WIN_INSTALLER
}

/** Minimum expected installer size (bytes). HTML SPA mistakes are ~1–5 KB. */
export const MIN_INSTALLER_BYTES = 5_000_000

/**
 * HEAD/GET probe: real EXE is large binary; corrupted downloads are tiny HTML.
 */
export async function probeDesktopInstaller(
  os: DesktopOs = detectDesktopOs(),
): Promise<{ ok: boolean; url: string; bytes: number | null; hint?: string }> {
  const url = getDesktopDownloadUrl(os)
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    const lenHeader = res.headers.get('content-length')
    const type = (res.headers.get('content-type') || '').toLowerCase()
    const bytes = lenHeader ? Number(lenHeader) : null
    if (!res.ok) {
      return {
        ok: false,
        url,
        bytes,
        hint: `Installer URL returned HTTP ${res.status}.`,
      }
    }
    if (type.includes('text/html')) {
      return {
        ok: false,
        url,
        bytes,
        hint: 'URL returned a web page, not an installer (common SPA misconfig).',
      }
    }
    if (bytes != null && bytes < MIN_INSTALLER_BYTES) {
      return {
        ok: false,
        url,
        bytes,
        hint: `File is only ${bytes} bytes — expected a ~100MB+ EXE.`,
      }
    }
    return { ok: true, url, bytes }
  } catch {
    // CORS may block HEAD from the browser — still allow navigation download
    return {
      ok: true,
      url,
      bytes: null,
      hint: 'Could not verify size in-browser; download will open the release URL.',
    }
  }
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
  // Prefer top-level navigation for cross-origin GitHub Releases (a[download]
  // is ignored cross-origin and some SPA hosts rewrote relative /downloads to HTML).
  window.location.assign(url)
}
