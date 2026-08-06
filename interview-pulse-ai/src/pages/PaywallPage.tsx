import { Button } from '@/components/ui/button'
import {
  logout,
  openBillingPortal,
  startCheckout,
  syncBilling,
  type AuthUser,
} from '@/services/auth'
import { useAppStore } from '@/stores/app-store'
import {
  Check,
  CreditCard,
  Loader2,
  LogOut,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const PLANS = [
  {
    code: 'interview_pass',
    title: 'Interview Pass',
    price: '$19',
    body: 'One opportunity · 72 hours · 120 live minutes · full Company Twin',
  },
  {
    code: 'interview_sprint',
    title: 'Interview Sprint',
    price: '$39',
    body: 'One opportunity · 14 days · unlimited mocks · 180 live minutes',
  },
  {
    code: 'pro_monthly',
    title: 'Pro Monthly',
    price: '$59/mo',
    body: 'Multiple opportunities · fair-use live minutes · packs',
  },
]

/** Shown after Google sign-in until Stripe monthly subscription is active. */
export function PaywallPage({ user }: { user: AuthUser }) {
  const setAuthFromUser = useAppStore((s) => s.setAuthFromUser)
  const clearAuth = useAppStore((s) => s.clearAuth)
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const applySync = async (sourceLabel?: string) => {
    setBusy(true)
    setError(null)
    try {
      const data = await syncBilling()
      setAuthFromUser(data.user)
      if (data.subscription_active) {
        setHint(`Subscription active (${sourceLabel || data.source}). Unlocking…`)
      } else {
        setHint(
          `Stripe says: ${data.user.subscription_status}` +
            (data.user.access_revoked_reason
              ? ` · revoked: ${data.user.access_revoked_reason}`
              : '') +
            `. Source: ${data.source}`,
        )
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const checkout = params.get('checkout')
    if (checkout === 'success') {
      setHint('Payment received — confirming with Stripe…')
      void applySync('checkout_return')
      let n = 0
      const id = window.setInterval(() => {
        n += 1
        void applySync(`poll_${n}`)
        if (n >= 5) window.clearInterval(id)
      }, 2500)
      return () => window.clearInterval(id)
    }
    if (checkout === 'cancel') {
      setHint('Checkout canceled — no charge was made.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const checkout = async (productCode: string = 'interview_pass') => {
    setBusy(true)
    setError(null)
    try {
      const url = await startCheckout(productCode)
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const portal = async () => {
    setBusy(true)
    setError(null)
    try {
      const url = await openBillingPortal()
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const signOut = () => {
    logout()
    clearAuth()
  }

  const revoked = user.access_revoked_reason
  const title =
    revoked === 'refund'
      ? 'Access revoked after refund'
      : revoked === 'payment_failed'
        ? 'Payment failed — update billing'
        : 'Unlock live interviews'

  return (
    <div
      className="app-mesh flex min-h-full items-center justify-center p-4 sm:p-6"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#20B8CD]/25 bg-[#20B8CD]/10"
            aria-hidden
          >
            <Sparkles className="h-5 w-5 text-[#5DD5E3]" strokeWidth={1.75} />
          </div>
          <h1 className="text-[22px] font-medium tracking-[-0.02em] text-white/95">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/45">
            Signed in as <span className="text-white/80">{user.email}</span>
            {revoked === 'refund'
              ? '. Purchase again to restore access.'
              : '. Pick prep for one job (Pass/Sprint) or Pro monthly.'}
          </p>
        </div>

        <div className="glass relative overflow-hidden rounded-[28px] p-6 sm:p-8 md:p-9">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5DD5E3]/45 to-transparent"
            aria-hidden
          />

          <ul className="mb-6 space-y-2.5" aria-label="Plans">
            {PLANS.map((b) => (
              <li
                key={b.code}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/20 px-3.5 py-3"
              >
                <div className="flex min-w-0 gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#20B8CD]/15 text-[#5DD5E3]">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-white/90">
                      {b.title}{' '}
                      <span className="text-[#5DD5E3]">{b.price}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">
                      {b.body}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void checkout(b.code)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buy'}
                </Button>
              </li>
            ))}
          </ul>

          <div className="mb-5 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-white/35">
              Billing status
            </div>
            <div className="mt-1 text-[15px] text-white/90">
              {user.subscription_status === 'none'
                ? 'No subscription yet'
                : user.subscription_status}
              {revoked ? (
                <span className="ml-2 text-[13px] text-[#f28b82]">({revoked})</span>
              ) : null}
            </div>
          </div>

          {hint && (
            <div
              className="mb-4 rounded-[14px] border border-[#20B8CD]/30 bg-[#20B8CD]/10 px-4 py-3 text-[13px] text-[#5DD5E3]"
              role="status"
            >
              {hint}
            </div>
          )}

          {error && (
            <div
              className="mb-4 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              className="ip-cta-ready min-h-[48px] flex-1 text-[15px]"
              disabled={busy}
              onClick={() => void checkout()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" strokeWidth={1.75} />
              )}
              {revoked ? 'Buy Interview Pass' : 'Buy Interview Pass · $19'}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="min-h-[48px]"
              disabled={busy}
              onClick={() => void applySync('manual')}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
              Sync status
            </Button>
          </div>

          <Button
            variant="ghost"
            className="mt-3 w-full min-h-[44px]"
            disabled={busy}
            onClick={() => void portal()}
          >
            Manage billing / request refund
          </Button>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-white/30">
            Honest monthly billing via Stripe. Cancel anytime in the portal.
          </p>

          <button
            type="button"
            onClick={signOut}
            className="mt-6 flex w-full min-h-[44px] items-center justify-center gap-2 text-[13px] text-white/40 hover:text-white/70"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
