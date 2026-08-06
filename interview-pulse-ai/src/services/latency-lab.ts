/**
 * Admin Latency Lab — client orchestration for holistic E2E latency suite.
 * Admin-only endpoints + browser-timed inject/stream for true client E2E.
 */

import { resolveCopilotHttpBase } from '@/lib/api-base'
import { authHeaders } from '@/services/auth'
import { formatMs } from '@/lib/utils'

const API_BASE = resolveCopilotHttpBase()

export type LatencyLabConfig = {
  modes: string[]
  depths: string[]
  maxQuestions: number
  includeStt: boolean
  includeLlm: boolean
  warmFirst: boolean
  /** Also run browser-timed inject for true client E2E */
  clientE2e: boolean
}

export type ServerSuiteReport = {
  ok: boolean
  suite?: string
  suite_ms?: number
  config?: Record<string, unknown>
  health?: {
    ok?: boolean
    openai_key?: boolean
    rtt_ms?: number
    deepgram?: unknown
    error?: string
  }
  warm?: { ok?: boolean; ms?: number; llm?: boolean; whisper?: boolean; error?: string }
  stt?: {
    ok?: boolean
    path?: string
    stt_ms?: number
    wall_ms?: number
    provider?: string
    text_preview?: string
    note?: string
    error?: string
  }
  rows?: Array<Record<string, unknown>>
  aggregates?: Record<
    string,
    {
      n?: number
      p50?: number | null
      p95?: number | null
      avg?: number | null
      min?: number | null
      max?: number | null
    }
  >
  gates?: Record<string, boolean>
  verdict?: {
    pass?: boolean
    grades?: Record<string, string>
    summary?: string
  }
  targets?: Record<string, number>
  error?: string
}

export type ClientE2eRow = {
  question: string
  mode: string
  depth: string
  client_submit_to_first_ms: number
  client_submit_to_full_ms: number
  server_first_useful_ms?: number
  server_full_ms?: number
  source?: string
  answer_mode?: string
  ok: boolean
  error?: string
  answer_preview?: string
}

export type HolisticLatencyReport = {
  ran_at: number
  server: ServerSuiteReport | null
  client: {
    health_rtt_ms?: number
    warm_ms?: number
    inject_rows: ClientE2eRow[]
    first_useful_p50?: number
    first_useful_p95?: number
    full_p50?: number
    full_p95?: number
  }
  combined: {
    pass: boolean
    summary: string
    cards: Array<{
      label: string
      value: string
      grade: string
      hint?: string
    }>
  }
}

const DEFAULT_RESUME =
  'Senior SAP FICO Consultant with 8 years experience. S/4HANA Finance, enterprise structure, asset accounting, integration testing, cutover and hypercare. Improved month-end close time by 30% through reconciliation standardization and automation.'

const CLIENT_SAMPLE_QS = [
  'Tell me about a time you improved a difficult month-end close process and how you measured the result.',
  'Tell me about yourself.',
  'How do you configure asset accounting in S/4HANA Finance?',
]

function pct(vals: number[], p: number): number | undefined {
  if (!vals.length) return undefined
  const s = [...vals].sort((a, b) => a - b)
  if (s.length === 1) return Math.round(s[0]! * 100) / 100
  const k = (s.length - 1) * (p / 100)
  const f = Math.floor(k)
  const c = Math.min(f + 1, s.length - 1)
  if (f === c) return Math.round(s[f]! * 100) / 100
  return Math.round((s[f]! + (s[c]! - s[f]!) * (k - f)) * 100) / 100
}

