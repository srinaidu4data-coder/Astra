import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'
import { BookOpen, BrainCircuit, Mic2, Smartphone, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const KEY = 'astra_mobile_welcome_v1'

/**
 * First-visit tips for phone users — how to use interview tools on mobile.
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
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div
        className="glass w-full max-w-md rounded-[24px] p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="mobile-welcome-title"
      >
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
        <h2 id="mobile-welcome-title" className="text-[18px] font-semibold text-white/95">
          Phone mode is ready
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/50">
          InterviewPulse works in your mobile browser. Use the bottom tabs to move around.
          For live answers, allow the microphone when prompted.
        </p>
        <ul className="mt-5 space-y-3 text-[13px] text-white/65">
          <li className="flex gap-3">
            <Mic2 className="mt-0.5 h-4 w-4 shrink-0 text-[#20B8CD]" />
            <span>
              <strong className="text-white/85">Copilot</strong> — start interview, speak or type
              questions, read answers on the go.
            </span>
          </li>
          <li className="flex gap-3">
            <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-[#20B8CD]" />
            <span>
              <strong className="text-white/85">Mock</strong> — full practice interviews with spoken
              questions (use headphones).
            </span>
          </li>
          <li className="flex gap-3">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[#20B8CD]" />
            <span>
              <strong className="text-white/85">Knowledge</strong> — upload resume / subject PDFs from
              your phone files.
            </span>
          </li>
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-white/35">
          Stealth hide-from-screen-share needs the desktop app. Everything else works on phone over
          HTTPS.
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
            Start with Copilot
          </Button>
          <Button size="lg" variant="secondary" className="w-full min-h-[48px]" onClick={dismiss}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}
