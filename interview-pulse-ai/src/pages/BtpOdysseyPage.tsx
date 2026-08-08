import { ExternalLink, Gamepad2, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

/**
 * Resolve BTP Odyssey host:
 * - VITE_BTP_ODYSSEY_URL (build-time override)
 * - local dev → localhost:8787 (btp-odyssey API serves SPA)
 * - production → dedicated Railway service
 */
export function resolveBtpOdysseyUrl(): string {
  const fromEnv = (import.meta.env.VITE_BTP_ODYSSEY_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')

  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:8787'
    }
  }
  // Production Railway service (jobinterviewcracker project)
  return 'https://btp-odyssey-production.up.railway.app'
}

/**
 * Full-viewport SAP BTP Odyssey — top-level nav between Mock and Analytics.
 * Embeds the Odyssey game (API + SPA).
 */
export function BtpOdysseyPage() {
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const url = useMemo(() => resolveBtpOdysseyUrl(), [])

  return (
    <div className="flex h-[min(100dvh,920px)] min-h-[70vh] flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#070b12] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] bg-black/40 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#20B8CD]/12 ring-1 ring-[#20B8CD]/25">
            <Gamepad2 className="h-3.5 w-3.5 text-[#5DD5E3]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium tracking-tight text-white/90">
              SAP BTP Odyssey
            </div>
            <div className="truncate text-[10px] text-white/35">
              Architect · Build · Operate · Defend
            </div>
          </div>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] text-white/45 transition hover:text-[#5DD5E3]"
          title="Open in a new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">Open full screen</span>
        </a>
      </header>

      <div className="relative min-h-0 flex-1 bg-[#05080f]">
        {loading && !failed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#070b12]/90 text-white/50">
            <Loader2 className="h-6 w-6 animate-spin text-[#5DD5E3]" />
            <p className="text-[13px]">Loading BTP Odyssey…</p>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="max-w-md text-[14px] leading-relaxed text-white/60">
              Could not load BTP Odyssey. If you are on localhost, start it with{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#5DD5E3]">
                START_BTP_ODYSSEY.bat
              </code>{' '}
              or open the production game.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#20B8CD]/20 px-4 py-2 text-[13px] font-medium text-[#5DD5E3] ring-1 ring-[#20B8CD]/35"
              >
                <ExternalLink className="h-4 w-4" />
                Open BTP Odyssey
              </a>
            </div>
          </div>
        )}
        <iframe
          title="SAP BTP Odyssey"
          src={url}
          className="h-full w-full border-0"
          allow="fullscreen; clipboard-read; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false)
            setFailed(true)
          }}
        />
      </div>
    </div>
  )
}
