/** Google auth + Stripe billing client (copilot API on :8787). */

import { resolveCopilotHttpBase } from '@/lib/api-base'

const API_BASE = resolveCopilotHttpBase()

const TOKEN_KEY = 'astra_auth_token'

export type AuthUser = {
  id: number
  email: string
  name?: string | null
  picture_url?: string | null
  subscription_status: string
  subscription_active: boolean
  subscription_current_period_end?: string | null
  access_revoked_reason?: string | null
  welcome_email_sent?: boolean
  last_email_error?: string | null
  created_at?: string | null
}

export type AuthConfig = {
  auth_required: boolean
  google_configured: boolean
  email_password_enabled?: boolean
  stripe_configured: boolean
  smtp_configured: boolean
  forgot_password_ready?: boolean
  dev_bypass: boolean
  frontend_url: string
  public_api_url?: string
  diagnostics?: {
    env_file_hint?: string
    google_redirect_uri?: string
    smtp?: {
      smtp_configured?: boolean
      smtp_user_set?: boolean
      smtp_password_set?: boolean
      welcome_enabled?: boolean
    }
    stripe_price_set?: boolean
    stripe_webhook_secret_set?: boolean
    jwt_secret_is_default?: boolean
    email_password_auth?: boolean
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function authHeaders(): HeadersInit {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return (
      j?.error?.message ||
      j?.detail?.error?.message ||
      (typeof j?.detail === 'string' ? j.detail : null) ||
      res.statusText
    )
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(`${API_BASE}/v1/auth/config`)
    if (!res.ok) {
      return {
        auth_required: false,
        google_configured: false,
        stripe_configured: false,
        smtp_configured: false,
        dev_bypass: false,
        frontend_url: window.location.origin,
      }
    }
    return res.json()
  } catch {
    return {
      auth_required: false,
      google_configured: false,
      stripe_configured: false,
      smtp_configured: false,
      dev_bypass: false,
      frontend_url: window.location.origin,
    }
  }
}

export function googleLoginUrl(): string {
  return `${API_BASE}/v1/auth/google`
}

export async function fetchMe(): Promise<{ user: AuthUser; subscription_active: boolean } | null> {
  const token = getToken()
  if (!token) return null
  const res = await fetch(`${API_BASE}/v1/auth/me`, {
    headers: { ...authHeaders() },
  })
  if (res.status === 401) {
    setToken(null)
    return null
  }
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function devBypassLogin(): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/v1/auth/dev-bypass`, { method: 'POST' })
  if (!res.ok) throw new Error(await parseError(res))
  const data = await res.json()
  setToken(data.token)
  return data
}

export async function startCheckout(): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/billing/checkout`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(await parseError(res))
  const data = await res.json()
  return data.url as string
}

export async function openBillingPortal(): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/billing/portal`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(await parseError(res))
  const data = await res.json()
  return data.url as string
}

/** Pull latest sub from Stripe (fixes webhook lag / refund lag). */
export async function syncBilling(): Promise<{
  user: AuthUser
  subscription_active: boolean
  source: string
}> {
  const res = await fetch(`${API_BASE}/v1/billing/sync`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

/** After Stripe redirects with session_id — confirm without waiting for webhook. */
export async function confirmCheckoutSession(sessionId: string): Promise<{
  user: AuthUser
  subscription_active: boolean
  source: string
}> {
  const res = await fetch(`${API_BASE}/v1/billing/confirm-session`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function resendWelcomeEmail(): Promise<{
  welcome_email_sent: boolean
  last_email_error: string | null
}> {
  const res = await fetch(`${API_BASE}/v1/auth/resend-welcome`, {
    method: 'POST',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function registerWithEmail(input: {
  email: string
  password: string
  name?: string
}): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseError(res))
  const data = await res.json()
  setToken(data.token)
  return data
}

export async function loginWithEmail(input: {
  email: string
  password: string
}): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseError(res))
  const data = await res.json()
  setToken(data.token)
  return data
}

export async function requestPasswordReset(email: string): Promise<{
  ok: boolean
  message: string
  dev_reset_url?: string | null
  smtp_error?: string | null
}> {
  const res = await fetch(`${API_BASE}/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function resetPasswordWithToken(input: {
  token: string
  new_password: string
}): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseError(res))
  const data = await res.json()
  setToken(data.token)
  return data
}

export async function fetchBillingStatus(): Promise<{
  configured: boolean
  subscription_status: string
  subscription_active: boolean
  subscription_current_period_end: string | null
  access_revoked_reason?: string | null
}> {
  const res = await fetch(`${API_BASE}/v1/billing/status`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export function logout() {
  setToken(null)
}

export { API_BASE }
