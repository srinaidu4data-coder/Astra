import { formatMs } from '@/lib/utils'
import { fetchLatencyMetrics } from '@/services/real-api'
import { useAppStore } from '@/stores/app-store'
import type { LatencySnapshot } from '@/types'
import { useEffect, useState } from 'react'

function gradeColor(grade?: string) {
  if (grade === 'excellent') return 'text-emerald-400'
  if (grade === 'good') return 'text-[#20B8CD]'
  if (grade === 'acceptable') return 'text-[#E8C547]'
  if (grade === 'poor') return 'text-rose-400'
  return 'text-white/70'
}

/**
 * Session + stage latency + competitor board.
 * Lives in Settings so Interview stays clean for young users.
 */
export function LatencyMetricsPanel() {
  const metrics = useAppStore((s) => s.metrics)
  const listening = useAppStore((s) => s.listening)
  const [latencySnap, setLatencySnap] = useState<LatencySnapshot | null>(null)
  const [showBench, setShowBench] = useState(false)

  useEffect(() => {
    const tick = () => {
      void fetchLatencyMetrics().then((s) => {
        if (s) setLatencySnap(s)
      })
    }
    tick()
    const id = window.setInterval(tick, 12000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <section className="glass rounded-[28px] p-8 md:p-10">
      <h2 className="text-[17px] font-medium tracking-tight text-white/95">Speed & latency</h2>
      <p className="mt-1 mb-6 text-[13px] leading-relaxed text-white/40">
        Live timing for your last answers. Moved here so Interview stays simple — nothing removed.
      </p>

      {/* Session / first useful / full / true E2E strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[
          { label: 'Session', value: listening ? 'ON' : 'Off' },
          {
            label: 'First useful',
            value: metrics
              ? formatMs(metrics.firstUsefulMs || metrics.firstTokenMs || 0)
              : '—',
          },
          {
            label: 'Full answer',
            value:
              metrics?.fullAnswerMs != null
                ? formatMs(metrics.fullAnswerMs)
                : metrics?.totalMs
                  ? formatMs(metrics.totalMs)
                  : '—',
          },
          {
            label: 'True E2E',
            value: metrics
              ? formatMs(
                  metrics.clientE2eMs ||
                    metrics.totalPipelineMs ||
                    metrics.totalMs ||
                    metrics.fullAnswerMs ||
                    0,
                )
              : '—',
          },
        ].map((k) => (
          <div key={k.label} className="glass rounded-[18px] px-4 py-4">
            <div className="text-[11px] text-white/35 sm:text-[12px]">{k.label}</div>
            <div
              className={`mt-1.5 text-[20px] font-medium tracking-tight ${
                k.label === 'Session' && listening ? 'text-[#20B8CD]' : 'text-white/90'
              }`}
            >
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Latency stack */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-medium text-white/90">Latency stack</h3>
          <p className="text-[11px] text-white/35">
            First useful ≠ full answer. E2E is submit → full render, never first-token alone.
          </p>
        </div>
        <button
          type="button"
          className="text-[12px] text-[#20B8CD] hover:underline"
          onClick={() => {
            setShowBench((v) => !v)
            void fetchLatencyMetrics().then((s) => {
              if (s) setLatencySnap(s)
            })
          }}
        >
          {showBench ? 'Hide benchmark' : 'Stage history'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'STT', ms: metrics?.sttMs },
          { label: 'Outline', ms: metrics?.outlineMs },
          { label: 'Cache', ms: metrics?.cacheMs },
          { label: 'LLM first', ms: metrics?.llmFirstTokenMs },
          { label: 'First useful', ms: metrics?.firstUsefulMs || metrics?.firstTokenMs },
          {
            label: 'True E2E',
            ms: metrics?.clientE2eMs || metrics?.totalPipelineMs || metrics?.totalMs,
          },
        ].map((s) => (
          <div key={s.label} className="rounded-[14px] bg-white/[0.04] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-white/30">{s.label}</div>
            <div className="mt-0.5 text-[15px] font-medium text-white/85">
              {s.ms != null && s.ms > 0 ? formatMs(s.ms) : '—'}
            </div>
          </div>
        ))}
      </div>

      {metrics?.answerMode && (
        <p className="mt-2 text-[11px] text-white/40">
          Grounding mode: <span className="text-white/70">{metrics.answerMode}</span>
          {metrics.requestId ? ` · req ${metrics.requestId}` : ''}
        </p>
      )}

      {latencySnap?.verdict && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
          <span className="text-white/40">Stage grades (internal):</span>
          <span className={gradeColor(latencySnap.verdict.first_token_grade)}>
            first-useful {latencySnap.verdict.first_token_grade || 'n/a'}
          </span>
          <span className={gradeColor(latencySnap.verdict.full_answer_grade)}>
            full {latencySnap.verdict.full_answer_grade || 'n/a'}
          </span>
          <span className={gradeColor(latencySnap.verdict.stt_grade)}>
            stt {latencySnap.verdict.stt_grade || 'n/a'}
          </span>
          <span className="text-white/50">
            · {latencySnap.verdict.rank_vs_market || '—'} (
            {latencySnap.verdict.beat_real_world_count ?? 0}/
            {latencySnap.verdict.competitor_count ?? 0} beat real-world)
          </span>
        </div>
      )}

      {showBench && latencySnap?.comparison && (
        <div className="mt-3 max-h-48 overflow-auto rounded-[14px] border border-white/5">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[#0B0F17] text-white/40">
              <tr>
                <th className="px-3 py-2 font-medium">Tool</th>
                <th className="px-2 py-2 font-medium">Claimed</th>
                <th className="px-2 py-2 font-medium">User-reported</th>
                <th className="px-2 py-2 font-medium">Our p50</th>
                <th className="px-2 py-2 font-medium">Beat real?</th>
              </tr>
            </thead>
            <tbody>
              {latencySnap.comparison.map((row) => (
                <tr key={row.id} className="border-t border-white/5 text-white/70">
                  <td className="px-3 py-1.5">{row.label}</td>
                  <td className="px-2 py-1.5">
                    {row.their_claimed_ms != null ? `${row.their_claimed_ms}ms` : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.their_user_reported_ms != null
                      ? `${row.their_user_reported_ms}ms`
                      : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.our_p50_ms != null ? `${Math.round(row.our_p50_ms)}ms` : '—'}
                  </td>
                  <td
                    className={`px-2 py-1.5 ${
                      row.beat_their_real_world ? 'text-emerald-400' : 'text-white/40'
                    }`}
                  >
                    {row.our_p50_ms == null
                      ? 'need samples'
                      : row.beat_their_real_world
                        ? 'yes'
                        : 'no'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {latencySnap.verdict?.tips?.[0] && (
            <p className="border-t border-white/5 px-3 py-2 text-[11px] text-white/40">
              Tip: {latencySnap.verdict.tips[0]}
            </p>
          )}
        </div>
      )}

      {metrics?.source && (
        <p className="mt-3 text-[11px] text-white/30">
          Last source: {metrics.source}
          {metrics.depth ? ` · depth ${metrics.depth}` : ''}
          {latencySnap?.sample_count != null ? ` · ${latencySnap.sample_count} samples` : ''}
        </p>
      )}
      {!metrics && !latencySnap && (
        <p className="mt-3 text-[12px] text-white/35">
          Run an answer in Interview to populate timings. Benchmark refreshes every 12s when the API
          is up.
        </p>
      )}
    </section>
  )
}
