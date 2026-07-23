import { Button } from '@/components/ui/button'
import { formatMs } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { MonitorSmartphone, Shield } from 'lucide-react'

export function TopBar() {
  const activeJobTitle = useAppStore((s) => s.activeJobTitle)
  const stealth = useAppStore((s) => s.stealth)
  const updateStealth = useAppStore((s) => s.updateStealth)
  const metrics = useAppStore((s) => s.metrics)
  const settings = useAppStore((s) => s.settings)
  const route = useAppStore((s) => s.route)

  const titles: Record<string, string> = {
    copilot: 'Copilot',
    knowledge: 'Knowledge',
    practice: 'Mock interview',
    analytics: 'Analytics',
    settings: 'Settings',
  }

  const hasDesktop = typeof window !== 'undefined' && !!window.interviewPulse

  const toggleStealth = async () => {
    const next = !stealth.contentProtection
    updateStealth({ contentProtection: next })
    if (window.interviewPulse) {
      await window.interviewPulse.setContentProtection(next)
    }
  }

  const openOverlay = async () => {
    if (!window.interviewPulse) {
      window.alert(
        'Overlay only works in the desktop app.\n\nRun: npm run dev:electron\n\nBrowser mode still supports Start interview + Answer.',
      )
      return
    }
    await window.interviewPulse.openOverlay()
    await window.interviewPulse.setOverlayOpacity(stealth.opacity)
    await window.interviewPulse.setContentProtection(stealth.contentProtection)
  }

  return (
    <header className="flex items-end justify-between gap-6 px-2 pb-2 pt-4 md:px-4 md:pt-6">
      <div className="min-w-0 space-y-1">
        <p className="text-[12px] font-light tracking-wide text-white/35">
          {titles[route] ?? 'InterviewPulse'}
          {settings.demoMode ? ' · Demo' : ' · Live'}
        </p>
        <h1 className="truncate text-[28px] font-medium tracking-tight text-white/95 md:text-[32px]">
          {activeJobTitle}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        {metrics && (
          <div className="glass-soft hidden items-center gap-4 rounded-full px-4 py-2 text-[12px] text-white/45 md:flex">
            <span>STT {formatMs(metrics.sttMs)}</span>
            <span className="text-white/20">·</span>
            <span
              className={
                metrics.totalMs < 850 ? 'text-[#20B8CD]' : 'text-[#E8C547]'
              }
            >
              {formatMs(metrics.totalMs)}
            </span>
          </div>
        )}

        <Button
          variant={stealth.contentProtection ? 'success' : 'secondary'}
          size="sm"
          onClick={() => void toggleStealth()}
          title={
            hasDesktop
              ? 'Hide window from screen share'
              : 'Toggles setting (full hide needs Electron)'
          }
        >
          <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
          Stealth {stealth.contentProtection ? 'ON' : 'OFF'}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => void openOverlay()}
          title={hasDesktop ? 'Open whisper overlay' : 'Requires Electron desktop app'}
        >
          <MonitorSmartphone className="h-3.5 w-3.5" strokeWidth={1.75} />
          Overlay
        </Button>
      </div>
    </header>
  )
}
