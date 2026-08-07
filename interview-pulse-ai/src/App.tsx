import { MobileNav } from '@/components/layout/MobileNav'
import { MobileTopBar } from '@/components/layout/MobileTopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { MobileWelcome } from '@/components/mobile/MobileWelcome'
import { AdminPage } from '@/pages/AdminPage'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { AuthPage } from '@/pages/AuthPage'
import { CopilotPage } from '@/pages/CopilotPage'
import { OverlayPage } from '@/pages/OverlayPage'
import { PaywallPage } from '@/pages/PaywallPage'
import { BtpOdysseyPage } from '@/pages/BtpOdysseyPage'
import { PracticePage } from '@/pages/PracticePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SprintPage } from '@/pages/SprintPage'
import { useIsMobile } from '@/lib/mobile'
import {
  confirmCheckoutSession,
  syncBilling,
} from '@/services/auth'
import { publishLiveSync } from '@/lib/window-sync'
import { useAppStore } from '@/stores/app-store'
import { Loader2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { HashRouter, Route, Routes, useSearchParams } from 'react-router-dom'

/** Jobs hub is large (search + playbooks + auto-apply) — load on demand. */
const JobSearchPage = lazy(() =>
  import('@/pages/JobSearchPage').then((m) => ({ default: m.JobSearchPage })),
)

function JobsRouteFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-white/45">
      <Loader2 className="h-5 w-5 animate-spin" />
      Loading Jobs…
    </div>
  )
}

function PageBody() {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)

  // Deep-link: unified Jobs hub (#/jobsearch, #/auto-apply, #/night-scout, #/jobsearch/auto)
  useEffect(() => {
    const applyHash = () => {
      const raw = (window.location.hash || '').replace(/^#\/?/, '')
      const path = raw.split('?')[0]?.toLowerCase() || ''
      if (
        path === 'btp-odyssey' ||
        path === 'btp' ||
        path === 'odyssey' ||
        path === 'btp-odyssey/' ||
        path.startsWith('btp-odyssey')
      ) {
        setRoute('btp-odyssey')
        return
      }
      if (
        path === 'jobsearch' ||
        path === 'job-search' ||
        path === 'jobs' ||
        path.startsWith('jobsearch/') ||
        path === 'autoapply' ||
        path === 'auto-apply' ||
        path === 'aiapply' ||
        path === 'auto' ||
        path === 'nexus' ||
        path === 'careerops' ||
        path === 'career-ops' ||
        path === 'applypilot' ||
        path === 'aihawk' ||
        path === 'hitl' ||
        path === 'autofill' ||
        path === 'nightscout' ||
        path === 'night-scout' ||
        path === 'night' ||
        path === 'morning'
      ) {
        setRoute('jobsearch')
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [setRoute])

  return (
    <>
      {route === 'sprint' && <SprintPage />}
      {(route === 'copilot' || route === 'knowledge') && <CopilotPage />}
      {route === 'practice' && <PracticePage />}
      {route === 'btp-odyssey' && <BtpOdysseyPage />}
      {route === 'analytics' && <AnalyticsPage />}
      {route === 'settings' && <SettingsPage />}
      {route === 'admin' && <AdminPage />}
      {(route === 'jobsearch' ||
        route === 'autoapply' ||
        route === 'nightscout') && (
        <Suspense fallback={<JobsRouteFallback />}>
          <JobSearchPage />
        </Suspense>
      )}
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
        className="min-h-0 flex-1 overflow-auto px-2.5 pt-2"
        style={{
          // Room for bottom tab bar + home indicator
          paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="page-shell page-shell-mobile mx-auto max-w-lg pb-2">
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
  const route = useAppStore((s) => s.route)
  const copilotWideAnswer = useAppStore((s) => s.copilotWideAnswer)
  // Full-bleed answer mode: only when Copilot has Hide controls on
  const wide = route === 'copilot' && copilotWideAnswer

  useEffect(() => {
    void window.interviewPulse?.setContentProtection(stealth.contentProtection)
  }, [stealth.contentProtection])

  return (
    <div className="app-mesh flex h-full">
      <Sidebar compact={wide} />
      <div
        className={
          wide
            ? 'flex min-w-0 flex-1 flex-col pr-1 pt-1 pb-1 md:pr-2 md:pb-2'
            : 'flex min-w-0 flex-1 flex-col pr-3 pt-2 pb-3 md:pr-6 md:pb-5'
        }
      >
        <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-[32px]">
          {!wide && (
            <div className="shrink-0 border-b border-white/[0.06] px-5 md:px-8">
              <TopBar />
            </div>
          )}
          <main
            className={
              wide
                ? 'min-h-0 flex-1 overflow-auto px-2 py-3 md:px-4 md:py-4'
                : 'min-h-0 flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10'
            }
          >
            <div
              className={
                wide
                  ? 'w-full max-w-none'
                  : 'page-shell'
              }
            >
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
  const route = useAppStore((s) => s.route)
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
      <div className="app-mesh flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#20B8CD]/25 bg-gradient-to-br from-[#20B8CD]/18 to-transparent"
          aria-hidden
        >
          <div className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[#5DD5E3]" />
        </div>
        <div>
          <p className="text-[15px] font-medium tracking-tight text-white/90">
            InterviewPulse
          </p>
          <p className="mt-1 flex items-center justify-center gap-2 text-[13px] text-white/40">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#5DD5E3]" />
            Preparing your session…
          </p>
        </div>
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

  // Soft paywall: free diagnostic (Sprint) + Settings + Mock without full plan.
  // Live Interview still requires subscription_active or Pass/Sprint entitlement.
  const freeRoutes =
    route === 'sprint' ||
    route === 'settings' ||
    route === 'practice' ||
    route === 'btp-odyssey'
  if (
    mustAuth &&
    signedIn &&
    authConfig?.stripe_configured &&
    !subscribed &&
    !freeRoutes
  ) {
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
