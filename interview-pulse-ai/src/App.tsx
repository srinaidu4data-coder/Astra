import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { AuthPage } from '@/pages/AuthPage'
import { CopilotPage } from '@/pages/CopilotPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { OverlayPage } from '@/pages/OverlayPage'
import { PaywallPage } from '@/pages/PaywallPage'
import { PracticePage } from '@/pages/PracticePage'
import { SettingsPage } from '@/pages/SettingsPage'
import {
  confirmCheckoutSession,
  syncBilling,
} from '@/services/auth'
import { useAppStore } from '@/stores/app-store'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { HashRouter, Route, Routes, useSearchParams } from 'react-router-dom'

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
 *  and, if it carries a path/query beyond bare "open", routes the SPA there. */
function useDeepLinkRouting() {
  useEffect(() => {
    return window.interviewPulse?.onDeepLink((url) => {
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

export default function App() {
  useDeepLinkRouting()

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
