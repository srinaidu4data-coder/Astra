import { Button } from '@/components/ui/button'
import {
  logout,
  openBillingPortal,
  startCheckout,
  syncBilling,
  type AuthUser,
} from '@/services/auth'
import { useAppStore } from '@/stores/app-store'
import { CreditCard, Loader2, LogOut, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

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

  // After Checkout redirect: ?checkout=success — sync from Stripe (webhook may lag)
  useEffect(() => {
    const checkout = params.get('checkout')
    if (checkout === 'success') {
      setHint('Payment received — confirming with Stripe…')
      void applySync('checkout_return')
      // Poll a few times if webhook is slower than confirm
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

  const checkout = async () => {
    setBusy(true)
    setError(null)
    try {
      const url = await startCheckout()
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
        ? 'Payment failed'
        : 'Activate monthly access'

  return (
    <div className="app-mesh flex min-h-full items-center justify-center p-6">
      <div className="glass w-full max-w-lg rounded-[28px] p-8 md:p-10">
        <h1 className="text-[20px] font-medium tracking-tight text-white/95">{title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-white/50">
          Signed in as <span className="text-white/80">{user.email}</span>.
          {revoked === 'refund'
            ? ' Your payment was refunded. Subscribe again to restore access.'
            : ' Choose a monthly plan to unlock live interview answers.'}
        </p>

        <div className="mt-6 rounded-[18px] glass-inset px-5 py-5">
          <div className="text-[12px] uppercase tracking-tight text-white/35">Status</div>
          <div className="mt-1 text-[16px] text-white/90">
            {user.subscription_status === 'none'
              ? 'No subscription'
              : user.subscription_status}
            {revoked ? (
              <span className="ml-2 text-[13px] text-[#E85D5D]">({revoked})</span>
            ) : null}
          </div>
        </div>

        {hint && (
          <div className="mt-4 rounded-[14px] border border-[#20B8CD]/30 bg-[#20B8CD]/10 px-4 py-3 text-[13px] text-[#5DD5E3]">
            {hint}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="flex-1" disabled={busy} onClick={() => void checkout()}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" strokeWidth={1.75} />
            )}
            {revoked ? 'Subscribe again' : 'Subscribe monthly'}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            disabled={busy}
            onClick={() => void applySync('manual')}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
            Sync from Stripe
          </Button>
        </div>

        <Button
          variant="ghost"
          className="mt-3 w-full"
          disabled={busy}
          onClick={() => void portal()}
        >
          Manage billing / request refund
        </Button>

        <button
          type="button"
          onClick={signOut}
          className="mt-8 flex w-full items-center justify-center gap-2 text-[13px] text-white/40 hover:text-white/70"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </div>
  )
}
