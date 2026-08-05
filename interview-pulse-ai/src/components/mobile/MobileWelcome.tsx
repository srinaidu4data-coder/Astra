import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'
import { FileText, Mic2, Smartphone, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const KEY = 'astra_mobile_welcome_v2'

/**
 * First-visit tips for phone users — kit-first path under real interview stress.
 */
export function MobileWelcome() {
  const setRoute = useAppStore((s) => s.setRoute)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-3 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div
        className="glass relative w-full max-w-md overflow-hidden rounded-[24px] p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-welcome-title"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5DD5E3]/40 to-transparent"
          aria-hidden
        />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#20B8CD]/35 bg-[#20B8CD]/10">
            <Smartphone className="h-5 w-5 text-[#20B8CD]" strokeWidth={1.75} />
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full p-2 text-white/40 hover:bg-white/5 hover:text-white/70"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2
          id="mobile-welcome-title"
          className="text-[17px] font-semibold tracking-tight text-white/95"
        >
          Live interview on your phone
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/50">
          Bottom tab is always there. On Interview, finish the kit — then the Start
          button stays fixed above the tabs so you never dig for it.
        </p>
        <ol className="mt-4 space-y-2.5 text-[13px] text-white/65">
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#20B8CD]/12 text-[11px] font-semibold text-[#5DD5E3]">
              1
            </span>
            <span>
              <strong className="text-white/85">Interview kit</strong> — Role, Context,
              Resume, JD (all four required).
            </span>
          </li>
          <li className="flex gap-3">
            <Mic2 className="mt-0.5 h-5 w-5 shrink-0 text-[#20B8CD]" strokeWidth={1.75} />
            <span>
              <strong className="text-white/85">Start</strong> — share meeting audio when
              prompted. We do not listen to your mic for answers.
            </span>
          </li>
          <li className="flex gap-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[#20B8CD]" strokeWidth={1.75} />
            <span>
              <strong className="text-white/85">Speak this</strong> — Hook · Proof · Close
              appear when a question ends. Type if audio lags.
            </span>
          </li>
          <li className="flex gap-3">
            <Upload className="mt-0.5 h-5 w-5 shrink-0 text-[#20B8CD]" strokeWidth={1.75} />
            <span>
              <strong className="text-white/85">Materials</strong> — full uploads live on the
              same screen under the kit.
            </span>
          </li>
        </ol>
        <p className="mt-3 text-[11px] leading-relaxed text-white/35">
          Screen-share stealth needs the desktop app. Live answers work here over HTTPS.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full min-h-[48px]"
            onClick={() => {
              dismiss()
              setRoute('copilot')
            }}
          >
            Open Interview kit
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="w-full min-h-[48px]"
            onClick={dismiss}
          >
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}
