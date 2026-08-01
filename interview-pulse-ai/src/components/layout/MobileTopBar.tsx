import { ApiStatusBadge } from '@/components/ApiStatusBadge'
import { useAppStore } from '@/stores/app-store'
import { Loader2 } from 'lucide-react'

const titles: Record<string, string> = {
  copilot: 'Copilot',
  knowledge: 'Knowledge',
  practice: 'Mock interview',
  analytics: 'Analytics',
  settings: 'Settings',
  admin: 'Admin',
}

/**
 * Compact top bar for phones — no Stealth/Overlay clutter (desktop-only features).
 */
export function MobileTopBar() {
  const route = useAppStore((s) => s.route)
  const listening = useAppStore((s) => s.listening)
  const user = useAppStore((s) => s.user)
  const activeJobTitle = useAppStore((s) => s.activeJobTitle)

  return (
    <header
      className="mobile-topbar shrink-0 border-b border-white/[0.06] px-4 pb-3"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-white/40">
            InterviewPulse
            {listening ? (
              <span className="ml-2 inline-flex items-center gap-1 text-[#20B8CD]">
                <Loader2 className="h-3 w-3 animate-spin" /> Live
              </span>
            ) : null}
          </p>
          <h1 className="truncate text-[18px] font-semibold tracking-tight text-white/95">
            {titles[route] ?? 'App'}
          </h1>
          {route === 'copilot' && activeJobTitle && (
            <p className="mt-0.5 truncate text-[12px] text-white/40">{activeJobTitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ApiStatusBadge variant="compact" />
          {user?.email && (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#20B8CD]/30 bg-[#141414] text-[12px] font-medium text-[#5DD5E3]"
              title={user.email}
            >
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
