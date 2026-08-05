import { cn } from '@/lib/utils'
import { isJobSearchLabHost } from '@/services/jobsearch'
import { useAppStore } from '@/stores/app-store'
import type { NavRoute } from '@/types'
import {
  Activity,
  BrainCircuit,
  Mic2,
  Radar,
  Settings2,
  Shield,
} from 'lucide-react'
import { useMemo } from 'react'

const baseItems: { id: NavRoute; label: string; icon: typeof Mic2 }[] = [
  { id: 'copilot', label: 'Interview', icon: Mic2 },
  { id: 'practice', label: 'Mock', icon: BrainCircuit },
  { id: 'analytics', label: 'Stats', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

/**
 * Phone bottom tab bar — large touch targets + safe-area padding.
 * Admin tab only for admin users (may crowd the bar on small phones).
 */
export function MobileNav() {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)
  const listening = useAppStore((s) => s.listening)
  const isAdmin = useAppStore((s) => Boolean(s.user?.is_admin))
  const jobLab = isJobSearchLabHost()

  const items = useMemo(() => {
    let list = [...baseItems]
    if (jobLab) {
      // Interview | Jobs | Mock | Stats | Settings
      list = [
        list[0]!,
        { id: 'jobsearch' as NavRoute, label: 'Jobs', icon: Radar },
        ...list.slice(1),
      ]
    }
    if (isAdmin) {
      list = [
        ...list.slice(0, -1),
        { id: 'admin' as NavRoute, label: 'Admin', icon: Shield },
        list[list.length - 1]!,
      ]
    }
    return list
  }, [isAdmin, jobLab])

  return (
    <nav
      className="mobile-nav fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.08] bg-[#0c0c0c]/96 backdrop-blur-xl"
      style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))' }}
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-between px-0.5 pt-0.5">
        {items.map((item) => {
          const Icon = item.icon
          const active = route === item.id
          const pulse = item.id === 'copilot' && listening
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setRoute(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1 transition-colors',
                active ? 'text-[#5DD5E3]' : 'text-white/40 active:text-white/70',
              )}
            >
              {active && (
                <span
                  className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-[#20B8CD]/80"
                  aria-hidden
                />
              )}
              <span className="relative">
                <Icon
                  className={cn('h-5 w-5', active && 'text-[#20B8CD]')}
                  strokeWidth={active ? 2 : 1.75}
                />
                {pulse && (
                  <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-[#20B8CD] listening-pulse" />
                )}
              </span>
              <span className="max-w-full truncate text-[10px] font-medium tracking-tight">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
