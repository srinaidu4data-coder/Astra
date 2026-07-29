import { Button } from '@/components/ui/button'
import {
  detectDesktopOs,
  getDesktopDownloadUrl,
  isDesktopApp,
  startDesktopDownload,
  tryOpenDesktopApp,
  type DesktopOs,
} from '@/lib/desktop'
import { cn } from '@/lib/utils'
import { Download, Monitor, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

type Props = {
  /** compact = TopBar chip; card = Settings block; link = text-style */
  variant?: 'compact' | 'card' | 'link'
  className?: string
}

const OS_LABEL: Record<DesktopOs, string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
  other: 'Desktop',
}

/**
 * Web-only entry to the desktop app: open if installed, or download installer.
 * Hidden when already running inside Electron.
 */
export function DesktopOption({ variant = 'compact', className }: Props) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const os = detectDesktopOs()

  // Never show inside the Electron shell
  if (isDesktopApp()) return null

  if (variant === 'card') {
    return (
      <div
        className={cn(
          'rounded-[18px] border border-[#20B8CD]/25 bg-[#20B8CD]/[0.08] px-5 py-4',
          className,
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-white/90">Desktop app</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/45">
              Stealth hide-from-screen-share, whisper overlay, and system audio work
              best in the desktop app — not in a browser tab.
            </p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Monitor className="h-3.5 w-3.5" strokeWidth={1.75} />
            Desktop option
          </Button>
        </div>
        {open && <DesktopModal os={os} titleId={titleId} onClose={() => setOpen(false)} />}
      </div>
    )
  }

  if (variant === 'link') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'inline-flex items-center gap-1.5 text-[12px] text-[#5DD5E3] hover:underline',
            className,
          )}
        >
          <Monitor className="h-3.5 w-3.5" strokeWidth={1.75} />
          Desktop option
        </button>
        {open && <DesktopModal os={os} titleId={titleId} onClose={() => setOpen(false)} />}
      </>
    )
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        title="Download or open the desktop app"
        className={className}
      >
        <Monitor className="h-3.5 w-3.5" strokeWidth={1.75} />
        Desktop
      </Button>
      {open && <DesktopModal os={os} titleId={titleId} onClose={() => setOpen(false)} />}
    </>
  )
}

function DesktopModal({
  os,
  titleId,
  onClose,
}: {
  os: DesktopOs
  titleId: string
  onClose: () => void
}) {
  const downloadUrl = getDesktopDownloadUrl(os)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-md rounded-[24px] border border-white/[0.08] p-6 shadow-2xl md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-[17px] font-medium tracking-tight text-white/95">
              Desktop option
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-white/40">
              Use the native app for stealth, overlay, and interview-ready audio.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white/80"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mb-6 space-y-2 text-[13px] text-white/55">
          <li className="flex gap-2">
            <span className="text-[#20B8CD]">•</span>
            Hide from Zoom / Meet / Teams screen share
          </li>
          <li className="flex gap-2">
            <span className="text-[#20B8CD]">•</span>
            Always-on-top whisper overlay (Ctrl+Shift+S)
          </li>
          <li className="flex gap-2">
            <span className="text-[#20B8CD]">•</span>
            Same account as the web app after sign-in
          </li>
        </ul>

        <div className="flex flex-col gap-2.5">
          <Button
            onClick={() => {
              startDesktopDownload(os)
            }}
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Download for {OS_LABEL[os]}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              tryOpenDesktopApp()
            }}
          >
            <Monitor className="h-4 w-4" strokeWidth={1.75} />
            Open desktop app
          </Button>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-white/30">
          Installer:{' '}
          <span className="break-all text-white/40">{downloadUrl}</span>
          . If download fails, ask your admin to publish the build under{' '}
          <code className="text-white/45">/downloads/</code> or set{' '}
          <code className="text-white/45">VITE_DESKTOP_DOWNLOAD_URL</code>.
        </p>
      </div>
    </div>
  )
}
