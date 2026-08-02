import { ApiStatusBadge } from '@/components/ApiStatusBadge'
import { LiveWaveform } from '@/components/LiveWaveform'
import { WhisperStream } from '@/components/WhisperStream'
import { Button } from '@/components/ui/button'
import { openAnswerPopout } from '@/lib/answer-popout'
import { formatMs } from '@/lib/utils'
import { liveInterview } from '@/services/live-interview'
import { pipeline } from '@/services/pipeline'
import {
  checkCopilotHealth,
  fetchAnswer,
  fetchLatencyMetrics,
  getSessionContext,
  setSessionContext,
  warmCopilotApi,
} from '@/services/real-api'
import { useAppStore } from '@/stores/app-store'
import type { AnswerMode, LatencySnapshot, QACard } from '@/types'
import {
  MicOff,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Volume2,
} from 'lucide-react'
import {
  resolveInterviewAudioSource,
  type InterviewAudioSource,
} from '@/lib/api-base'
import { useCallback, useEffect, useRef, useState } from 'react'

function gradeColor(grade?: string) {
  if (grade === 'excellent') return 'text-emerald-400'
  if (grade === 'good') return 'text-[#20B8CD]'
  if (grade === 'acceptable') return 'text-[#E8C547]'
  if (grade === 'poor') return 'text-rose-400'
  return 'text-white/70'
}

/**
 * Real interview UX:
 * - One big Listen button stays ON for the whole interview
 * - Speakers / tab / system loopback only by default (not mic)
 * - Candidate answers are NOT transcribed — same model as Final Round / Cluely
 * - Filters chatter, answers only interviewer questions
 * - Answers queue; you step with Next when ready
 */
