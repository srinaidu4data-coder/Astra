/**
 * Detach the Speak this answer surface into a separate window.
 *
 * - Desktop (Electron): native always-on-top overlay via openOverlay()
 * - Browser: popup to #/overlay, synced via publishLiveSync / BroadcastChannel
 */

import { isDesktopApp } from '@/lib/desktop'
import { publishLiveSync } from '@/lib/window-sync'
import { useAppStore } from '@/stores/app-store'

export const ANSWER_POPOUT_NAME = 'ip-answer-popout'

const DEFAULT_FEATURES =
  'popup=yes,width=720,height=860,left=100,top=60,resizable=yes,scrollbars=yes,noopener=no'

let browserPopout: Window | null = null

function overlayUrl(): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}#/overlay`
}

/** Push current answer/levels so a just-opened window is not empty. */
export function pushAnswerToPopout(): void {
  const s = useAppStore.getState()
  publishLiveSync({
    answer: s.answer,
    listening: s.listening,
    levels: s.levels,
    answerMode: s.answerMode,
  })
}

export function isAnswerPopoutOpen(): boolean {
  if (isDesktopApp()) return false // Electron manages its own window; no reliable probe
  try {
    return Boolean(browserPopout && !browserPopout.closed)
  } catch {
    return false
  }
}

export function focusAnswerPopout(): boolean {
  if (browserPopout && !browserPopout.closed) {
    try {
      browserPopout.focus()
      return true
    } catch {
      return false
    }
  }
  return false
}

export type OpenAnswerPopoutResult = {
  ok: boolean
  mode: 'electron' | 'browser' | 'failed'
  message?: string
}

/**
 * Open or focus the detached answer window.
 * Safe to call from UI click handlers (user gesture keeps popup unblocked).
 */
export async function openAnswerPopout(): Promise<OpenAnswerPopoutResult> {
  pushAnswerToPopout()

  // Electron native overlay
  if (typeof window !== 'undefined' && window.interviewPulse?.openOverlay) {
    try {
      await window.interviewPulse.openOverlay()
      const stealth = useAppStore.getState().stealth
      await window.interviewPulse.setOverlayOpacity?.(stealth.opacity)
      await window.interviewPulse.setContentProtection?.(stealth.contentProtection)
      // Re-push after open so overlay IPC request is satisfied
      pushAnswerToPopout()
      return { ok: true, mode: 'electron' }
    } catch {
      return {
        ok: false,
        mode: 'failed',
        message: 'Could not open the desktop overlay window.',
      }
    }
  }

  // Already open browser popup
  if (focusAnswerPopout()) {
    pushAnswerToPopout()
    return { ok: true, mode: 'browser' }
  }

  // Browser popup → same SPA on /#/overlay
  let win: Window | null = null
  try {
    win = window.open(overlayUrl(), ANSWER_POPOUT_NAME, DEFAULT_FEATURES)
  } catch {
    win = null
  }

  if (!win) {
    return {
      ok: false,
      mode: 'failed',
      message:
        'Popup blocked. Allow popups for this site, then try Detach again.',
    }
  }

  browserPopout = win
  // Second push after the popup has a chance to load subscribers
  window.setTimeout(() => pushAnswerToPopout(), 120)
  window.setTimeout(() => pushAnswerToPopout(), 500)

  try {
    win.focus()
  } catch {
    /* ignore */
  }

  return { ok: true, mode: 'browser' }
}

/** Browser-only preset dimensions for the popup answer window. */
export const BROWSER_OVERLAY_PRESETS: Record<
  string,
  { width: number; height: number }
> = {
  compact: { width: 420, height: 560 },
  medium: { width: 640, height: 720 },
  large: { width: 800, height: 900 },
  wide: { width: 1000, height: 700 },
  tall: { width: 560, height: 960 },
}

export function applyBrowserWindowPreset(preset: string): {
  width: number
  height: number
} | null {
  if (typeof window === 'undefined') return null
  const screenW = window.screen?.availWidth ?? 1280
  const screenH = window.screen?.availHeight ?? 800

  let width: number
  let height: number
  if (preset === 'max') {
    width = Math.round(screenW * 0.96)
    height = Math.round(screenH * 0.94)
  } else {
    const p = BROWSER_OVERLAY_PRESETS[preset]
    if (!p) return null
    width = Math.min(p.width, screenW - 24)
    height = Math.min(p.height, screenH - 24)
  }

  try {
    const left = Math.max(0, Math.round((screenW - width) / 2))
    const top = Math.max(0, Math.round((screenH - height) / 2))
    window.resizeTo(width, height)
    window.moveTo(left, top)
  } catch {
    /* some browsers restrict resize/move */
  }
  return { width, height }
}

export function toggleBrowserWindowMaximize(maximized: boolean): {
  width: number
  height: number
  maximized: boolean
} {
  const screenW = window.screen?.availWidth ?? 1280
  const screenH = window.screen?.availHeight ?? 800
  if (!maximized) {
    const width = Math.round(screenW * 0.96)
    const height = Math.round(screenH * 0.94)
    try {
      window.resizeTo(width, height)
      window.moveTo(
        Math.max(0, Math.round((screenW - width) / 2)),
        Math.max(0, Math.round((screenH - height) / 2)),
      )
    } catch {
      /* ignore */
    }
    return { width, height, maximized: true }
  }
  // Restore medium
  const m = BROWSER_OVERLAY_PRESETS.medium
  try {
    window.resizeTo(m.width, m.height)
    window.moveTo(
      Math.max(0, Math.round((screenW - m.width) / 2)),
      Math.max(0, Math.round((screenH - m.height) / 2)),
    )
  } catch {
    /* ignore */
  }
  return { width: m.width, height: m.height, maximized: false }
}
