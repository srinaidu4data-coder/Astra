import { MobileNav } from '@/components/layout/MobileNav'
import { MobileTopBar } from '@/components/layout/MobileTopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { MobileWelcome } from '@/components/mobile/MobileWelcome'
import { AdminPage } from '@/pages/AdminPage'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { AuthPage } from '@/pages/AuthPage'
import { CopilotPage } from '@/pages/CopilotPage'
import { JobSearchPage } from '@/pages/JobSearchPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { OverlayPage } from '@/pages/OverlayPage'
import { PaywallPage } from '@/pages/PaywallPage'
import { PracticePage } from '@/pages/PracticePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { useIsMobile } from '@/lib/mobile'
import {
  confirmCheckoutSession,
  syncBilling,
} from '@/services/auth'
import { publishLiveSync } from '@/lib/window-sync'
import { useAppStore } from '@/stores/app-store'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { HashRouter, Route, Routes, useSearchParams } from 'react-router-dom'

function PageBody() {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)

  // Deep-link: http://localhost:5173/#/jobsearch
  useEffect(() => {
    const applyHash = () => {
      const raw = (window.location.hash || '').replace(/^#\/?/, '')
      const path = raw.split('?')[0]?.toLowerCase() || ''
      if (path === 'jobsearch' || path === 'job-search' || path === 'jobs') {
        setRoute('jobsearch')
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [setRoute])

  return (
    <>
      {route === 'copilot' && <CopilotPage />}
      {route === 'knowledge' && <KnowledgePage />}
      {route === 'practice' && <PracticePage />}
      {route === 'analytics' && <AnalyticsPage />}
      {route === 'settings' && <SettingsPage />}
      {route === 'admin' && <AdminPage />}
      {route === 'jobsearch' && <JobSearchPage />}
    </>
  )
}

/** Phone-optimized shell: bottom tabs, compact header, safe areas. */
function MobileDashboardShell() {
  return (
    <div className="app-mesh mobile-shell flex h-full flex-col">
      <MobileWelcome />
      <MobileTopBar />
      <main
        className="min-h-0 flex-1 overflow-auto px-3 pt-3"
        style={{
          // Room for bottom tab bar + home indicator
          paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="page-shell page-shell-mobile mx-auto max-w-lg pb-4">
          <PageBody />
        </div>
      </main>
      <MobileNav />
    </div>
  )
}

/** Desktop / tablet shell: sidebar + glass card. */
function DesktopDashboardShell() {
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
              <PageBody />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

function DashboardShell() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileDashboardShell /> : <DesktopDashboardShell />
}

/** Gate: Google sign-in → Stripe monthly → app. Handles checkout + refund re-sync. */
function GatedApp() {
  const authReady = useAppStore((s) => s.authReady)
  const authConfig = useAppStore((s) => s.authConfig)
  const user = useAppStore((s) => s.user)
  const bootstrapAuth = useAppStore((s) => s.bootstrapAuth)
  const setAuthFromUser = useAppStore((s) => s.setAuthFromUser)
  const refreshAuth = useAppStore((s) => s.refreshAuth)
  const [params] = useSearchParams()
  const handledSession = useRef<string | null>(null)

  useEffect(() => {
    void bootstrapAuth()
  }, [bootstrapAuth])

  // Stripe success URL: #/billing?checkout=success&session_id=cs_...
  useEffect(() => {
    const checkout = params.get('checkout')
    const sessionId = params.get('session_id')
    if (checkout !== 'success' || !user) return

    const run = async () => {
      try {
        if (sessionId && handledSession.current !== sessionId) {
          handledSession.current = sessionId
          const data = await confirmCheckoutSession(sessionId)
          setAuthFromUser(data.user)
          return
        }
        const data = await syncBilling()
        setAuthFromUser(data.user)
      } catch {
        // Fall back to /me
        await refreshAuth()
      }
    }
    void run()
  }, [params, user, setAuthFromUser, refreshAuth])

  // While subscribed, re-sync occasionally so refunds/cancels lock the UI
  useEffect(() => {
    if (!user?.subscription_active) return
    const id = window.setInterval(() => {
      void syncBilling()
        .then((data) => setAuthFromUser(data.user))
        .catch(() => {
          /* offline */
        })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [user?.subscription_active, setAuthFromUser])

  if (!authReady) {
    return (
      <div className="app-mesh flex h-full items-center justify-center text-white/50">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading…
      </div>
    )
  }

  // Controlled by backend src/.env:
  //   AUTH_REQUIRED=true + Google keys → force sign-in (production: jobinterviewcracker.com)
  //   AUTH_REQUIRED=false or AUTH_DEV_BYPASS=true → open app (local testing)
  const mustAuth = Boolean(authConfig?.auth_required) && !authConfig?.dev_bypass
  const signedIn = Boolean(user)
  const subscribed =
    Boolean(user?.subscription_active) || Boolean(authConfig?.dev_bypass)

  if (mustAuth && !signedIn) {
    return <AuthPage mode="login" />
  }

  // Paywall only when Stripe is configured; Google login alone is enough until then
  if (mustAuth && signedIn && authConfig?.stripe_configured && !subscribed) {
    return <PaywallPage user={user!} />
  }

  return <DashboardShell />
}

/** Desktop only: interviewpulse://open[/path][?query] focuses the window (main.cjs)
 *  and, if it carries a path/query beyond bare "open", routes the SPA there.
 *  Guard the method itself — older Electron preloads may not expose onDeepLink
 *  (optional chaining only checks interviewPulse, not whether the method exists). */
function useDeepLinkRouting() {
  useEffect(() => {
    const api = window.interviewPulse
    if (!api || typeof api.onDeepLink !== 'function') {
      return
    }
    return api.onDeepLink((url) => {
      try {
        const parsed = new URL(url)
        const rest = `${parsed.host}${parsed.pathname}`.replace(/^open\/?/, '')
        if (rest || parsed.search) {
          window.location.hash = `#/${rest}${parsed.search}`
        }
      } catch {
        // Malformed deep link — window is already focused, nothing else to do
      }
    })
  }, [])
}

/**
 * Main window only: when the overlay opens it asks us to re-publish the current
 * answer so the stealth window is not stuck on the empty state.
 */
function useLiveOverlayBridge() {
  useEffect(() => {
    // Overlay route has its own subscriber; don't dual-publish from there
    if (window.location.hash.includes('/overlay')) return

    const push = () => {
      const s = useAppStore.getState()
      publishLiveSync({
        answer: s.answer,
        listening: s.listening,
        levels: s.levels,
        answerMode: s.answerMode,
      })
    }

    // Seed localStorage / IPC once so a late-opened overlay can read snapshot
    push()

    const unsub = window.interviewPulse?.onRequestLivePublish?.(push)
    return () => {
      unsub?.()
    }
  }, [])
}

export default function App() {
  useDeepLinkRouting()
  useLiveOverlayBridge()

  return (
    <HashRouter>
      <Routes>
        <Route path="/overlay" element={<OverlayPage />} />
        <Route path="/auth/callback" element={<AuthPage mode="callback" />} />
        <Route path="/auth/forgot" element={<AuthPage mode="forgot" />} />
        <Route path="/auth/reset" element={<AuthPage mode="reset" />} />
        <Route path="/auth" element={<AuthPage mode="login" />} />
        <Route path="/billing" element={<GatedApp />} />
        <Route path="/*" element={<GatedApp />} />
      </Routes>
    </HashRouter>
  )
}