export function CopilotPage() {
  // Granular selectors — NEVER subscribe to the whole store (levels thrash was
  // re-rendering the answer panel ~10×/s and looked like constant flicker).
  const setLevels = useAppStore((s) => s.setLevels)
  const answerMode = useAppStore((s) => s.answerMode)
  const setAnswerMode = useAppStore((s) => s.setAnswerMode)
  const metrics = useAppStore((s) => s.metrics)
  const setMetrics = useAppStore((s) => s.setMetrics)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const activeJobTitle = useAppStore((s) => s.activeJobTitle)
  const setActiveJobTitle = useAppStore((s) => s.setActiveJobTitle)
  const clearTranscript = useAppStore((s) => s.clearTranscript)
  const pushTranscript = useAppStore((s) => s.pushTranscript)
  const setListening = useAppStore((s) => s.setListening)
  const setAnswer = useAppStore((s) => s.setAnswer)
  const transcript = useAppStore((s) => s.transcript)
  const user = useAppStore((s) => s.user)

  const cardIndexRef = useRef(0)
  const lastLevelAt = useRef(0)
  const lastLevelValue = useRef(0)
  const lastPartialAt = useRef(0)
  const lastStatusAt = useRef(0)
  const lastStatusMsg = useRef('')
  const [apiOk, setApiOk] = useState(false)
  const [sessionOn, setSessionOn] = useState(false)
  const [device, setDevice] = useState('')
  const [phase, setPhase] = useState('idle')
  /** Single stable status line (fixed height) — avoids layout jump */
  const [statusLine, setStatusLine] = useState('')
  const [statusLog, setStatusLog] = useState<string[]>([])
  const [cards, setCards] = useState<QACard[]>([])
  const [cardIndex, setCardIndex] = useState(0)
  const [regenerating, setRegenerating] = useState(false)
  const [manualQ, setManualQ] = useState('')
  const [answering, setAnswering] = useState(false)
  const [depth, setDepth] = useState<'fast' | 'balanced' | 'deep'>('balanced')
  const [latencySnap, setLatencySnap] = useState<LatencySnapshot | null>(null)
  const [showBench, setShowBench] = useState(false)
  /** Hide left controls — full-bleed answer (store drives shell + sidebar) */
  const leftCollapsed = useAppStore((s) => s.copilotWideAnswer)
  const setCopilotWideAnswer = useAppStore((s) => s.setCopilotWideAnswer)
  const toggleLeftPanel = useCallback(() => {
    setCopilotWideAnswer(!leftCollapsed)
  }, [leftCollapsed, setCopilotWideAnswer])
  /** In-app expand: answer fills the viewport over chrome */
  const [answerExpanded, setAnswerExpanded] = useState(false)
  const [detaching, setDetaching] = useState(false)

  const toggleAnswerExpand = useCallback(() => {
    setAnswerExpanded((v) => !v)
  }, [])

  const handleDetachAnswer = useCallback(async () => {
    setDetaching(true)
    try {
      const res = await openAnswerPopout()
      if (!res.ok) {
        window.alert(res.message || 'Could not open detached answer window.')
      }
    } finally {
      setDetaching(false)
    }
  }, [])

  // Esc exits in-app expand
  useEffect(() => {
    if (!answerExpanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnswerExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answerExpanded])

  const pushStatus = useCallback((msg: string) => {
    if (!msg) return
    const now = Date.now()
    // "Hearing…" partials: update line only, never log list (was major flicker)
    if (msg.startsWith('Hearing')) {
      if (now - lastPartialAt.current < 500) return
      lastPartialAt.current = now
      setStatusLine(msg)
      return
    }
    if (msg === lastStatusMsg.current && now - lastStatusAt.current < 1000) return
    if (now - lastStatusAt.current < 250) return
    lastStatusMsg.current = msg
    lastStatusAt.current = now
    setStatusLine(msg)
    setStatusLog((prev) => {
      if (prev[0] === msg) return prev
      return [msg, ...prev].slice(0, 8)
    })
  }, [])

  const pushCard = useCallback(
    (card: QACard) => {
      // Always jump to the newest answer so the panel doesn't sit blank
      setCards((prev) => {
        const next = [...prev, card]
        const idx = next.length - 1
        cardIndexRef.current = idx
        setCardIndex(idx)
        return next
      })
      setAnswer(card.answer)
    },
    [setAnswer],
  )

  const showPending = useCallback(
    (question: string) => {
      const pending: QACard = {
        id: `pending_${Date.now()}`,
        question,
        answer: {
          id: `pending_${Date.now()}`,
          mode: answerMode,
          bullets: ['Writing your answer…'],
          metrics: [],
          streaming: true,
          question,
        },
      }
      setCards((prev) => {
        const next = [...prev, pending]
        const idx = next.length - 1
        cardIndexRef.current = idx
        setCardIndex(idx)
        return next
      })
      setAnswer(pending.answer)
    },
    [answerMode, setAnswer],
  )

  const updateCardIndex = (i: number) => {
    cardIndexRef.current = i
    setCardIndex(i)
  }

  useEffect(() => {
    const c = cards[cardIndex]
    if (c) setAnswer(c.answer)
  }, [cards, cardIndex, setAnswer])

  // Audit P1: pull server JD bootstrap role into Job context when empty
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await getSessionContext()
      if (cancelled || !data?.pack) return
      const role = (data.pack.role || '').trim()
      if (!role) return
      const jc = (useAppStore.getState().settings.jobContext || '').trim()
      const title = (useAppStore.getState().activeJobTitle || '').trim()
      if (!jc) {
        updateSettings({ jobContext: role })
      }
      if (!title) {
        setActiveJobTitle(role)
      }
      // Keep server pack warm with UI role
      void setSessionContext({
        role: jc || role,
        job_description: data.pack.job_description,
        resume_text: data.pack.resume_text,
        keywords: data.pack.keywords,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [updateSettings, setActiveJobTitle])

  // Wire live WebSocket for the lifetime of this page
  useEffect(() => {
    liveInterview.connect({
      onConnection: (s) => {
        setApiOk((prev) => {
          const next = s === 'open'
          return prev === next ? prev : next
        })
        if (s === 'open') pushStatus('Backend connected')
        if (s === 'closed') {
          setApiOk(false)
          setSessionOn(false)
          setListening(false)
        }
      },
      onStatus: (msg, listening) => {
        // Skip pure "still listening" spam that only flips listening flags
        if (msg && !/still listening|already listening/i.test(msg)) {
          pushStatus(msg)
        }
        if (typeof listening === 'boolean') {
          setSessionOn((prev) => (prev === listening ? prev : listening))
          setListening(listening)
        }
      },
      onListening: (active, dev) => {
        setSessionOn((prev) => (prev === active ? prev : active))
        setListening(active)
        if (dev) setDevice((d) => (d === dev ? d : dev))
        if (!active) setPhase((p) => (p === 'idle' ? p : 'idle'))
      },
      onLevel: (level, state) => {
        const now = Date.now()
        // ~4 fps — enough for activity, not enough to flash the UI
        if (now - lastLevelAt.current < 220) return
        // Ignore tiny jitter (noise floor wiggle)
        if (Math.abs(level - lastLevelValue.current) < 0.012 && now - lastLevelAt.current < 400) {
          return
        }
        lastLevelAt.current = now
        lastLevelValue.current = level
        if (state) setPhase((p) => (p === state ? p : state))
        // 16 bars, smooth shape from level only
        const bars = Array.from({ length: 16 }, (_, i) => {
          const wave = 0.1 * Math.sin(i * 0.7 + level * 6)
          return Math.min(1, Math.max(0.05, level * 2.4 + wave * level))
        })
        setLevels(bars)
      },
      onTranscript: (text) => {
        pushTranscript({
          id: `tr_${Date.now()}`,
          role: 'interviewer',
          text,
          ts: Date.now(),
          final: true,
        })
        pushStatus(`Heard: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`)
      },
      onTranscriptPartial: (text) => {
        if (!text?.trim()) return
        pushStatus(`Hearing… ${text.slice(0, 90)}${text.length > 90 ? '…' : ''}`)
        setPhase((p) => (p === 'hearing' ? p : 'hearing'))
      },
      onAnswerPending: (question) => {
        pushStatus(`Writing answer for: ${question.slice(0, 60)}…`)
        setPhase('processing')
        showPending(question)
      },
      onChatter: (text, reason) => {
        pushStatus(`Filtered (${reason || 'chatter'}): ${text.slice(0, 60)}…`)
      },
      onMetrics: (m) => {
        // Only final / meaningful metric updates — skip identical totals
        setMetrics(m)
      },
      onAnswer: (ans) => {
        const q = (ans.question || 'Interview question').trim()
        setCards((prev) => {
          const next = [...prev]
          let idx = next.findIndex((c) => c.id === ans.id)
          const qNorm = q.toLowerCase()
          if (idx < 0) {
            for (let i = next.length - 1; i >= 0; i--) {
              const cq = (next[i]?.question || '').trim().toLowerCase()
              if (
                cq &&
                (cq === qNorm ||
                  qNorm.includes(cq.slice(0, 40)) ||
                  cq.includes(qNorm.slice(0, 40)))
              ) {
                idx = i
                break
              }
              if (next[i]?.answer?.streaming) {
                idx = i
                break
              }
            }
          }
          const card: QACard = {
            id: idx >= 0 ? next[idx]!.id : ans.id,
            question: q,
            answer: { ...ans, id: idx >= 0 ? next[idx]!.id : ans.id },
          }
          if (idx >= 0) {
            const prevText = next[idx]?.answer?.bullets?.join('\n') || ''
            const nextText = card.answer.bullets?.join('\n') || ''
            // Streaming: require meaningful growth to avoid token-by-token flash
            if (ans.streaming) {
              if (nextText.length - prevText.length < 24 && prevText.length > 0) {
                return prev
              }
            } else if (
              prevText === nextText &&
              next[idx]?.answer?.streaming === card.answer.streaming
            ) {
              return prev
            }
            next[idx] = card
          } else {
            next.push(card)
            idx = next.length - 1
          }
          if (cardIndexRef.current !== idx) {
            cardIndexRef.current = idx
            setCardIndex(idx)
          }
          return next
        })
        // Overlay answer: only on final or first paint of stream (not every chunk)
        if (!ans.streaming) {
          setAnswer(ans)
        } else {
          const bullets = ans.bullets?.join('\n') || ''
          if (bullets.length < 80 || bullets.length % 120 < 30) {
            setAnswer(ans)
          }
        }
        if (!ans.streaming && ans.latencyMs != null) {
          setMetrics({
            vadMs: 0,
            sttMs: 0,
            firstTokenMs: ans.latencyMs,
            totalMs: ans.latencyMs,
            lastUpdated: Date.now(),
          })
        }
        if (!ans.streaming) {
          setPhase('listening')
          pushStatus('Answer ready — still listening')
          void fetchLatencyMetrics().then((s) => {
            if (s) setLatencySnap(s)
          })
        }
      },
      onError: (msg) => {
        pushStatus(`Error: ${msg}`)
        if (/not connected|websocket not open|backend connection closed|failed to fetch/i.test(msg)) {
          setApiOk(false)
        }
      },
    })

    void warmCopilotApi()

    // Probe HTTP health + WS less often (10s) — badge also polls
    const ping = () => {
      void checkCopilotHealth().then((h) => {
        if (h.ok) {
          setApiOk((prev) => (prev === true ? prev : true))
        } else if (!liveInterview.connected) {
          setApiOk((prev) => (prev === false ? prev : false))
        }
      })
      void liveInterview
        .ensureOpen()
        .then(() => setApiOk((prev) => (prev ? prev : true)))
        .catch(() => {
          /* health poll handles message */
        })
    }
    ping()
    const id = window.setInterval(ping, 12000)

    return () => {
      window.clearInterval(id)
      // Only stop audio session; keep socket for reconnect after StrictMode
      liveInterview.stop()
      setListening(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSession = async () => {
    if (sessionOn) {
      liveInterview.stop()
      setSessionOn(false)
      setListening(false)
      setPhase('idle')
      setLevels(Array.from({ length: 16 }, () => 0.08))
      pushStatus('Interview session stopped')
      return
    }

    try {
      const rawSource = settings.audioSource || 'auto'
      const audioMode: InterviewAudioSource =
        rawSource === 'auto' || !rawSource
          ? resolveInterviewAudioSource()
          : (rawSource as InterviewAudioSource)
      const modeHint =
        audioMode === 'system'
          ? 'PC speakers (Stereo Mix / loopback)'
          : audioMode === 'mic'
            ? '⚠ microphone (your answers may be transcribed)'
            : 'shared tab / system audio'
      pushStatus(
        `Starting interview — ${modeHint}. Prefer speakers so only the interviewer is heard…`,
      )
      await liveInterview.start({
        jobContext: settings.jobContext || activeJobTitle,
        tone: settings.tone,
        mode: answerMode,
        // Speakers / loopback only unless Settings explicitly set mic
        audioMode,
        // Admin-assigned models (null → server defaults)
        userAnswerModel: user?.answer_model ?? user?.effective_answer_model ?? null,
        userFallbackModel:
          user?.fallback_model ?? user?.effective_fallback_model ?? null,
        deepgramKey: settings.deepgramKey || null,
        sttProvider: settings.deepgramKey ? 'deepgram' : 'auto',
      })
      setSessionOn(true)
      setListening(true)
      setApiOk(true)
      setDevice(audioMode === 'mic' ? 'microphone' : 'speakers')
      pushStatus(
        audioMode === 'mic'
          ? '⚠ Mic mode on — switch to Speakers in Settings so your answers are not transcribed'
          : settings.deepgramKey
            ? 'Listening to speakers/tab audio · Deepgram Nova-3 · your mic is off'
            : 'Listening to speakers/tab audio · your mic is off',
      )
    } catch (e) {
      const msg = (e as Error).message || 'Could not start'
      pushStatus(`Could not start: ${msg}`)
      setSessionOn(false)
      setListening(false)
      const offline = /not connected|websocket|failed to fetch|network/i.test(msg)
      if (offline) setApiOk(false)
      window.alert(
        `Cannot start interview.\n\n${msg}\n\n` +
          `Tips:\n` +
          `• Share the Teams/Zoom tab with "Share tab audio" (or system audio)\n` +
          `• Local Windows: enable Stereo Mix / use Speakers mode (Settings)\n` +
          `• Do NOT use mic mode — your answers would be transcribed\n` +
          `• On this website the API should be api.jobinterviewcracker.com\n` +
          `• Local only: cd src && python copilot_api.py`,
      )
    }
  }

  const handleModeChange = async (mode: AnswerMode) => {
    setAnswerMode(mode)
    liveInterview.setMode(mode)

    const idx = cardIndexRef.current
    const current = cards[idx]
    if (!current?.question || !apiOk) {
      pushStatus(`Format → ${mode}`)
      return
    }

    setRegenerating(true)
    try {
      pushStatus(`Rewriting as ${mode}…`)
      const ans = await fetchAnswer(current.question, {
        jobContext: settings.jobContext || activeJobTitle,
        tone: settings.tone,
        mode,
      })
      const card: QACard = {
        id: ans.id,
        question: current.question,
        answer: { ...ans, question: current.question },
      }
      setCards((prev) => {
        const next = [...prev]
        next[idx] = card
        return next
      })
      setAnswer(card.answer)
      pushStatus(`Rewrote as ${mode}`)
    } catch (e) {
      pushStatus(`Rewrite failed: ${(e as Error).message}`)
    } finally {
      setRegenerating(false)
    }
  }

  const askManual = async () => {
    if (!manualQ.trim() || answering) return
    setAnswering(true)
    const q = manualQ.trim()
    pushTranscript({
      id: `tr_${Date.now()}`,
      role: 'interviewer',
      text: q,
      ts: Date.now(),
      final: true,
    })
    try {
      // Pre-load context pack so answers are resume/JD grounded (latency amortization)
      void setSessionContext({
        role: settings.jobContext || activeJobTitle || undefined,
        depth,
        outline_first: true,
      })
      if (apiOk && sessionOn && liveInterview.connected) {
        // Live session: inject skips STT (market pattern for lag fallback)
        showPending(q)
        liveInterview.injectQuestion(q, {
          depth,
          jobContext: settings.jobContext || activeJobTitle,
        })
        setManualQ('')
      } else if (apiOk) {
        const ans = await fetchAnswer(q, {
          jobContext: settings.jobContext || activeJobTitle,
          tone: settings.tone,
          mode: answerMode,
          depth,
        })
        pushCard({
          id: ans.id,
          question: q,
          answer: { ...ans, question: q },
        })
        if (ans.latencyMs != null) {
          const fullMs = (ans as { fullMs?: number }).fullMs
          setMetrics({
            vadMs: 0,
            sttMs: 0,
            firstTokenMs: ans.latencyMs,
            totalMs: ans.latencyMs,
            fullAnswerMs: fullMs,
            lastUpdated: Date.now(),
            source: (ans as { source?: string }).source,
            depth,
          })
        }
        void fetchLatencyMetrics().then((s) => {
          if (s) setLatencySnap(s)
        })
        setManualQ('')
      } else {
        // Local offline fallback so Answer never feels dead
        await pipeline.injectQuestion(q, {
          onAnswerDone: (ans) => {
            pushCard({
              id: ans.id,
              question: q,
              answer: { ...ans, question: q, streaming: false },
            })
          },
          onMetrics: setMetrics,
        })
        pushStatus('Answered offline (start copilot_api.py for live STT)')
      }
    } catch (e) {
      const msg = (e as Error).message
      pushStatus(`Answer failed: ${msg}`)
      window.alert(`Answer failed:\n${msg}`)
    } finally {
      setAnswering(false)
    }
  }

  // Poll latency snapshot for competitor board
  useEffect(() => {
    if (!apiOk) return
    const tick = () => {
      void fetchLatencyMetrics().then((s) => {
        if (s) setLatencySnap(s)
      })
    }
    tick()
    const id = window.setInterval(tick, 12000)
    return () => window.clearInterval(id)
  }, [apiOk])

  useEffect(() => {
    void setSessionContext({ depth, outline_first: true })
    if (liveInterview.connected) liveInterview.setDepth(depth)
  }, [depth])

  const phaseLabel =
    phase === 'hearing'
      ? 'Hearing speech…'
      : phase === 'processing'
        ? 'Transcribing / answering…'
        : sessionOn
          ? 'Listening'
          : 'Idle'

  return (
    <div className={leftCollapsed ? 'space-y-3' : 'space-y-5'}>
      {/* Loud offline / no-LLM banner — hidden when API + LLM are healthy */}
      {!leftCollapsed && <ApiStatusBadge variant="banner" />}

      {/* Always two siblings under one parent (no ternary root) — avoids oxc adjacent-JSX errors */}
      <div
        className={
          leftCollapsed
            ? 'relative min-h-[calc(100vh-5rem)] w-full max-w-none'
            : 'grid min-h-[calc(100vh-9rem)] gap-8 xl:grid-cols-12 xl:items-stretch xl:gap-10'
        }
      >
        {/* Floating controls when hidden — zero column width (overlays answer) */}
        {leftCollapsed && (
          <div className="pointer-events-none absolute left-2 top-2 z-30 flex items-center gap-1.5 sm:left-3 sm:top-3">
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/12 bg-[#141414]/92 p-1 shadow-lg backdrop-blur-md">
              <button
                type="button"
                onClick={toggleLeftPanel}
                title="Show controls"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 hover:bg-white/10 hover:text-white"
              >
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <span
                className={`mx-0.5 h-2 w-2 shrink-0 rounded-full ${
                  sessionOn
                    ? 'bg-[#20B8CD]'
                    : apiOk
                      ? 'bg-white/30'
                      : 'bg-[#E8C547]'
                }`}
                title={phaseLabel}
              />
              <button
                type="button"
                onClick={() => void toggleSession()}
                title={sessionOn ? 'Stop interview' : 'Start interview'}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${
                  sessionOn
                    ? 'border-rose-400/40 bg-rose-500/15 text-rose-100'
                    : 'border-[#20B8CD]/40 bg-[#20B8CD]/15 text-[#5DD5E3]'
                }`}
              >
                {sessionOn ? (
                  <MicOff className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Volume2 className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Full left controls — hidden (not unmounted via ternary) when collapsed */}
        <div
          className={
            leftCollapsed
              ? 'hidden'
              : 'flex flex-col gap-6 xl:col-span-4'
          }
        >
        <section className="glass rounded-[28px] p-6 md:p-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                Live interview
              </h2>
              <p className="text-[13px] leading-relaxed text-white/40">
                Stays on · filters chatter · answers questions only
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                type="button"
                onClick={toggleLeftPanel}
                title="Hide controls — expand answer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/55 hover:bg-white/[0.08] hover:text-white/80"
              >
                <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} />
                Hide
              </button>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      sessionOn
                        ? 'bg-[#20B8CD]'
                        : apiOk
                          ? 'bg-white/30'
                          : 'bg-[#E8C547]'
                    }`}
                  />
                  <span className="text-[12px] text-white/50">{phaseLabel}</span>
                </div>
                {device && (
                  <p className="mt-1 max-w-[200px] truncate text-[11px] text-white/30">
                    {device}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mb-8 rounded-[22px] glass-inset px-6 py-8">
            {/* Isolated levels subscriber — does not re-render answer panel */}
            <LiveWaveform active={sessionOn} className="h-16 w-full" />
          </div>

          {/* Fixed-height status strip — no mount/unmount layout jump */}
          <div className="mb-4 min-h-[2.75rem] rounded-sm border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] tracking-normal text-white/55">
            <span className="line-clamp-2">
              {statusLine || (sessionOn ? 'Listening…' : 'Ready')}
            </span>
          </div>

          <div className="mb-6 flex flex-wrap gap-3">
            <Button
              type="button"
              size="lg"
              className="min-w-[200px]"
              variant={sessionOn ? 'danger' : 'default'}
              onClick={() => void toggleSession()}
            >
              {sessionOn ? (
                <>
                  <MicOff className="h-4 w-4" strokeWidth={1.75} /> Stop interview
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4" strokeWidth={1.75} /> Start interview
                </>
              )}
            </Button>

            <Button
              size="lg"
              variant="ghost"
              onClick={() => {
                if (sessionOn) liveInterview.stop()
                setSessionOn(false)
                setListening(false)
                clearTranscript()
                setCards([])
                updateCardIndex(0)
                setAnswer(null)
                setStatusLog([])
                setStatusLine('')
                setLevels(Array.from({ length: 16 }, () => 0.08))
                setPhase('idle')
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
              Reset
            </Button>
          </div>

          <div className="mb-8 space-y-2 rounded-[18px] glass-inset px-5 py-4 text-[13px] leading-relaxed text-white/45">
            <p className="font-light text-white/75">How this works</p>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>
                Press <strong className="text-white/70">Start interview</strong> — we capture{' '}
                <strong className="text-white/70">speakers / meeting audio only</strong>, not your mic
              </li>
              <li>
                When prompted, share the <strong className="text-white/70">Teams/Zoom tab</strong> and
                enable <strong className="text-white/70">Share tab audio</strong> (or system audio)
              </li>
              <li>
                Answer out loud as usual — your voice is not transcribed; only the interviewer is
              </li>
              <li>When a real question ends, a suggested answer appears here</li>
            </ol>
            <p className="mt-2 text-[12px] text-white/30">
              Audio source: Settings → Interview audio source. Local Windows can use Stereo Mix
              (system loopback) instead of tab share.
            </p>
            {!apiOk && (
              <p className="mt-2 text-[#E8C547]">
                Backend offline. Production uses{' '}
                <code className="text-[12px]">api.jobinterviewcracker.com</code>
                . Local: <code className="text-[12px]">cd src && python copilot_api.py</code>
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="label-quiet">Or type a question (skips STT lag)</span>
              <div className="flex gap-1 rounded-full bg-white/5 p-0.5 text-[11px]">
                {(['fast', 'balanced', 'deep'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDepth(d)}
                    className={`rounded-full px-2.5 py-1 capitalize ${
                      depth === d
                        ? 'bg-[#20B8CD]/20 text-[#20B8CD]'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                className="field min-w-0 flex-1"
                value={manualQ}
                onChange={(e) => setManualQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void askManual()}
                placeholder="Paste a question if STT lags…"
                disabled={answering}
              />
              <Button
                variant="secondary"
                onClick={() => void askManual()}
                disabled={answering || !manualQ.trim()}
              >
                {answering ? '…' : 'Answer'}
              </Button>
            </div>
          </div>
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">
            Live transcript
          </h2>
          <p className="mt-1 mb-6 text-[13px] text-white/40">
            What was heard (chatter still listed in status if filtered)
          </p>

          <div className="max-h-[260px] space-y-3 overflow-auto pr-1">
            {transcript.length === 0 && (
              <p className="py-8 text-center text-[14px] text-white/35">
                {sessionOn
                  ? 'Waiting for speech…'
                  : 'Start interview to begin listening'}
              </p>
            )}
            {transcript.map((line) => (
              <div
                key={line.id}
                className="rounded-[16px] glass-inset px-4 py-3 text-[14px] leading-relaxed text-white/80"
              >
                {line.text}
              </div>
            ))}
          </div>

          {statusLog.length > 0 && (
            <div className="mt-5 max-h-32 space-y-1 overflow-auto text-[11px] leading-relaxed text-white/30">
              {statusLog.slice(0, 10).map((s, i) => (
                <div key={i}>{s}</div>
              ))}
            </div>
          )}
        </section>
        </div>

        {/* Answer column — full width when left is hidden (no rail reservation) */}
        <div
          className={
            leftCollapsed
              ? 'flex min-h-[calc(100vh-5rem)] w-full min-w-0 flex-col gap-3 pt-12'
              : 'flex min-h-[720px] flex-col gap-5 xl:col-span-8 xl:min-h-0'
          }
        >
        {/*
          Single Speak surface: inline or full-viewport expand (same mount).
          Detach opens a separate #/overlay window (Electron or browser popup).
        */}
        <div
          className={
            answerExpanded
              ? 'fixed inset-0 z-[80] flex flex-col bg-[#0f0f10]/92 p-3 backdrop-blur-md sm:p-5'
              : 'min-h-0 flex-1'
          }
        >
          <div
            className={
              answerExpanded
                ? 'mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col'
                : 'h-full min-h-0'
            }
          >
            <WhisperStream
              cards={cards}
              cardIndex={cardIndex}
              onCardIndex={updateCardIndex}
              mode={answerMode}
              onMode={(m) => void handleModeChange(m)}
              preparing={sessionOn && phase === 'processing'}
              regenerating={regenerating}
              expanded={answerExpanded}
              onToggleExpand={toggleAnswerExpand}
              onDetach={() => void handleDetachAnswer()}
              detaching={detaching}
            />
          </div>
        </div>

        {/* Metrics strip — compact in wide mode so answer keeps vertical room */}
        <div
          className={
            leftCollapsed
              ? 'grid shrink-0 grid-cols-4 gap-2'
              : 'grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4'
          }
        >
          {[
            { label: 'Session', value: sessionOn ? 'ON' : 'Off' },
            {
              label: 'First token',
              value: metrics ? formatMs(metrics.firstTokenMs || metrics.totalMs) : '—',
            },
            {
              label: 'Full answer',
              value: metrics?.fullAnswerMs != null ? formatMs(metrics.fullAnswerMs) : '—',
            },
            {
              label: 'STT',
              value: metrics?.sttMs != null && metrics.sttMs > 0 ? formatMs(metrics.sttMs) : '—',
            },
          ].map((k) => (
            <div
              key={k.label}
              className={
                leftCollapsed
                  ? 'glass rounded-[14px] px-3 py-2.5'
                  : 'glass rounded-[18px] px-4 py-4'
              }
            >
              <div className="text-[11px] text-white/35 sm:text-[12px]">{k.label}</div>
              <div
                className={`mt-1 font-medium tracking-tight ${
                  leftCollapsed ? 'text-[16px]' : 'mt-1.5 text-[20px]'
                } ${
                  k.label === 'Session' && sessionOn
                    ? 'text-[#20B8CD]'
                    : 'text-white/90'
                }`}
              >
                {k.value}
              </div>
            </div>
          ))}
        </div>

        {/* Stage breakdown + competitor board */}
        <section className="glass shrink-0 rounded-[22px] px-5 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[14px] font-medium text-white/90">Latency stack</h3>
              <p className="text-[11px] text-white/35">
                Honest stages vs market — first token ≠ full monologue
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
              {showBench ? 'Hide benchmark' : 'vs competitors'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[
              { label: 'Outline', ms: metrics?.outlineMs },
              { label: 'Cache', ms: metrics?.cacheMs },
              { label: 'Classify', ms: metrics?.classifyMs },
              { label: 'LLM first', ms: metrics?.llmFirstTokenMs },
              { label: 'Full ans', ms: metrics?.fullAnswerMs },
              { label: 'E2E', ms: metrics?.totalPipelineMs },
            ].map((s) => (
              <div key={s.label} className="rounded-[14px] bg-white/[0.04] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-white/30">
                  {s.label}
                </div>
                <div className="mt-0.5 text-[15px] font-medium text-white/85">
                  {s.ms != null && s.ms > 0 ? formatMs(s.ms) : '—'}
                </div>
              </div>
            ))}
          </div>
          {latencySnap?.verdict && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
              <span className="text-white/40">Market rank:</span>
              <span className={gradeColor(latencySnap.verdict.first_token_grade)}>
                first-token {latencySnap.verdict.first_token_grade || 'n/a'}
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
            <p className="mt-2 text-[11px] text-white/30">
              Last source: {metrics.source}
              {metrics.depth ? ` · depth ${metrics.depth}` : ''}
              {latencySnap?.sample_count != null
                ? ` · ${latencySnap.sample_count} samples`
                : ''}
            </p>
          )}
        </section>
        </div>
      </div>
    </div>
  )
}
