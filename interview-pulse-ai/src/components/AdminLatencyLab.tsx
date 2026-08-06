/**
 * Admin-only holistic latency lab — single-shot view of E2E / STT / stages.
 */
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatMs } from '@/lib/utils'
import {
  DEFAULT_LAB_CONFIG,
  runHolisticLatencyLab,
  type HolisticLatencyReport,
  type LatencyLabConfig,
} from '@/services/latency-lab'
import {
  Activity,
  Gauge,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Timer,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

function gradeTone(
  g?: string,
): 'emerald' | 'amber' | 'indigo' | 'default' {
  if (g === 'excellent' || g === 'good') return 'emerald'
  if (g === 'acceptable') return 'amber'
  if (g === 'poor') return 'indigo'
  return 'default'
}

export function AdminLatencyLab() {
  const [config, setConfig] = useState<LatencyLabConfig>({ ...DEFAULT_LAB_CONFIG })
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<HolisticLatencyReport | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setError(null)
    setProgress('Starting…')
    setReport(null)
    try {
      const r = await runHolisticLatencyLab(config, setProgress, ac.signal)
      setReport(r)
      setProgress(null)
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setError('Suite cancelled')
      } else {
        setError((e as Error).message || 'Suite failed')
      }
      setProgress(null)
    } finally {
      setRunning(false)
    }
  }, [config])

  const cancel = () => {
    abortRef.current?.abort()
    setRunning(false)
    setProgress('Cancelled')
  }

  const rows = report?.server?.rows || []
  const clientRows = report?.client.inject_rows || []

  return (
    <div className="flex flex-col gap-6">
      <section className="glass rounded-[28px] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[#5DD5E3]" strokeWidth={1.75} />
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                Latency lab
              </h2>
              <Badge tone="indigo">Admin only</Badge>
            </div>
            <p className="max-w-2xl text-[13px] leading-relaxed text-white/40">
              One-shot holistic test of the <strong className="text-white/60">live Interview</strong>{' '}
              path — not mock-only. Measures health RTT, warm, STT, server first-useful /
              full answer (Shorter & STAR), client browser E2E paint, and grounding on the
              SAP FICO 30% month-end case.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {running ? (
              <Button variant="secondary" size="sm" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={running}
              onClick={() => void run()}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {running ? 'Running…' : 'Run full suite'}
            </Button>
          </div>
        </div>

        {/* Config */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-[12px] text-white/40">
            Formats
            <div className="flex flex-wrap gap-2">
              {(['shorter', 'star', 'technical'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`rounded-full px-3 py-1 text-[12px] ${
                    config.modes.includes(m)
                      ? 'bg-[#20B8CD]/20 text-[#5DD5E3]'
                      : 'bg-white/[0.04] text-white/40'
                  }`}
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      modes: c.modes.includes(m)
                        ? c.modes.filter((x) => x !== m)
                        : [...c.modes, m],
                    }))
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-white/40">
            Depths
            <div className="flex flex-wrap gap-2">
              {(['fast', 'balanced', 'deep'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`rounded-full px-3 py-1 text-[12px] ${
                    config.depths.includes(d)
                      ? 'bg-[#20B8CD]/20 text-[#5DD5E3]'
                      : 'bg-white/[0.04] text-white/40'
                  }`}
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      depths: c.depths.includes(d)
                        ? c.depths.filter((x) => x !== d)
                        : [...c.depths, d],
                    }))
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-white/40">
            Max questions (server)
            <input
              type="number"
              min={1}
              max={24}
              value={config.maxQuestions}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  maxQuestions: Math.max(1, Math.min(24, Number(e.target.value) || 6)),
                }))
              }
              className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-white/50">
          {(
            [
              ['includeStt', 'STT probe'],
              ['includeLlm', 'Live LLM'],
              ['warmFirst', 'Warm first'],
              ['clientE2e', 'Browser E2E'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config[key]}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, [key]: e.target.checked }))
                }
                className="accent-[#20B8CD]"
              />
              {label}
            </label>
          ))}
        </div>

        {progress && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-[#5DD5E3]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
            {error}
          </div>
        )}
      </section>

      {report && (
        <>
          {/* Verdict strip */}
          <section className="glass rounded-[28px] p-6 md:p-8">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[#5DD5E3]" strokeWidth={1.75} />
                <h3 className="text-[15px] font-medium text-white/90">
                  Single-shot latency view
                </h3>
              </div>
              <Badge tone={report.combined.pass ? 'emerald' : 'amber'}>
                {report.combined.pass ? 'PASS' : 'REVIEW'}
              </Badge>
            </div>
            <p className="mb-5 text-[13px] text-white/45">{report.combined.summary}</p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {report.combined.cards.map((c) => (
                <div
                  key={c.label}
                  className="rounded-[16px] bg-white/[0.04] px-3 py-3"
                >
                  <div className="text-[10px] uppercase tracking-wide text-white/30">
                    {c.label}
                  </div>
                  <div className="mt-1 text-[18px] font-medium text-white/90">
                    {c.value}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge tone={gradeTone(c.grade)}>{c.grade}</Badge>
                  </div>
                  {c.hint && (
                    <div className="mt-1 text-[10px] text-white/30">{c.hint}</div>
                  )}
                </div>
              ))}
            </div>

            {report.server?.suite_ms != null && (
              <p className="mt-4 text-[11px] text-white/30">
                Server suite wall: {formatMs(report.server.suite_ms)}
                {report.server.gates && (
                  <>
                    {' · '}
                    Gates:{' '}
                    {Object.entries(report.server.gates)
                      .map(([k, v]) => `${k}:${v ? 'ok' : 'fail'}`)
                      .join(' · ')}
                  </>
                )}
              </p>
            )}
          </section>

          {/* STT + warm detail */}
          <section className="grid gap-4 md:grid-cols-2">
            <div className="glass rounded-[22px] p-5">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-white/80">
                <Radio className="h-4 w-4 text-[#5DD5E3]" strokeWidth={1.75} />
                STT
              </div>
              {report.server?.stt ? (
                <dl className="space-y-1.5 text-[12px] text-white/50">
                  <div className="flex justify-between gap-2">
                    <dt>Status</dt>
                    <dd className="text-white/80">
                      {report.server.stt.ok ? 'ok' : 'fail'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Latency</dt>
                    <dd className="text-white/80">
                      {report.server.stt.stt_ms != null
                        ? formatMs(Number(report.server.stt.stt_ms))
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Provider</dt>
                    <dd className="text-white/80">
                      {report.server.stt.provider || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Source</dt>
                    <dd className="truncate text-white/80">
                      {report.server.stt.path || '—'}
                    </dd>
                  </div>
                  {report.server.stt.note && (
                    <p className="pt-1 text-[11px] text-white/35">
                      {report.server.stt.note}
                    </p>
                  )}
                  {report.server.stt.error && (
                    <p className="text-[#E85D5D]">{report.server.stt.error}</p>
                  )}
                </dl>
              ) : (
                <p className="text-[12px] text-white/35">STT not run</p>
              )}
            </div>
            <div className="glass rounded-[22px] p-5">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-white/80">
                <Timer className="h-4 w-4 text-[#5DD5E3]" strokeWidth={1.75} />
                Health / warm
              </div>
              <dl className="space-y-1.5 text-[12px] text-white/50">
                <div className="flex justify-between gap-2">
                  <dt>Health RTT</dt>
                  <dd className="text-white/80">
                    {report.client.health_rtt_ms != null
                      ? formatMs(report.client.health_rtt_ms)
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Warm</dt>
                  <dd className="text-white/80">
                    {report.client.warm_ms != null
                      ? formatMs(report.client.warm_ms)
                      : report.server?.warm?.ms != null
                        ? formatMs(Number(report.server.warm.ms))
                        : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>OpenAI key</dt>
                  <dd className="text-white/80">
                    {report.server?.health?.openai_key ? 'yes' : 'no'}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Server rows */}
          {rows.length > 0 && (
            <section className="glass overflow-hidden rounded-[28px]">
              <div className="border-b border-white/[0.06] px-5 py-4">
                <h3 className="text-[14px] font-medium text-white/85">
                  Server cascade rows
                  <span className="ml-2 text-white/35">({rows.length})</span>
                </h3>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <thead className="sticky top-0 bg-[#121212] text-[10px] uppercase tracking-wide text-white/35">
                    <tr>
                      <th className="px-3 py-2">Q</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Depth</th>
                      <th className="px-3 py-2">First useful</th>
                      <th className="px-3 py-2">Full</th>
                      <th className="px-3 py-2">LLM first</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Ground</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {rows.map((r, i) => (
                      <tr key={i} className="text-white/70">
                        <td className="max-w-[180px] truncate px-3 py-2" title={String(r.question || '')}>
                          {String(r.id || r.cat || '—')}
                        </td>
                        <td className="px-3 py-2">{String(r.mode || '—')}</td>
                        <td className="px-3 py-2">{String(r.depth || '—')}</td>
                        <td className="px-3 py-2">
                          {r.first_useful_ms != null
                            ? formatMs(Number(r.first_useful_ms))
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {r.full_ms != null ? formatMs(Number(r.full_ms)) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {r.llm_first_token_ms != null
                            ? formatMs(Number(r.llm_first_token_ms))
                            : '—'}
                        </td>
                        <td className="px-3 py-2">{String(r.source || (r.ok ? '—' : 'err'))}</td>
                        <td className="px-3 py-2">
                          {r.grounding
                            ? (r.grounding as { pass?: boolean }).pass
                              ? 'pass'
                              : 'fail'
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Client E2E rows */}
          {clientRows.length > 0 && (
            <section className="glass overflow-hidden rounded-[28px]">
              <div className="border-b border-white/[0.06] px-5 py-4">
                <h3 className="text-[14px] font-medium text-white/85">
                  Browser E2E (true client clock)
                  <span className="ml-2 text-white/35">({clientRows.length})</span>
                </h3>
              </div>
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full min-w-[640px] text-left text-[12px]">
                  <thead className="sticky top-0 bg-[#121212] text-[10px] uppercase tracking-wide text-white/35">
                    <tr>
                      <th className="px-3 py-2">Question</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Client first</th>
                      <th className="px-3 py-2">Client full</th>
                      <th className="px-3 py-2">Server first</th>
                      <th className="px-3 py-2">Server full</th>
                      <th className="px-3 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {clientRows.map((r, i) => (
                      <tr key={i} className="text-white/70">
                        <td className="max-w-[200px] truncate px-3 py-2" title={r.question}>
                          {r.question}
                        </td>
                        <td className="px-3 py-2">
                          {r.mode}/{r.depth}
                        </td>
                        <td className="px-3 py-2">
                          {formatMs(r.client_submit_to_first_ms)}
                        </td>
                        <td className="px-3 py-2">
                          {formatMs(r.client_submit_to_full_ms)}
                        </td>
                        <td className="px-3 py-2">
                          {r.server_first_useful_ms != null
                            ? formatMs(r.server_first_useful_ms)
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {r.server_full_ms != null
                            ? formatMs(r.server_full_ms)
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {r.ok ? r.source || '—' : r.error || 'err'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void run()}
              disabled={running}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run suite
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
