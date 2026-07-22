import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import type { NavRoute } from '@/types'
import {
  Activity,
  BookOpen,
  BrainCircuit,
  Mic2,
  Settings2,
} from 'lucide-react'

const items: { id: NavRoute; label: string; icon: typeof Mic2 }[] = [
  { id: 'copilot', label: 'Copilot', icon: Mic2 },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'practice', label: 'Practice', icon: BrainCircuit },
  { id: 'analytics', label: 'Analytics', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

export function Sidebar() {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)
  const listening = useAppStore((s) => s.listening)

  return (
    <aside className="flex h-full w-[88px] shrink-0 flex-col items-center py-8 lg:w-[220px] lg:items-stretch lg:px-5">
      {/* Mark */}
      <div className="mb-10 flex items-center gap-3 px-1 lg:px-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[#20B8CD]/30 bg-[#141414]">
          <div className="h-3 w-3 rounded-none bg-[#20B8CD]" />
        </div>
        <div className="hidden min-w-0 lg:block">
          <div className="truncate text-[13px] font-medium tracking-tight text-white/90">
            InterviewPulse
          </div>
          <div className="truncate text-[10px] font-normal tracking-tight text-white/35">
            AI Copilot
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
                'group flex cursor-pointer items-center justify-center gap-3 rounded-sm px-0 py-3 transition-colors duration-150 lg:justify-start lg:px-3.5',
                active
                  ? 'bg-[#20B8CD]/15 text-white ring-1 ring-[#20B8CD]/35'
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
              <span className="hidden truncate text-[13px] font-medium tracking-tight lg:inline">
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="mt-6 flex flex-col items-center gap-2 lg:items-start lg:rounded-[20px] lg:bg-white/[0.04] lg:px-3.5 lg:py-3.5 lg:ring-1 lg:ring-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              listening ? 'listening-pulse bg-[#20B8CD]' : 'bg-white/25',
            )}
          />
          <span className="hidden text-[12px] text-white/45 lg:inline">
            {listening ? 'Listening' : 'Idle'}
          </span>
        </div>
      </div>
    </aside>
  )
}
