import { ApiStatusBadge } from '@/components/ApiStatusBadge'
import { DesktopOption } from '@/components/DesktopOption'
import { Button } from '@/components/ui/button'
import { openAnswerPopout } from '@/lib/answer-popout'
import {
  getInterviewReadiness,
  readinessSummary,
} from '@/lib/interview-ready'
import { formatMs } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { MonitorSmartphone, Shield } from 'lucide-react'
import { useMemo } from 'react'

export function TopBar() {
  const activeJobTitle = useAppStore((s) => s.activeJobTitle)
  const stealth = useAppStore((s) => s.stealth)
  const updateStealth = useAppStore((s) => s.updateStealth)
  const metrics = useAppStore((s) => s.metrics)
  const settings = useAppStore((s) => s.settings)
  const documents = useAppStore((s) => s.documents)
  const route = useAppStore((s) => s.route)

  const titles: Record<string, string> = {
    copilot: 'Interview',
    knowledge: 'Interview',
    practice: 'Mock interview',
    analytics: 'Analytics',
    settings: 'Settings',
    admin: 'Admin · models',
    jobsearch: 'Jobs',
    autoapply: 'Jobs',
    nightscout: 'Jobs',
  }

  const kit = useMemo(
    () =>
      getInterviewReadiness({
        role: activeJobTitle,
        jobContext: settings.jobContext || '',
        documents,
      }),
    [activeJobTitle, settings.jobContext, documents],
  )
  const showKit =
    route === 'copilot' || route === 'knowledge'

  const hasDesktop = typeof window !== 'undefined' && !!window.interviewPulse

  const toggleStealth = async () => {
    if (!window.interviewPulse) {
      window.alert(
        'Stealth hide-from-screen-share only works in the desktop app.\n\n' +
          'In Chrome/Edge (jobinterviewcracker.com), the browser cannot hide a tab from Zoom/Meet.\n\n' +
          'To use real Stealth:\n' +
          '  1. On your PC: cd interview-pulse-ai\n' +
          '  2. npm run dev:electron\n' +
          '  or use the Python desktop copilot (src\\run.bat) which has Stealth ON by default.\n\n' +
          'The button will still toggle the setting for when you open Electron.',
      )
    }
    const next = !stealth.contentProtection
    updateStealth({ contentProtection: next })
    if (window.interviewPulse) {
      try {
        const res = await window.interviewPulse.setContentProtection(next)
        if (res && res.ok === false) {
          window.alert('Stealth API failed — try updating Windows or restarting the desktop app.')
        }
      } catch {
        window.alert('Could not apply stealth to the window.')
      }
    }
  }

  const openOverlay = async () => {
    // Electron native overlay or browser popup to #/overlay (live-synced)
    const res = await openAnswerPopout()
    if (!res.ok) {
      window.alert(
        res.message ||
          'Could not open the answer overlay. Allow popups, or use the desktop app.',
      )
    }
  }

  return (
    <header className="flex items-end justify-between gap-6 px-2 pb-2 pt-4 md:px-4 md:pt-6">
      <div className="min-w-0 space-y-1">
        <p className="text-[12px] font-light tracking-wide text-white/35">
          {titles[route] ?? 'InterviewPulse'}
          {settings.demoMode ? ' · Demo' : ' · Live'}
          {showKit && (
            <span
              className={
                kit.ready
                  ? ' text-[#81c995]/90'
                  : ' text-white/40'
              }
              title={readinessSummary(kit)}
            >
              {' '}
              · Kit {kit.completeCount}/{kit.total}
            </span>
          )}
        </p>
        <h1 className="truncate text-[28px] font-medium tracking-tight text-white/95 md:text-[32px]">
          {activeJobTitle?.trim() || 'Live interview'}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        {/* Always-visible backend online/offline */}
        <ApiStatusBadge variant="compact" />

        {metrics && (
          <div className="glass-soft hidden items-center gap-4 rounded-full px-4 py-2 text-[12px] text-white/45 md:flex">
            <span>STT {formatMs(metrics.sttMs)}</span>
            <span className="text-white/20">·</span>
            <span
              className={
                metrics.totalMs < 3000
                  ? 'text-[#20B8CD]'
                  : metrics.totalMs < 6000
                    ? 'text-[#E8C547]'
                    : 'text-[#E85D5D]'
              }
              title="End-to-end answer latency (STT + model)"
            >
              {formatMs(metrics.totalMs)}
            </span>
          </div>
        )}

        {/* Web only: download / open desktop app */}
        {!hasDesktop && <DesktopOption variant="compact" />}

        <Button
          variant={
            hasDesktop && stealth.contentProtection
              ? 'success'
              : hasDesktop
                ? 'secondary'
                : 'secondary'
          }
          size="sm"
          onClick={() => void toggleStealth()}
          title={
            hasDesktop
              ? stealth.contentProtection
                ? 'Hidden from most screen shares (Electron content protection)'
                : 'Click to hide this window from screen share'
              : 'Browser: UI only — real hide needs Electron desktop app'
          }
        >
          <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
          {hasDesktop
            ? `Stealth ${stealth.contentProtection ? 'ON' : 'OFF'}`
            : stealth.contentProtection
              ? 'Stealth (web only)'
              : 'Stealth OFF'}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => void openOverlay()}
          title={
            hasDesktop
              ? 'Open whisper overlay (always-on-top)'
              : 'Detach answer into a resizable popup window'
          }
        >
          <MonitorSmartphone className="h-3.5 w-3.5" strokeWidth={1.75} />
          {hasDesktop ? 'Overlay' : 'Detach'}
        </Button>
      </div>
    </header>
  )
}
