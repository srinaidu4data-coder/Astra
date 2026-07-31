/**
 * Sync live interview UI state between the main window and the stealth overlay.
 *
 * Electron loads the overlay as a separate BrowserWindow (separate JS heap).
 * Zustand in-memory state does not cross windows — without this bridge the
 * overlay always shows "Type a question…" even when the main copilot has answers.
 *
 * Transport (all used; first available wins for push, all used for receive):
 *  1) Electron IPC via preload (most reliable in packaged app)
 *  2) BroadcastChannel (same-origin multi-window)
 *  3) localStorage + storage event (fallback)
 */

import type { SuggestedAnswer } from '@/types'

export type LiveSyncPayload = {
  v: 1
  ts: number
  answer: SuggestedAnswer | null
  listening: boolean
  levels: number[]
  answerMode?: string
}

const CHANNEL = 'interview-pulse-live'
const STORAGE_KEY = 'interview-pulse-live-state'

let channel: BroadcastChannel | null = null
let lastPublished: LiveSyncPayload | null = null
const listeners = new Set<(p: LiveSyncPayload) => void>()

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = (ev) => {
        const data = ev.data as LiveSyncPayload | undefined
        if (data?.v === 1) notify(data)
      }
    } catch {
      channel = null
    }
  }
  return channel
}

function notify(payload: LiveSyncPayload) {
  lastPublished = payload
  for (const cb of listeners) {
    try {
      cb(payload)
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function getLastLiveSync(): LiveSyncPayload | null {
  if (lastPublished) return lastPublished
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as LiveSyncPayload
    if (p?.v === 1) return p
  } catch {
    /* ignore */
  }
  return null
}

/** Publish answer/levels/listening so the overlay (and other windows) update. */
export function publishLiveSync(
  partial: Partial<Omit<LiveSyncPayload, 'v' | 'ts'>> & {
    answer?: SuggestedAnswer | null
  },
): void {
  const prev = getLastLiveSync()
  const payload: LiveSyncPayload = {
    v: 1,
    ts: Date.now(),
    answer: partial.answer !== undefined ? partial.answer : (prev?.answer ?? null),
    listening:
      partial.listening !== undefined
        ? partial.listening
        : (prev?.listening ?? false),
    levels:
      partial.levels !== undefined
        ? partial.levels
        : (prev?.levels ?? Array.from({ length: 24 }, () => 0.08)),
    answerMode: partial.answerMode ?? prev?.answerMode,
  }
  lastPublished = payload

  // 1) Electron IPC → other windows
  try {
    void window.interviewPulse?.publishLiveState?.(payload)
  } catch {
    /* browser / no preload */
  }

  // 2) BroadcastChannel
  try {
    getChannel()?.postMessage(payload)
  } catch {
    /* ignore */
  }

  // 3) localStorage (triggers `storage` in other windows only)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

/**
 * Subscribe to live state from other windows.
 * Immediately delivers last known snapshot (memory / localStorage / Electron).
 */
export function subscribeLiveSync(
  cb: (payload: LiveSyncPayload) => void,
): () => void {
  listeners.add(cb)
  getChannel() // ensure channel is open

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return
    try {
      const p = JSON.parse(e.newValue) as LiveSyncPayload
      if (p?.v === 1) notify(p)
    } catch {
      /* ignore */
    }
  }
  window.addEventListener('storage', onStorage)

  const unsubElectron = window.interviewPulse?.onLiveState?.((p) => {
    if (p && (p as LiveSyncPayload).v === 1) notify(p as LiveSyncPayload)
  })

  // Immediate snapshot
  const snap = getLastLiveSync()
  if (snap) {
    queueMicrotask(() => cb(snap))
  } else {
    void window.interviewPulse?.requestLiveState?.().then((p) => {
      if (p && (p as LiveSyncPayload).v === 1) {
        notify(p as LiveSyncPayload)
      }
    })
  }

  // Ask main window to re-publish (when overlay just opened)
  try {
    void window.interviewPulse?.requestLivePublish?.()
  } catch {
    /* ignore */
  }

  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
    unsubElectron?.()
  }
}
