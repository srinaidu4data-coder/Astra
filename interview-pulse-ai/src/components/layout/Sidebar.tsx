import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import type { NavRoute } from '@/types'
import { isJobSearchLabHost } from '@/services/jobsearch'
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
  { id: 'analytics', label: 'Analytics', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

export function Sidebar({ compact = false }: { compact?: boolean }) {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)
  const listening = useAppStore((s) => s.listening)
  const isAdmin = useAppStore((s) => Boolean(s.user?.is_admin))
  const jobLab = isJobSearchLabHost()

  const items = useMemo(() => {
    const list = [...baseItems]
    // Localhost-only lab entry — never shown on production domains
    if (jobLab) {
      list.splice(1, 0, {
        id: 'jobsearch' as NavRoute,
        label: 'Jobs',
        icon: Radar,
      })
    }
    if (isAdmin) {
      list.push({ id: 'admin' as NavRoute, label: 'Admin', icon: Shield })
    }
    return list
  }, [isAdmin, jobLab])

  // compact = copilot full-width answer mode: icon rail only (~56px)
  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col items-center transition-[width] duration-200',
        compact
          ? 'w-[56px] py-4'
          : 'w-[88px] py-8 lg:w-[220px] lg:items-stretch lg:px-5',
      )}
    >
      {/* Mark — signature teal diamond */}
      <div
        className={cn(
          'mb-10 flex items-center gap-3 px-1',
          !compact && 'lg:px-2',
        )}
      >
        <div
          className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-[#20B8CD]/25 bg-gradient-to-br from-[#20B8CD]/20 to-transparent shadow-[0_0_24px_rgba(32,184,205,0.12)]"
          aria-hidden
        >
          <div className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[#5DD5E3]" />
        </div>
        <div className={cn('min-w-0', compact ? 'hidden' : 'hidden lg:block')}>
          <div className="truncate text-[13px] font-medium tracking-tight text-white/95">
            InterviewPulse
          </div>
          <div className="truncate text-[10px] font-normal tracking-tight text-white/35">
            Live interview kit
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5">
        {items.map((item) => {
          const Icon = item.icon
          const active = route === item.id
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setRoute(item.id)}
              title={item.label}
              className={cn(
                'group flex cursor-pointer items-center justify-center gap-3 rounded-xl px-0 py-3 transition-colors duration-150',
                !compact && 'lg:justify-start lg:px-3.5',
                active
                  ? 'bg-[#20B8CD]/14 text-white ring-1 ring-[#20B8CD]/30'
                  : 'text-white/40 hover:bg-white/[0.05] hover:text-white/80',
              )}
            >
              <Icon
                className={cn(
                  'h-[18px] w-[18px] shrink-0',
                  active ? 'text-[#5DD5E3]' : 'text-white/40 group-hover:text-white/70',
                )}
                strokeWidth={1.75}
              />
              <span
                className={cn(
                  'truncate text-[13px] font-medium tracking-tight',
                  compact ? 'hidden' : 'hidden lg:inline',
                )}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>

      <div
        className={cn(
          'mt-6 flex flex-col items-center gap-2',
          !compact &&
            'lg:items-start lg:rounded-[20px] lg:bg-white/[0.04] lg:px-3.5 lg:py-3.5 lg:ring-1 lg:ring-white/[0.06]',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              listening ? 'listening-pulse bg-[#20B8CD]' : 'bg-white/25',
            )}
          />
          <span
            className={cn(
              'text-[12px] text-white/45',
              compact ? 'hidden' : 'hidden lg:inline',
            )}
          >
            {listening ? 'Listening' : 'Idle'}
          </span>
        </div>
      </div>
    </aside>
  )
}
