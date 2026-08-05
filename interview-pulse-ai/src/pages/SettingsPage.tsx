import { DesktopOption } from '@/components/DesktopOption'
import { LatencyMetricsPanel } from '@/components/LatencyMetricsPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { clamp } from '@/lib/utils'
import {
  googleLoginUrl,
  logout,
  openBillingPortal,
  resendWelcomeEmail,
  startCheckout,
  syncBilling,
} from '@/services/auth'
import { useAppStore } from '@/stores/app-store'
import { useState } from 'react'

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const stealth = useAppStore((s) => s.stealth)
  const updateStealth = useAppStore((s) => s.updateStealth)
  const user = useAppStore((s) => s.user)
  const authConfig = useAppStore((s) => s.authConfig)
  const clearAuth = useAppStore((s) => s.clearAuth)
  const refreshAuth = useAppStore((s) => s.refreshAuth)
  const setAuthFromUser = useAppStore((s) => s.setAuthFromUser)
  const setRoute = useAppStore((s) => s.setRoute)
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingErr, setBillingErr] = useState<string | null>(null)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)

  const applyOpacity = async (opacity: number) => {
    updateStealth({ opacity })
    await window.interviewPulse?.setOverlayOpacity(opacity)
  }

  const applyClickThrough = async (enabled: boolean) => {
    updateStealth({ clickThrough: enabled })
    await window.interviewPulse?.setClickThrough(enabled)
  }

  const applyProtection = async (enabled: boolean) => {
    updateStealth({ contentProtection: enabled })
    await window.interviewPulse?.setContentProtection(enabled)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      {/* Latency stack moved from Interview (Copilot) — every metric preserved */}
      <LatencyMetricsPanel />

      <section className="glass relative overflow-hidden rounded-[28px] p-8 md:p-10">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5DD5E3]/35 to-transparent"
          aria-hidden
        />
        <h2 className="text-[17px] font-medium tracking-tight text-white/95">
          Account & billing
        </h2>
        <p className="mt-1 mb-6 text-[13px] leading-relaxed text-white/40">
          Sign in with Google or email. Subscribe with Stripe when billing is enabled.
        </p>

        {user ? (
          <div className="mb-5 flex items-center gap-4">
            {user.picture_url ? (
              <img
                src={user.picture_url}
                alt=""
                className="h-12 w-12 rounded-full ring-1 ring-white/10"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-[14px] text-white/70">
                {(user.name || user.email).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-[15px] text-white/90">
                {user.name || user.email}
              </div>
              <div className="truncate text-[12px] text-white/40">{user.email}</div>
            </div>
            <Badge tone={user.subscription_active ? 'emerald' : 'amber'}>
              {user.subscription_active ? 'Subscribed' : user.subscription_status}
            </Badge>
            {user.is_admin ? <Badge tone="indigo">Admin</Badge> : null}
          </div>
        ) : (
          <p className="mb-5 text-[13px] text-white/45">
            {authConfig?.google_configured
              ? 'Not signed in.'
              : 'Google OAuth not configured — app is open for local use.'}
          </p>
        )}

        {user && (
          <div className="mb-5 rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[12px] text-white/50">
            Answer model:{' '}
            <span className="text-white/80">
              {user.effective_answer_model || user.answer_model || 'gpt-4o'}
            </span>
            <span className="mx-1.5 text-white/25">·</span>
            Fallback:{' '}
            <span className="text-white/80">
              {user.effective_fallback_model || user.fallback_model || 'gpt-4o-mini'}
            </span>
            {user.is_admin && (
              <button
                type="button"
                className="ml-3 text-[#5DD5E3] hover:underline"
                onClick={() => setRoute('admin')}
              >
                Open admin console
              </button>
            )}
          </div>
        )}

        {billingErr && (
          <div className="mb-4 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
            {billingErr}
          </div>
        )}
        {billingMsg && (
          <div className="mb-4 rounded-[14px] border border-[#20B8CD]/30 bg-[#20B8CD]/10 px-4 py-3 text-[13px] text-[#5DD5E3]">
            {billingMsg}
          </div>
        )}

        {user?.last_email_error && (
          <div className="mb-4 rounded-[14px] border border-[#E8C547]/40 bg-[#E8C547]/10 px-4 py-3 text-[12px] text-[#E8C547]">
            Gmail send issue: {user.last_email_error}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {!user && authConfig?.google_configured && (
            <Button onClick={() => { window.location.href = googleLoginUrl() }}>
              Sign in with Google
            </Button>
          )}
          {user && !user.subscription_active && authConfig?.stripe_configured && (
            <Button
              disabled={billingBusy}
              onClick={() => {
                setBillingBusy(true)
                setBillingErr(null)
                void startCheckout()
                  .then((url) => {
                    window.location.href = url
                  })
                  .catch((e) => {
                    setBillingErr((e as Error).message)
                    setBillingBusy(false)
                  })
              }}
            >
              Subscribe monthly
            </Button>
          )}
          {user && (
            <>
              <Button
                variant="secondary"
                disabled={billingBusy}
                onClick={() => {
                  setBillingBusy(true)
                  setBillingErr(null)
                  setBillingMsg(null)
                  void syncBilling()
                    .then((data) => {
                      setAuthFromUser(data.user)
                      setBillingMsg(
                        `Synced from Stripe (${data.source}): ${data.user.subscription_status}` +
                          (data.user.access_revoked_reason
                            ? ` · ${data.user.access_revoked_reason}`
                            : ''),
                      )
                    })
                    .catch((e) => setBillingErr((e as Error).message))
                    .finally(() => setBillingBusy(false))
                }}
              >
                Sync billing
              </Button>
              <Button
                variant="secondary"
                disabled={billingBusy}
                onClick={() => {
                  setBillingBusy(true)
                  setBillingErr(null)
                  void openBillingPortal()
                    .then((url) => {
                      window.location.href = url
                    })
                    .catch((e) => {
                      setBillingErr((e as Error).message)
                      setBillingBusy(false)
                    })
                }}
              >
                Manage billing / refunds
              </Button>
              <Button
                variant="ghost"
                disabled={billingBusy}
                onClick={() => {
                  setBillingBusy(true)
                  setBillingErr(null)
                  setBillingMsg(null)
                  void resendWelcomeEmail()
                    .then((r) => {
                      setBillingMsg(
                        r.welcome_email_sent
                          ? 'Welcome email sent.'
                          : `Welcome email failed: ${r.last_email_error || 'unknown'}`,
                      )
                      void refreshAuth()
                    })
                    .catch((e) => setBillingErr((e as Error).message))
                    .finally(() => setBillingBusy(false))
                }}
              >
                Resend welcome email
              </Button>
              <Button variant="ghost" onClick={() => void refreshAuth()}>
                Refresh status
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  logout()
                  clearAuth()
                }}
              >
                Sign out
              </Button>
            </>
          )}
        </div>

        {authConfig?.diagnostics && (
          <div className="mt-6 space-y-1 rounded-[14px] glass-inset px-4 py-3 text-[11px] leading-relaxed text-white/35">
            <div>Wiring diagnostics (no secrets)</div>
            <div>Google: {authConfig.google_configured ? 'ok' : 'missing client id/secret'}</div>
            <div>
              Gmail SMTP:{' '}
              {authConfig.smtp_configured
                ? 'configured'
                : 'missing SMTP_USER / SMTP_PASSWORD (use App Password)'}
            </div>
            <div>
              Stripe: {authConfig.stripe_configured ? 'ok' : 'missing secret key or price id'}
              {authConfig.diagnostics.stripe_webhook_secret_set
                ? ' · webhook secret set'
                : ' · webhook secret missing (local ok, prod required)'}
            </div>
            <div>Redirect URI: {authConfig.diagnostics.google_redirect_uri}</div>
          </div>
        )}
      </section>

      <section className="glass rounded-[28px] p-8 md:p-10">
        <h2 className="text-[17px] font-medium tracking-tight text-white/95">
          Intelligence
        </h2>
        <p className="mt-1 mb-8 text-[13px] leading-relaxed text-white/40">
          Real answers use the Python copilot API on port 8787. Demo mode only simulates the stream.
        </p>

        <div className="mb-8 rounded-[18px] glass-inset px-5 py-4 text-[13px] leading-relaxed text-white/45">
          <p className="mb-2 font-light text-white/70">Start backend</p>
          <code className="block text-[12px] text-[#5DD5E3]">
            venv\Scripts\python.exe copilot_api.py
          </code>
        </div>

        <label className="mb-8 flex items-center justify-between gap-4 text-[14px] text-white/80">
          <span className="flex items-center gap-2">
            Demo mode
            {settings.demoMode && <Badge tone="amber">On</Badge>}
          </span>
          <input
            type="checkbox"
            checked={settings.demoMode}
            onChange={(e) => updateSettings({ demoMode: e.target.checked })}
            className="h-5 w-5 accent-[#20B8CD]"
          />
        </label>

        <div className="space-y-5">
          <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] leading-relaxed text-white/40">
            <strong className="text-white/60">LLM keys are server-side only.</strong> OpenAI/Anthropic
            fields below are not sent to the API. Set{' '}
            <code className="text-[11px] text-white/50">OPENAI_API_KEY</code> or{' '}
            <code className="text-[11px] text-white/50">GROQ_API_KEY</code> on Railway / local{' '}
            <code className="text-[11px] text-white/50">.env</code>. Deepgram can be set here (sent on
            Start) or as <code className="text-[11px] text-white/50">DEEPGRAM_API_KEY</code> on the server.
          </div>
          <Field
            label="OpenAI API key (local reference only — not used by live API)"
            value={settings.openaiKey}
            onChange={(v) => updateSettings({ openaiKey: v })}
            placeholder="Set on server env instead"
          />
          <Field
            label="Anthropic API key (local reference only — not used by live API)"
            value={settings.anthropicKey}
            onChange={(v) => updateSettings({ anthropicKey: v })}
            placeholder="Not wired to live answers"
          />
          <Field
            label="Deepgram API key (Nova-3 streaming STT — sent on Start)"
            value={settings.deepgramKey}
            onChange={(v) => updateSettings({ deepgramKey: v })}
            placeholder="your Deepgram key…"
          />
          <p className="text-[12px] leading-relaxed text-white/35">
            When set, live interviews use <strong className="text-white/55">Deepgram Nova-3</strong>{' '}
            streaming speech-to-text (much faster than local Whisper). Also set{' '}
            <code className="text-[11px] text-white/45">DEEPGRAM_API_KEY</code> on the API server.
            Leave empty to use Whisper only. Reconnect restores this key.
          </p>
          <label>
            <span className="label-quiet">Job context (same as Live interview)</span>
            <input
              className="field"
              value={settings.jobContext}
              onChange={(e) => updateSettings({ jobContext: e.target.value })}
              placeholder="Optional — leave blank if unused"
            />
          </label>
          <label>
            <span className="label-quiet">Tone</span>
            <select
              className="field"
              value={settings.tone}
              onChange={(e) =>
                updateSettings({
                  tone: e.target.value as 'professional' | 'casual' | 'confident',
                })
              }
            >
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="confident">Confident</option>
            </select>
          </label>
          <label>
            <span className="label-quiet">Interview audio source (applies on next Start)</span>
            <select
              className="field"
              value={settings.audioSource || 'auto'}
              onChange={(e) =>
                updateSettings({
                  audioSource: e.target.value as
                    | 'auto'
                    | 'system'
                    | 'display'
                    | 'mic',
                })
              }
            >
              <option value="auto">
                Auto (recommended) — speakers only, never mic
              </option>
              <option value="display">
                Share tab / system audio (Chrome share dialog)
              </option>
              <option value="system">
                System loopback (local Windows Stereo Mix / WASAPI)
              </option>
              <option value="mic">
                Microphone (last resort — also hears your answers)
              </option>
            </select>
          </label>
          <p className="text-[12px] leading-relaxed text-white/35">
            Like Final Round / Cluely: we listen to <strong className="text-white/55">what plays on
            your PC</strong> (meeting tab or system audio), not your mic. That way only the
            interviewer is transcribed — not your spoken answers.
            {(settings.audioSource === 'display' ||
              settings.audioSource === 'auto' ||
              !settings.audioSource) && (
              <>
                {' '}
                On Start (web), pick the Teams/Zoom <strong className="text-white/55">tab</strong>{' '}
                and enable <strong className="text-white/55">Share tab audio</strong>. Local
                Windows Auto uses Stereo Mix when available.
              </>
            )}
            {settings.audioSource === 'system' && (
              <>
                {' '}
                Enable <strong className="text-white/55">Stereo Mix</strong> in Windows Sound →
                Recording (right-click empty area → Show Disabled Devices).
              </>
            )}
            {settings.audioSource === 'mic' && (
              <>
                {' '}
                <strong className="text-[#E8C547]">Warning:</strong> mic mode will hear you answer
                out loud and may generate answers to your own speech. Prefer Speakers.
              </>
            )}
          </p>
        </div>
      </section>

      <section className="glass rounded-[28px] p-8 md:p-10">
        <h2 className="text-[17px] font-medium tracking-tight text-white/95">
          Stealth
        </h2>
        <p className="mt-1 mb-8 text-[13px] leading-relaxed text-white/40">
          Hide the app from Zoom/Meet/Teams screen share. This only applies in the{' '}
          <strong className="text-white/60">Electron desktop app</strong> (
          <code className="text-[12px]">npm run dev:electron</code>
          ) or the Python copilot — not in the website browser tab. Overlay hotkey:{' '}
          {stealth.hotkey || 'Ctrl+Shift+S'}.
        </p>
        {typeof window !== 'undefined' && !window.interviewPulse && (
          <div className="mb-6 space-y-3">
            <p className="rounded-[14px] border border-[#E8C547]/35 bg-[#E8C547]/10 px-4 py-3 text-[13px] text-[#E8C547]">
              You are in the browser. Stealth toggles will not hide this tab from a screen share.
              Use the desktop app for real content protection.
            </p>
            <DesktopOption variant="card" />
          </div>
        )}

        <div className="space-y-6">
          <ToggleRow
            label="Hide from screen share"
            checked={stealth.contentProtection}
            onChange={(v) => void applyProtection(v)}
          />
          <ToggleRow
            label="Click-through overlay"
            checked={stealth.clickThrough}
            onChange={(v) => void applyClickThrough(v)}
          />
          <div>
            <div className="mb-3 flex justify-between text-[13px] text-white/45">
              <span>Opacity</span>
              <span>{Math.round(stealth.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(stealth.opacity * 100)}
              onChange={(e) =>
                void applyOpacity(clamp(Number(e.target.value) / 100, 0.2, 1))
              }
              className="w-full accent-[#20B8CD]"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => void window.interviewPulse?.openOverlay()}
          >
            Open overlay
          </Button>
        </div>
      </section>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label>
      <span className="label-quiet">{label}</span>
      <input
        type="password"
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-[14px] text-white/80">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-[#20B8CD]"
      />
    </label>
  )
}
