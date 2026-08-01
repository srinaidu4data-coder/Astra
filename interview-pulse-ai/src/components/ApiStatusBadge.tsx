import { checkCopilotHealth, type CopilotHealth } from '@/services/real-api'
import { resolveCopilotHttpBase } from '@/lib/api-base'
import { cn } from '@/lib/utils'
import { Activity, AlertTriangle, Loader2, RefreshCw, ServerOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type Props = {
  /** compact = pill for top bar; banner = full-width offline strip */
  variant?: 'compact' | 'banner'
  className?: string
  pollMs?: number
}

/**
 * Always-visible API online/offline indicator.
 * Polls /api/health so you never wonder if copilot_api.py is running.
 */
export function ApiStatusBadge({
  variant = 'compact',
  className,
  pollMs = 10000,
}: Props) {
  const [health, setHealth] = useState<CopilotHealth | null>(null)
  const [checking, setChecking] = useState(true)
  const [open, setOpen] = useState(false)

  const poll = useCallback(async (opts?: { silent?: boolean }) => {
    // Avoid spinner flash on every interval tick — only spin on first load / manual refresh
    if (!opts?.silent) setChecking(true)
    try {
      const h = await checkCopilotHealth()
      setHealth((prev) => {
        // Skip React update if nothing meaningful changed (stops badge flicker)
        if (
          prev &&
          prev.ok === h.ok &&
          prev.openai_ready === h.openai_ready &&
          prev.stt_provider === h.stt_provider &&
          prev.stt_deepgram_ready === h.stt_deepgram_ready &&
          prev.llm_provider === h.llm_provider
        ) {
          return prev
        }
        return h
      })
    } finally {
      if (!opts?.silent) setChecking(false)
      else setChecking(false)
    }
  }, [])

  useEffect(() => {
    void poll()
    // Slower background poll; silent so UI doesn't flash "checking"
    const id = window.setInterval(() => void poll({ silent: true }), pollMs)
    const onFocus = () => void poll({ silent: true })
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [poll, pollMs])

  const online = Boolean(health?.ok)
  const llmOk = Boolean(health?.openai_ready ?? health?.openai_key)
  const stt = health?.stt_provider || '—'
  const base = resolveCopilotHttpBase()

  if (variant === 'banner') {
    if (online && llmOk) return null
    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-[16px] border px-4 py-3 text-[13px]',
          !online
            ? 'border-rose-500/40 bg-rose-500/15 text-rose-100'
            : 'border-amber-400/35 bg-amber-400/10 text-amber-50',
          className,
        )}
        role="status"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {!online ? (
            <ServerOff className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          )}
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium tracking-tight">
              {!online ? 'API offline — answers and live STT will not work' : 'API online — LLM key missing'}
            </p>
            <p className="text-[12px] opacity-80">
              {!online ? (
                <>
                  Start backend: <code className="text-[11px]">cd src && python copilot_api.py</code>
                  {' · '}
                  <span className="opacity-70">{base}</span>
                </>
              ) : (
                <>
                  Set <code className="text-[11px]">OPENAI_API_KEY</code> or{' '}
                  <code className="text-[11px]">GROQ_API_KEY</code> in <code className="text-[11px]">src/.env</code>
                  , then restart the API. You will only see outline stubs until then.
                </>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void poll()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/15"
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          Recheck
        </button>
      </div>
    )
  }

  // compact pill
  const tone = !online
    ? 'border-rose-500/45 bg-rose-500/15 text-rose-100'
    : !llmOk
      ? 'border-amber-400/40 bg-amber-400/12 text-amber-50'
      : 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'

  const label = !online ? 'API OFF' : !llmOk ? 'API · no LLM' : 'API ON'
  const title = !online
    ? `API offline (${base}). Run: cd src && python copilot_api.py`
    : !llmOk
      ? `API reachable but LLM not ready (${health?.llm_provider || '?'}). Set OPENAI_API_KEY / GROQ_API_KEY.`
      : `API online · ${health?.llm_provider || 'llm'} · STT ${stt}`

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          void poll()
        }}
        title={title}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium tracking-tight transition-colors',
          tone,
        )}
        aria-live="polite"
      >
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            !online
              ? 'bg-rose-400'
              : !llmOk
                ? 'bg-amber-300'
                : 'bg-emerald-400',
          )}
        />
        {checking && !health ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin opacity-70" />
        ) : (
          <Activity className="h-3.5 w-3.5 opacity-80" strokeWidth={1.75} />
        )}
        <span>{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-[16px] border border-white/10 bg-[#0B0F17]/95 p-3 text-[12px] text-white/75 shadow-xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium text-white/90">Backend status</span>
            <button
              type="button"
              className="text-white/40 hover:text-white/70"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <dl className="space-y-1.5">
            <Row
              k="API"
              v={online ? 'Online' : 'Offline'}
              good={online}
            />
            <Row
              k="LLM"
              v={
                llmOk
                  ? `Ready (${health?.llm_provider || '?'})`
                  : online
                    ? 'Key missing / not ready'
                    : '—'
              }
              good={llmOk}
            />
            <Row
              k="STT"
              v={
                online
                  ? `${stt}${health?.stt_deepgram_ready ? ' · Deepgram OK' : ''}`
                  : '—'
              }
              good={online && (stt === 'deepgram' ? health?.stt_deepgram_ready : true)}
            />
            <Row k="URL" v={base} good={online} mono />
          </dl>
          {!online && (
            <p className="mt-2 rounded-[10px] bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-100/90">
              Start API:{' '}
              <code className="text-[10px]">cd src && python copilot_api.py</code>
              <br />
              Then open{' '}
              <code className="text-[10px]">{base}/api/health</code>
            </p>
          )}
          {online && !llmOk && (
            <p className="mt-2 rounded-[10px] bg-amber-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-50/90">
              Answers will be empty outlines until LLM key is set in{' '}
              <code className="text-[10px]">src/.env</code> and API restarted.
            </p>
          )}
          <button
            type="button"
            onClick={() => void poll()}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-white/8 py-1.5 text-[11px] text-white/70 hover:bg-white/12"
          >
            {checking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
            )}
            Refresh status
          </button>
        </div>
      )}
    </div>
  )
}

function Row({
  k,
  v,
  good,
  mono,
}: {
  k: string
  v: string
  good?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-white/40">{k}</dt>
      <dd
        className={cn(
          'min-w-0 text-right',
          mono && 'break-all font-mono text-[10px]',
          good === true && 'text-emerald-300/90',
          good === false && 'text-rose-300/90',
        )}
      >
        {v}
      </dd>
    </div>
  )
}
