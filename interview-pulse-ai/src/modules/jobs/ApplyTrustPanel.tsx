/**
 * Trust UI — every apply attempt is one of: filled | submitted | manual | skipped + reason.
 * Consensus requirement from multi-org review (Anthropic honesty / Google clarity).
 */

import { cn } from '@/lib/utils'
import {
  formatFormPackMatch,
  kitMatchTone,
  type OneClickResult,
} from '@/services/jobsearch'
import { CheckCircle2, CircleDashed, ExternalLink, Hand, XCircle } from 'lucide-react'

export type TrustStatus = 'submitted' | 'filled' | 'manual' | 'skipped' | 'error'

export type TrustRow = {
  id: string
  title: string
  company?: string
  status: TrustStatus
  reason: string
  url?: string
  ats?: string
  packHint?: string
}

function normalizeRow(r: NonNullable<NonNullable<OneClickResult['browser']>['results']>[number], i: number): TrustRow {
  const st = String(r.status || '').toLowerCase()
  const detail = r.error || st || 'unknown'
  let status: TrustStatus = 'skipped'
  let reason = detail

  // Explicit product-truth statuses first (before filled_fields heuristics)
  if (st === 'duplicate' || st === 'skipped_duplicate') {
    status = 'skipped'
    reason = r.error || 'Duplicate URL — already counted recently'
  } else if (st === 'submit_quality_rejected' || st === 'filled_submit_failed') {
    status = 'error'
    reason =
      r.error ||
      'Submit clicked but fill too thin — not counted as submitted'
  } else if (st === 'submit_click_failed') {
    status = 'error'
    reason = r.error || 'Filled form but submit control not found'
  } else if (r.submitted || st === 'submitted') {
    status = 'submitted'
    reason = 'Form filled and Submit clicked (lab: not employer confirmation)'
  } else if (st === 'opened_manual' || st === 'manual' || st === 'opened') {
    status = 'manual'
    reason = r.error || 'Opened for you (login / CAPTCHA / custom ATS)'
  } else if (st === 'filled' || (r.filled_fields && r.filled_fields.length > 0 && !r.submitted)) {
    status = 'filled'
    reason =
      r.error ||
      (r.filled_fields?.length
        ? `Filled ${r.filled_fields.length} field(s) — not submitted`
        : 'Form filled — not submitted')
  } else if (st.includes('error') || st.includes('fail')) {
    status = 'error'
    reason = r.error || st
  } else if (st.includes('skip') || st.includes('no_url') || st === 'skipped_no_url') {
    status = 'skipped'
    reason = r.error || st.replace(/_/g, ' ')
  } else if (st) {
    status = 'skipped'
    reason = st.replace(/_/g, ' ')
  }

  const pack = formatFormPackMatch(r.form_pack_match)
  const tone = kitMatchTone(r.form_pack_match)
  if (tone === 'soft' && r.form_pack_match) {
    // keep reason primary; packHint shows soft
  }

  return {
    id: String(r.job_id || i),
    title: r.title || r.url || 'Role',
    company: r.company,
    status,
    reason,
    url: r.url,
    ats: r.ats,
    packHint: pack || undefined,
  }
}

const STATUS_META: Record<
  TrustStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  submitted: {
    label: 'Submitted',
    className: 'bg-[#81c995]/15 text-[#81c995] border-[#81c995]/30',
    Icon: CheckCircle2,
  },
  filled: {
    label: 'Filled',
    className: 'bg-[#8ab4f8]/15 text-[#8ab4f8] border-[#8ab4f8]/30',
    Icon: CheckCircle2,
  },
  manual: {
    label: 'Manual',
    className: 'bg-[#fdd663]/15 text-[#fdd663] border-[#fdd663]/30',
    Icon: Hand,
  },
  skipped: {
    label: 'Skipped',
    className: 'bg-white/[0.06] text-[#9aa0a6] border-white/[0.08]',
    Icon: CircleDashed,
  },
  error: {
    label: 'Error',
    className: 'bg-[#f28b82]/15 text-[#f28b82] border-[#f28b82]/30',
    Icon: XCircle,
  },
}

export function trustRowsFromOneClick(res: OneClickResult | null | undefined): TrustRow[] {
  if (!res?.browser?.results?.length) return []
  return res.browser.results.map((r, i) => normalizeRow(r, i))
}

export function ApplyTrustPanel({
  res,
  rows: rowsProp,
  title = 'Apply results',
  honesty,
}: {
  res?: OneClickResult | null
  rows?: TrustRow[]
  title?: string
  honesty?: string
}) {
  const rows = rowsProp ?? trustRowsFromOneClick(res)
  if (!rows.length && !res) return null

  const counts = {
    submitted: rows.filter((r) => r.status === 'submitted').length,
    filled: rows.filter((r) => r.status === 'filled').length,
    manual: rows.filter((r) => r.status === 'manual').length,
    skipped: rows.filter((r) => r.status === 'skipped' || r.status === 'error').length,
  }

  return (
    <div
      id="apply-results"
      className="jobs-command overflow-hidden"
      data-testid="apply-trust-panel"
    >
      <div className="border-b border-[rgba(232,234,237,0.1)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-medium text-[#e8eaed]">{title}</h3>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-lg bg-[#81c995]/12 px-2 py-0.5 text-[#81c995]">
              {counts.submitted} submitted
            </span>
            <span className="rounded-lg bg-[#8ab4f8]/12 px-2 py-0.5 text-[#8ab4f8]">
              {counts.filled} filled
            </span>
            <span className="rounded-lg bg-[#fdd663]/12 px-2 py-0.5 text-[#fdd663]">
              {counts.manual} manual
            </span>
            <span className="rounded-lg bg-white/[0.06] px-2 py-0.5 text-[#9aa0a6]">
              {counts.skipped} skipped
            </span>
          </div>
        </div>
        <p className="mt-1 text-[12px] text-[#9aa0a6]">
          Each row is one real attempt — not a marketing count.
        </p>
      </div>

      {!rows.length ? (
        <div className="px-4 py-8 text-center text-[13px] text-[#9aa0a6]">
          No attempts yet. Run Apply on a shortlist to see trust rows here.
        </div>
      ) : (
        <ul className="max-h-80 divide-y divide-[rgba(232,234,237,0.08)] overflow-y-auto">
          {rows.map((row) => {
            const meta = STATUS_META[row.status]
            const Icon = meta.Icon
            return (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={cn(
                    'mt-0.5 inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium',
                    meta.className,
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[#e8eaed]">
                    {row.title}
                    {row.company ? (
                      <span className="font-normal text-[#9aa0a6]"> · {row.company}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-[#9aa0a6]">{row.reason}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#80868b]">
                    {row.ats && <span>ATS: {row.ats}</span>}
                    {row.packHint && <span className="text-[#8ab4f8]/90">{row.packHint}</span>}
                  </div>
                </div>
                {row.url && (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[#8ab4f8] hover:underline"
                    title="Open apply URL"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {(honesty || res?.honesty) && (
        <p className="border-t border-[rgba(232,234,237,0.08)] px-4 py-2.5 text-[11px] leading-relaxed text-[#80868b]">
          {honesty || res?.honesty}
        </p>
      )}
    </div>
  )
}
