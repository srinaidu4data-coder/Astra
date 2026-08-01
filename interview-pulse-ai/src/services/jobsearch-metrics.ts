/** Lab apply metrics client — KPI dashboard. */

import { resolveCopilotHttpBase } from '@/lib/api-base'

function apiBase(): string {
  return resolveCopilotHttpBase()
}

export function apiUrl(path: string): string {
  const base = apiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

export type ApplyMetricsSnapshot = {
  ok: boolean
  error?: string
  version?: string
  totals?: {
    submitted?: number
    filled?: number
    manual?: number
    skipped?: number
    error?: number
    attempts?: number
  }
  rates?: {
    submit_rate?: number
    fill_rate?: number
    manual_rate?: number
  }
  by_ats?: Record<
    string,
    {
      n?: number
      submitted?: number
      filled?: number
      manual?: number
      skipped?: number
      error?: number
    }
  >
  recent?: Array<{
    status?: string
    ats?: string
    title?: string
    reason?: string
    iso?: string
  }>
  kpi?: {
    north_star?: string
    definition?: string
    value?: number
    attempts?: number
    weekly_completed?: number
    week?: string
  }
  latency_ms?: { n?: number; p50?: number | null; p95?: number | null }
  applications_completed_this_week?: number
  weekly_submitted?: Record<string, number>
  audit_path?: string
  path?: string
  updated_at?: string
  request_id?: string
}

export async function fetchApplyMetrics(): Promise<ApplyMetricsSnapshot> {
  try {
    const res = await fetch(apiUrl('/api/jobsearch/apply/metrics'), {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function resetApplyMetrics(): Promise<ApplyMetricsSnapshot> {
  try {
    const res = await fetch(apiUrl('/api/jobsearch/apply/metrics/reset'), {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return res.json()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
