/**
 * Lab ATS success metrics — north-star KPI dashboard (local JSON via API).
 */

import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  fetchApplyMetrics,
  resetApplyMetrics,
  type ApplyMetricsSnapshot,
} from '@/services/jobsearch-metrics'

export function ApplyMetricsPage() {
  const [data, setData] = useState<ApplyMetricsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    setBusy(true)
    setErr(null)
    try {
      const m = await fetchApplyMetrics()
      if (!m.ok) {
        setErr(m.error || 'Failed to load metrics')
        return
      }
      setData(m)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const totals = data?.totals || {}
  const kpi = data?.kpi
  const byAts = Object.entries(data?.by_ats || {}).sort(
    (a, b) => (b[1]?.n || 0) - (a[1]?.n || 0),
  )

  return (
    <div className="jobs-result-enter flex flex-col gap-4" data-testid="apply-metrics">
      <div className="jobs-command p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-medium text-[#e8eaed]">Apply metrics</h2>
            <p className="mt-1 text-[13px] text-[#9aa0a6]">
              Lab KPI — filled + submitted counts by ATS (localhost JSON).
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Reset all lab apply metrics?')) return
                await resetApplyMetrics()
                await load()
              }}
            >
              <Trash2 className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>

        {err && (
          <div className="mt-4 rounded-xl border border-[#f28b82]/30 bg-[#f28b82]/10 px-3 py-2 text-[13px] text-[#f28b82]">
            {err}
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="North star"
            value={String(kpi?.value ?? 0)}
            hint="Filled + submitted"
          />
          <KpiCard
            label="This week (lab)"
            value={String(
              data?.applications_completed_this_week ?? kpi?.weekly_completed ?? 0,
            )}
            hint={`Submit clicks · ${kpi?.week || 'week'} · not employer confirmation`}
          />
          <KpiCard label="Attempts" value={String(totals.attempts ?? 0)} hint="All outcomes" />
          <KpiCard
            label="Submit rate"
            value={`${Math.round((data?.rates?.submit_rate || 0) * 100)}%`}
            hint="Submitted / attempts"
          />
          <KpiCard
            label="Fill p50 / p95"
            value={
              data?.latency_ms?.p50 != null
                ? `${Math.round(data.latency_ms.p50)} / ${Math.round(data.latency_ms.p95 ?? 0)}ms`
                : '—'
            }
            hint="Browser fill latency samples"
          />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Mini count={totals.submitted} label="Submitted" tone="green" />
          <Mini count={totals.filled} label="Filled" tone="blue" />
          <Mini count={totals.manual} label="Manual" tone="amber" />
          <Mini
            count={(totals.skipped || 0) + (totals.error || 0)}
            label="Skipped / error"
            tone="muted"
          />
        </div>
      </div>

      <div className="jobs-command overflow-hidden">
        <div className="border-b border-[rgba(232,234,237,0.1)] px-4 py-3 text-[14px] font-medium text-[#e8eaed]">
          By ATS
        </div>
        {!byAts.length ? (
          <p className="px-4 py-8 text-center text-[13px] text-[#9aa0a6]">
            No attempts recorded yet. Run Apply — outcomes write here automatically.
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-[#80868b]">
              <tr className="border-b border-[rgba(232,234,237,0.08)]">
                <th className="px-4 py-2 font-medium">ATS</th>
                <th className="px-2 py-2 font-medium">N</th>
                <th className="px-2 py-2 font-medium">Sub</th>
                <th className="px-2 py-2 font-medium">Fill</th>
                <th className="px-2 py-2 font-medium">Manual</th>
                <th className="px-2 py-2 font-medium">Skip</th>
              </tr>
            </thead>
            <tbody>
              {byAts.map(([ats, c]) => (
                <tr
                  key={ats}
                  className="border-b border-[rgba(232,234,237,0.06)] text-[#e8eaed]"
                >
                  <td className="px-4 py-2 font-medium">{ats}</td>
                  <td className="px-2 py-2 tabular-nums text-[#9aa0a6]">{c.n}</td>
                  <td className="px-2 py-2 tabular-nums text-[#81c995]">{c.submitted}</td>
                  <td className="px-2 py-2 tabular-nums text-[#8ab4f8]">{c.filled}</td>
                  <td className="px-2 py-2 tabular-nums text-[#fdd663]">{c.manual}</td>
                  <td className="px-2 py-2 tabular-nums text-[#9aa0a6]">
                    {(c.skipped || 0) + (c.error || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!!data?.recent?.length && (
        <div className="jobs-command overflow-hidden">
          <div className="border-b border-[rgba(232,234,237,0.1)] px-4 py-3 text-[14px] font-medium">
            Recent attempts
          </div>
          <ul className="max-h-64 divide-y divide-[rgba(232,234,237,0.06)] overflow-y-auto">
            {data.recent.map((r, i) => (
              <li key={i} className="px-4 py-2.5 text-[12px]">
                <span className="font-medium text-[#e8eaed]">{r.status}</span>
                <span className="text-[#80868b]"> · {r.ats}</span>
                {r.title && (
                  <span className="text-[#9aa0a6]"> · {r.title}</span>
                )}
                {r.reason && (
                  <p className="mt-0.5 text-[#80868b]">{r.reason}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data?.path && (
        <p className="text-[11px] text-[#80868b]">
          Lab file: <code className="text-[#9aa0a6]">{data.path}</code>
        </p>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-xl border border-[rgba(232,234,237,0.1)] bg-[#282a2c] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#80868b]">
        {label}
      </p>
      <p className="mt-1 text-[28px] font-medium tabular-nums text-[#e8eaed]">{value}</p>
      <p className="text-[12px] text-[#9aa0a6]">{hint}</p>
    </div>
  )
}

function Mini({
  count,
  label,
  tone,
}: {
  count?: number
  label: string
  tone: 'green' | 'blue' | 'amber' | 'muted'
}) {
  const c =
    tone === 'green'
      ? 'text-[#81c995]'
      : tone === 'blue'
        ? 'text-[#8ab4f8]'
        : tone === 'amber'
          ? 'text-[#fdd663]'
          : 'text-[#9aa0a6]'
  return (
    <div className="rounded-xl border border-[rgba(232,234,237,0.08)] px-3 py-2">
      <p className={`text-[20px] font-medium tabular-nums ${c}`}>{count ?? 0}</p>
      <p className="text-[11px] text-[#80868b]">{label}</p>
    </div>
  )
}

