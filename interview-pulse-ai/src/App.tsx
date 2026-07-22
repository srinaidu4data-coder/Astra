import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { CopilotPage } from '@/pages/CopilotPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { OverlayPage } from '@/pages/OverlayPage'
import { PracticePage } from '@/pages/PracticePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { useAppStore } from '@/stores/app-store'
import { useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

function DashboardShell() {
  const route = useAppStore((s) => s.route)
  const stealth = useAppStore((s) => s.stealth)

  useEffect(() => {
    void window.interviewPulse?.setContentProtection(stealth.contentProtection)
  }, [stealth.contentProtection])

  return (
    <div className="app-mesh flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pr-3 pt-2 pb-3 md:pr-6 md:pb-5">
        <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-[32px]">
          <div className="shrink-0 border-b border-white/[0.06] px-5 md:px-8">
            <TopBar />
          </div>
          <main className="min-h-0 flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
            <div className="page-shell">
              {route === 'copilot' && <CopilotPage />}
              {route === 'knowledge' && <KnowledgePage />}
              {route === 'practice' && <PracticePage />}
              {route === 'analytics' && <AnalyticsPage />}
              {route === 'settings' && <SettingsPage />}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/overlay" element={<OverlayPage />} />
        <Route path="/*" element={<DashboardShell />} />
      </Routes>
    </HashRouter>
  )
}