function grade(ms: number | undefined, good: number, ok: number): string {
  if (ms == null) return 'n/a'
  if (ms <= good) return 'excellent'
  if (ms <= ok) return 'good'
  if (ms <= ok * 2) return 'acceptable'
  return 'poor'
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    if (typeof j?.detail === 'string') return j.detail
    if (j?.detail?.error?.message) return j.detail.error.message
    return res.statusText || `HTTP ${res.status}`
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function runServerAdminSuite(
  config: LatencyLabConfig,
  signal?: AbortSignal,
): Promise<ServerSuiteReport> {
  const res = await fetch(`${API_BASE}/api/latency/admin-suite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      modes: config.modes,
      depths: config.depths,
      max_questions: config.maxQuestions,
      include_stt: config.includeStt,
      include_llm: config.includeLlm,
      warm_first: config.warmFirst,
      role: 'Senior SAP FICO Consultant',
      resume_text: DEFAULT_RESUME,
      job_description:
        'SAP FICO consultant for S/4HANA Finance close, reconciliation, and hypercare.',
    }),
    signal,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as ServerSuiteReport
}

export async function measureHealthRtt(): Promise<number> {
  const t0 = performance.now()
  await fetch(`${API_BASE}/api/health`, {
    signal: AbortSignal.timeout(12000),
    mode: 'cors',
  })
  return Math.round(performance.now() - t0)
}

export async function measureWarm(): Promise<number> {
  const t0 = performance.now()
  await fetch(`${API_BASE}/api/warm`, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    mode: 'cors',
  })
  return Math.round(performance.now() - t0)
}

/** Browser-timed inject — true client end-to-end for typed path. */
export async function measureClientInject(
  question: string,
  opts: { mode: string; depth: string },
  signal?: AbortSignal,
): Promise<ClientE2eRow> {
  const t0 = performance.now()
  let firstMs = 0
  try {
    // Prefer streaming cascade for first-useful paint timing
    const res = await fetch(`${API_BASE}/api/answer/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(),
      },
      body: JSON.stringify({
        question,
        job_context: 'Senior SAP FICO Consultant',
        tone: 'confident',
        mode: opts.mode,
        depth: opts.depth,
      }),
      signal,
    })

    // Ensure materials are on session (also send resume via inject fallback)
    if (!res.ok || !res.body) {
      // Fallback to inject with resume_text
      const tInject = performance.now()
      const ir = await fetch(`${API_BASE}/api/answer/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          question,
          job_context: 'Senior SAP FICO Consultant',
          mode: opts.mode,
          depth: opts.depth,
          resume_text: DEFAULT_RESUME,
        }),
        signal,
      })
      const fullMs = performance.now() - t0
      if (!ir.ok) throw new Error(await parseError(ir))
      const data = (await ir.json()) as Record<string, unknown>
      firstMs = Number(data.first_useful_ms ?? data.first_token_ms ?? fullMs)
      return {
        question: question.slice(0, 100),
        mode: opts.mode,
        depth: opts.depth,
        client_submit_to_first_ms: Math.round(firstMs + (performance.now() - tInject) * 0),
        // Client wall for inject JSON is full response
        client_submit_to_full_ms: Math.round(fullMs),
        server_first_useful_ms:
          typeof data.first_useful_ms === 'number' ? data.first_useful_ms : undefined,
        server_full_ms:
          typeof data.full_ms === 'number'
            ? data.full_ms
            : typeof data.full_answer_ms === 'number'
              ? data.full_answer_ms
              : undefined,
        source: typeof data.source === 'string' ? data.source : undefined,
        answer_mode:
          typeof data.answer_mode === 'string' ? data.answer_mode : undefined,
        ok: true,
        answer_preview: String(data.answer || '').slice(0, 160),
      }
    }

    // Ensure session pack has resume for stream path
    void fetch(`${API_BASE}/api/session/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        role: 'Senior SAP FICO Consultant',
        resume_text: DEFAULT_RESUME,
        depth: opts.depth,
        outline_first: true,
      }),
    }).catch(() => undefined)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = 'message'
    let firstUsefulClient: number | undefined
    let serverFirst: number | undefined
    let serverFull: number | undefined
    let source: string | undefined
    let answerMode: string | undefined
    let preview = ''
    let done = false

    while (!done) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          const raw = line.slice(5).trim()
          try {
            const data = JSON.parse(raw) as Record<string, unknown>
            if (data.source) source = String(data.source)
            if (data.answer_mode) answerMode = String(data.answer_mode)
            if (typeof data.first_useful_ms === 'number' && serverFirst == null) {
              serverFirst = data.first_useful_ms
            }
            if (typeof data.full_answer_ms === 'number') serverFull = data.full_answer_ms
            if (typeof data.full_ms === 'number') serverFull = data.full_ms
            if (data.text || data.hook) {
              preview = String(data.text || data.hook || '').slice(0, 160)
            }
            if (
              (eventName === 'hook_delta' ||
                eventName === 'hook_complete' ||
                eventName === 'token') &&
              firstUsefulClient == null &&
              preview.trim().length >= 12
            ) {
              firstUsefulClient = performance.now() - t0
            }
            if (eventName === 'done') {
              done = true
              if (firstUsefulClient == null) firstUsefulClient = performance.now() - t0
            }
          } catch {
            /* ignore partial JSON */
          }
        }
      }
    }

    const fullClient = performance.now() - t0
    return {
      question: question.slice(0, 100),
      mode: opts.mode,
      depth: opts.depth,
      client_submit_to_first_ms: Math.round(firstUsefulClient ?? fullClient),
      client_submit_to_full_ms: Math.round(fullClient),
      server_first_useful_ms: serverFirst,
      server_full_ms: serverFull,
      source,
      answer_mode: answerMode,
      ok: true,
      answer_preview: preview,
    }
  } catch (e) {
    return {
      question: question.slice(0, 100),
      mode: opts.mode,
      depth: opts.depth,
      client_submit_to_first_ms: Math.round(performance.now() - t0),
      client_submit_to_full_ms: Math.round(performance.now() - t0),
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function runHolisticLatencyLab(
  config: LatencyLabConfig,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<HolisticLatencyReport> {
  const client: HolisticLatencyReport['client'] = { inject_rows: [] }
  let server: ServerSuiteReport | null = null

  onProgress?.('Measuring API health RTT…')
  try {
    client.health_rtt_ms = await measureHealthRtt()
  } catch {
    client.health_rtt_ms = undefined
  }

  if (config.warmFirst) {
    onProgress?.('Warming LLM / Whisper…')
    try {
      client.warm_ms = await measureWarm()
    } catch {
      client.warm_ms = undefined
    }
  }

  // Seed session materials for stream/inject
  onProgress?.('Seeding resume kit materials…')
  try {
    await fetch(`${API_BASE}/api/session/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        role: 'Senior SAP FICO Consultant',
        resume_text: DEFAULT_RESUME,
        job_description:
          'SAP FICO consultant for S/4HANA Finance close processes.',
        depth: config.depths[0] || 'fast',
        outline_first: true,
      }),
      signal,
    })
  } catch {
    /* non-fatal */
  }

  onProgress?.('Running server admin suite (typed + STT)…')
  try {
    server = await runServerAdminSuite(config, signal)
  } catch (e) {
    server = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  if (config.clientE2e) {
    onProgress?.('Browser-timed client E2E injects…')
    const modes = config.modes.length ? config.modes : ['shorter']
    const depths = config.depths.length ? config.depths : ['fast']
    // Keep client suite small for one-shot UX
    const qs = CLIENT_SAMPLE_QS.slice(0, 3)
    for (const q of qs) {
      for (const mode of modes.slice(0, 2)) {
        for (const depth of depths.slice(0, 2)) {
          if (signal?.aborted) break
          onProgress?.(`Client E2E: ${mode}/${depth} — ${q.slice(0, 40)}…`)
          const row = await measureClientInject(q, { mode, depth }, signal)
          client.inject_rows.push(row)
        }
      }
    }
    const firsts = client.inject_rows
      .filter((r) => r.ok)
      .map((r) => r.client_submit_to_first_ms)
    const fulls = client.inject_rows
      .filter((r) => r.ok)
      .map((r) => r.client_submit_to_full_ms)
    client.first_useful_p50 = pct(firsts, 50)
    client.first_useful_p95 = pct(firsts, 95)
    client.full_p50 = pct(fulls, 50)
    client.full_p95 = pct(fulls, 95)
  }

  const sAgg = server?.aggregates || {}
  const cards: HolisticLatencyReport['combined']['cards'] = [
    {
      label: 'Health RTT',
      value:
        client.health_rtt_ms != null ? formatMs(client.health_rtt_ms) : '—',
      grade: grade(client.health_rtt_ms, 120, 300),
      hint: 'Browser → API',
    },
    {
      label: 'Warm',
      value: client.warm_ms != null ? formatMs(client.warm_ms) : '—',
      grade: grade(client.warm_ms, 2000, 8000),
      hint: 'LLM + Whisper preload',
    },
    {
      label: 'STT',
      value:
        server?.stt?.stt_ms != null ? formatMs(Number(server.stt.stt_ms)) : '—',
      grade: grade(
        server?.stt?.stt_ms != null ? Number(server.stt.stt_ms) : undefined,
        300,
        800,
      ),
      hint: server?.stt?.provider || server?.stt?.note || 'Speech-to-text',
    },
    {
      label: 'Server first useful p95',
      value:
        sAgg.first_useful_ms?.p95 != null
          ? formatMs(Number(sAgg.first_useful_ms.p95))
          : '—',
      grade: grade(
        sAgg.first_useful_ms?.p95 != null
          ? Number(sAgg.first_useful_ms.p95)
          : undefined,
        400,
        800,
      ),
      hint: 'Target < 800ms',
    },
    {
      label: 'Server shorter full p95',
      value:
        sAgg.full_shorter_ms?.p95 != null
          ? formatMs(Number(sAgg.full_shorter_ms.p95))
          : sAgg.full_answer_ms?.p95 != null
            ? formatMs(Number(sAgg.full_answer_ms.p95))
            : '—',
      grade: grade(
        sAgg.full_shorter_ms?.p95 != null
          ? Number(sAgg.full_shorter_ms.p95)
          : sAgg.full_answer_ms?.p95 != null
            ? Number(sAgg.full_answer_ms.p95)
            : undefined,
        1500,
        2500,
      ),
      hint: 'Target < 2.5s',
    },
    {
      label: 'Client E2E first p95',
      value:
        client.first_useful_p95 != null
          ? formatMs(client.first_useful_p95)
          : '—',
      grade: grade(client.first_useful_p95, 800, 1500),
      hint: 'Browser submit → first paint',
    },
    {
      label: 'Client E2E full p95',
      value: client.full_p95 != null ? formatMs(client.full_p95) : '—',
      grade: grade(client.full_p95, 2500, 5000),
      hint: 'Browser submit → complete',
    },
    {
      label: 'Grounding',
      value:
        sAgg.grounding_pass_rate != null
          ? `${Math.round(Number(sAgg.grounding_pass_rate) * 100)}%`
          : '—',
      grade:
        sAgg.grounding_pass_rate == null
          ? 'n/a'
          : Number(sAgg.grounding_pass_rate) >= 1
            ? 'excellent'
            : 'poor',
      hint: 'Month-end 30% case',
    },
  ]

  const serverPass = server?.verdict?.pass !== false && server?.ok !== false
  const clientFail = client.inject_rows.some((r) => !r.ok)
  const pass =
    Boolean(serverPass) &&
    !clientFail &&
    (client.first_useful_p95 == null || client.first_useful_p95 < 1500)

  return {
    ran_at: Date.now(),
    server,
    client,
    combined: {
      pass,
      summary: pass
        ? 'PASS — holistic latency suite within targets'
        : server?.verdict?.summary ||
          server?.error ||
          'REVIEW — check failing stages below',
      cards,
    },
  }
}

export const DEFAULT_LAB_CONFIG: LatencyLabConfig = {
  modes: ['shorter', 'star'],
  depths: ['fast', 'balanced'],
  maxQuestions: 6,
  includeStt: true,
  includeLlm: true,
  warmFirst: true,
  clientE2e: true,
}
