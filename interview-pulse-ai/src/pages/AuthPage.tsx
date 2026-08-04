import { DesktopOption } from '@/components/DesktopOption'
import { Button } from '@/components/ui/button'
import {
  completeTokenLogin,
  devBypassLogin,
  fetchAuthConfig,
  googleLoginUrl,
  loginWithEmail,
  parseAuthHashParams,
  registerWithEmail,
  requestPasswordReset,
  resetPasswordWithToken,
  stripAuthTokenFromUrl,
  type AuthConfig,
} from '@/services/auth'
import { useAppStore } from '@/stores/app-store'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

type View = 'login' | 'register' | 'forgot' | 'reset' | 'callback'

/**
 * Sign-in: Google and/or email+password.
 * Forgot password sends a one-time link via Gmail SMTP.
 */
export function AuthPage({
  mode = 'login',
}: {
  mode?: 'login' | 'callback' | 'forgot' | 'reset'
}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setAuth = useAppStore((s) => s.setAuth)
  const bootstrapAuth = useAppStore((s) => s.bootstrapAuth)
  const loginOnce = useRef(false)

  const initialView: View =
    mode === 'callback'
      ? 'callback'
      : mode === 'forgot'
        ? 'forgot'
        : mode === 'reset'
          ? 'reset'
          : 'login'

  const [view, setView] = useState<View>(initialView)
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(mode === 'callback')
  const [status, setStatus] = useState(
    mode === 'callback' ? 'Completing Google sign-in…' : '',
  )

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState(params.get('token') || '')

  useEffect(() => {
    void fetchAuthConfig().then(setConfig)
  }, [])

  useEffect(() => {
    if (mode === 'reset') {
      setView('reset')
      const t = params.get('token') || parseAuthHashParams().token
      if (t) setResetToken(t)
    }
    if (mode === 'forgot') setView('forgot')
  }, [mode, params])

  // Backend fail() redirects to #/auth?error=… (login route) — surface it
  useEffect(() => {
    if (mode === 'callback' || mode === 'reset') return
    const err = params.get('error') || parseAuthHashParams().error
    if (err) {
      setError(err.replace(/_/g, ' '))
      setBusy(false)
      setView('login')
    }
  }, [mode, params])

  // Google OAuth success → #/auth/callback?token=…
  // Also accept token on #/auth?token=… if backend path drifts
  useEffect(() => {
    if (loginOnce.current) return
    if (mode !== 'callback' && mode !== 'login') return

    const fromHash = parseAuthHashParams()
    const token = params.get('token') || fromHash.token
    const err = params.get('error') || fromHash.error

    // Normal login page (no OAuth return) — do nothing
    if (mode === 'login' && !token && !err) return

    if (err) {
      loginOnce.current = true
      setError(err.replace(/_/g, ' '))
      setBusy(false)
      setView('login')
      setStatus('')
      stripAuthTokenFromUrl()
      return
    }

    if (!token) {
      if (mode === 'callback') {
        loginOnce.current = true
        setError('Missing session token from Google. Try Continue with Google again.')
        setBusy(false)
        setView('login')
        setStatus('')
      }
      return
    }

    loginOnce.current = true
    setBusy(true)
    setView('callback')
    setStatus('Saving session…')
    setError(null)

    void (async () => {
      try {
        setStatus('Verifying with API…')
        const user = await completeTokenLogin(token)
        setAuth({ user, token })
        stripAuthTokenFromUrl()
        setStatus('Signed in — opening app…')
        // Clear any prior user's role/JD cache (prevents ATTP bleed across logins)
        try {
          const { fullSessionReset } = await import('@/services/real-api')
          await fullSessionReset()
        } catch {
          /* ignore */
        }
        await bootstrapAuth()
        navigate('/', { replace: true })
      } catch (e) {
        stripAuthTokenFromUrl()
        setError((e as Error).message || 'Could not complete sign-in')
        setBusy(false)
        setView('login')
        setStatus('')
        loginOnce.current = false
      }
    })()
  }, [mode, params, navigate, setAuth, bootstrapAuth])

  const onGoogle = () => {
    setBusy(true)
    window.location.href = googleLoginUrl()
  }

  const onDevBypass = async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await devBypassLogin()
      setAuth({ user: data.user, token: data.token })
      try {
        const { fullSessionReset } = await import('@/services/real-api')
        await fullSessionReset()
      } catch {
        /* ignore */
      }
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const onLogin = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const data = await loginWithEmail({ email: email.trim(), password })
      setAuth({ user: data.user, token: data.token })
      try {
        const { fullSessionReset } = await import('@/services/real-api')
        await fullSessionReset()
      } catch {
        /* ignore */
      }
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const onRegister = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const data = await registerWithEmail({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
      })
      setAuth({ user: data.user, token: data.token })
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const onForgot = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const res = await requestPasswordReset(email.trim())
      setInfo(res.message)
      if (res.smtp_error) {
        setError(
          `Gmail could not send the email: ${res.smtp_error}. ` +
            'Set SMTP_USER + Gmail App Password in src/.env and restart the API.',
        )
      }
      if (res.dev_reset_url) {
        setInfo(`${res.message} Dev reset link ready below.`)
        // Keep URL visible for local testing without SMTP
        setInfo((prev) => `${prev}\n${res.dev_reset_url}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onReset = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      setBusy(false)
      return
    }
    try {
      const data = await resetPasswordWithToken({
        token: resetToken.trim(),
        new_password: newPassword,
      })
      setAuth({ user: data.user, token: data.token })
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const emailAuth = config?.email_password_enabled !== false

  return (
    <div
      className="app-mesh flex min-h-full items-center justify-center p-4 sm:p-6"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="glass w-full max-w-md rounded-[24px] p-6 sm:rounded-[28px] sm:p-8 md:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[#20B8CD]/30 bg-[#141414]">
            <div className="h-3 w-3 bg-[#20B8CD]" />
          </div>
          <div>
            <h1 className="text-[18px] font-medium tracking-tight text-white/95">
              InterviewPulse
            </h1>
            <p className="text-[12px] text-white/40">
              {view === 'forgot'
                ? 'Reset your password'
                : view === 'reset'
                  ? 'Choose a new password'
                  : view === 'register'
                    ? 'Create your account'
                    : 'Sign in before you use the copilot'}
            </p>
          </div>
        </div>

        {view === 'login' && (
          <p className="mb-6 text-[14px] leading-relaxed text-white/55">
            Sign in with <strong className="font-medium text-white/80">Google</strong> or
            email. Forgot your password? We email a reset link via Gmail.
          </p>
        )}

        {error && (
          <div className="mb-5 whitespace-pre-wrap rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-5 whitespace-pre-wrap break-all rounded-[14px] border border-[#20B8CD]/30 bg-[#20B8CD]/10 px-4 py-3 text-[13px] text-[#5DD5E3]">
            {info}
          </div>
        )}

        {busy && view === 'callback' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#20B8CD]" />
            <p className="text-[15px] font-medium text-white/90">
              {status || 'Completing sign-in…'}
            </p>
            <p className="max-w-xs text-[13px] leading-relaxed text-white/45">
              Google succeeded. Finishing session with the API — this should only take a moment.
            </p>
            <button
              type="button"
              className="mt-2 text-[13px] text-[#20B8CD] underline-offset-2 hover:underline"
              onClick={() => {
                loginOnce.current = false
                setBusy(false)
                setView('login')
                setStatus('')
                navigate('/auth', { replace: true })
              }}
            >
              Stuck? Back to sign-in
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Google */}
            {(view === 'login' || view === 'register') && (
              <>
                <Button
                  size="lg"
                  className="w-full"
                  disabled={!config?.google_configured || busy}
                  onClick={onGoogle}
                >
                  Continue with Google
                </Button>
                {!config?.google_configured && (
                  <p className="text-[12px] leading-relaxed text-[#E8C547]">
                    Google sign-in is not configured on the server yet. Set{' '}
                    <code className="text-[11px]">GOOGLE_CLIENT_ID</code> +{' '}
                    <code className="text-[11px]">GOOGLE_CLIENT_SECRET</code> in{' '}
                    <code className="text-[11px]">src/.env</code>, and register the redirect URI
                    in Google Cloud (local:{' '}
                    <code className="text-[11px]">
                      http://127.0.0.1:8787/v1/auth/google/callback
                    </code>
                    ; production:{' '}
                    <code className="text-[11px]">
                      https://api.jobinterviewcracker.com/v1/auth/google/callback
                    </code>
                    ). Restart the API after saving. See{' '}
                    <code className="text-[11px]">docs/GOOGLE_SIGNIN_JOBINTERVIEWCRACKER.md</code>.
                  </p>
                )}
                {emailAuth && (
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[11px] uppercase tracking-wide text-white/30">or</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                )}
              </>
            )}

            {/* Email login */}
            {emailAuth && view === 'login' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void onLogin()
                }}
              >
                <label className="block">
                  <span className="label-quiet">Email</span>
                  <input
                    className="field"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gmail.com"
                    required
                  />
                </label>
                <label className="block">
                  <span className="label-quiet">Password</span>
                  <input
                    className="field"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </label>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="text-[12px] text-[#5DD5E3] hover:underline"
                    onClick={() => {
                      setError(null)
                      setInfo(null)
                      setView('forgot')
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <Button size="lg" className="w-full" type="submit" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in with email'}
                </Button>
                <p className="text-center text-[12px] text-white/40">
                  No account?{' '}
                  <button
                    type="button"
                    className="text-[#5DD5E3] hover:underline"
                    onClick={() => {
                      setError(null)
                      setView('register')
                    }}
                  >
                    Create one
                  </button>
                </p>
              </form>
            )}

            {/* Register */}
            {emailAuth && view === 'register' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void onRegister()
                }}
              >
                <label className="block">
                  <span className="label-quiet">Name (optional)</span>
                  <input
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                  />
                </label>
                <label className="block">
                  <span className="label-quiet">Email</span>
                  <input
                    className="field"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <span className="label-quiet">Password (min 8 characters)</span>
                  <input
                    className="field"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </label>
                <Button size="lg" className="w-full" type="submit" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create account'}
                </Button>
                <p className="text-center text-[12px] text-white/40">
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="text-[#5DD5E3] hover:underline"
                    onClick={() => {
                      setError(null)
                      setView('login')
                    }}
                  >
                    Sign in
                  </button>
                </p>
              </form>
            )}

            {/* Forgot password */}
            {view === 'forgot' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void onForgot()
                }}
              >
                <p className="text-[13px] leading-relaxed text-white/50">
                  Enter the email for your account. If it exists, we send a reset link from our
                  Gmail SMTP. The link expires in one hour.
                </p>
                {!config?.smtp_configured && (
                  <p className="text-[12px] leading-relaxed text-[#E8C547]">
                    Server Gmail SMTP is not configured yet (
                    <code className="text-[11px]">SMTP_USER</code> + App Password). Reset emails
                    cannot be delivered until that is fixed.
                  </p>
                )}
                <label className="block">
                  <span className="label-quiet">Email</span>
                  <input
                    className="field"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gmail.com"
                    required
                  />
                </label>
                <Button size="lg" className="w-full" type="submit" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Email reset link'}
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-[12px] text-white/40 hover:text-white/70"
                  onClick={() => {
                    setError(null)
                    setInfo(null)
                    setView('login')
                  }}
                >
                  Back to sign in
                </button>
              </form>
            )}

            {/* Reset password (from email link) */}
            {view === 'reset' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void onReset()
                }}
              >
                {!resetToken && (
                  <p className="text-[12px] text-[#E8C547]">
                    Missing reset token. Open the full link from your email, or request a new one.
                  </p>
                )}
                <label className="block">
                  <span className="label-quiet">New password</span>
                  <input
                    className="field"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <label className="block">
                  <span className="label-quiet">Confirm password</span>
                  <input
                    className="field"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <Button
                  size="lg"
                  className="w-full"
                  type="submit"
                  disabled={busy || !resetToken}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save new password'}
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-[12px] text-white/40 hover:text-white/70"
                  onClick={() => {
                    setView('forgot')
                    setError(null)
                  }}
                >
                  Request a new link
                </button>
              </form>
            )}

            {config?.dev_bypass && view === 'login' && (
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => void onDevBypass()}
              >
                Dev bypass (local only)
              </Button>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <DesktopOption variant="link" />
        </div>
        <p className="mt-4 text-center text-[11px] text-white/30">
          By continuing you agree to use the product for personal interview prep.
        </p>
      </div>
    </div>
  )
}
