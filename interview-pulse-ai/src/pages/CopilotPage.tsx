import { ApiStatusBadge } from '@/components/ApiStatusBadge'
import { Waveform } from '@/components/Waveform'
import { WhisperStream } from '@/components/WhisperStream'
import { Button } from '@/components/ui/button'
import { formatMs } from '@/lib/utils'
import { liveInterview } from '@/services/live-interview'
import { pipeline } from '@/services/pipeline'
import {
  checkCopilotHealth,
  fetchAnswer,
  fetchLatencyMetrics,
  setSessionContext,
  warmCopilotApi,
} from '@/services/real-api'
import { useAppStore } from '@/stores/app-store'
import type { AnswerMode, LatencySnapshot, QACard } from '@/types'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, MicOff, RefreshCw } from 'lucide-react'
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
 * - Web/cloud: browser mic streams PCM → API Whisper + answers
 * - Local Windows: can use system Stereo Mix when source=system
 * - Filters chatter, answers only interviewer questions
 * - Answers queue; you step with Next when ready
 */
export function CopilotPage() {
  const {
    levels,
    setLevels,
    answerMode,
    setAnswerMode,
    metrics,
    setMetrics,
    settings,
    activeJobTitle,
    clearTranscript,
    pushTranscript,
    setListening,
    setAnswer,
    transcript,
    user,
  } = useAppStore()

  const cardIndexRef = useRef(0)
  const [apiOk, setApiOk] = useState(false)
  const [sessionOn, setSessionOn] = useState(false)
  const [device, setDevice] = useState('')
  const [phase, setPhase] = useState('idle')
  const [statusLog, setStatusLog] = useState<string[]>([])
  const [cards, setCards] = useState<QACard[]>([])
  const [cardIndex, setCardIndex] = useState(0)
  const [regenerating, setRegenerating] = useState(false)
  const [manualQ, setManualQ] = useState('')
  const [answering, setAnswering] = useState(false)
  const [depth, setDepth] = useState<'fast' | 'balanced' | 'deep'>('balanced')
  const [latencySnap, setLatencySnap] = useState<LatencySnapshot | null>(null)
  const [showBench, setShowBench] = useState(false)

  const pushStatus = useCallback((msg: string) => {
    if (!msg) return
    setStatusLog((prev) => [msg, ...prev].slice(0, 20))
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

  // Wire live WebSocket for the lifetime of this page
  useEffect(() => {
    liveInterview.connect({
      onConnection: (s) => {
        setApiOk(s === 'open')
        if (s === 'open') pushStatus('Backend connected')
        if (s === 'closed') {
          setApiOk(false)
          setSessionOn(false)
          setListening(false)
        }
      },
      onStatus: (msg, listening) => {
        pushStatus(msg)
        if (typeof listening === 'boolean') {
          setSessionOn(listening)
          setListening(listening)
        }
      },
      onListening: (active, dev) => {
        setSessionOn(active)
        setListening(active)
        if (dev) setDevice(dev)
        if (!active) setPhase('idle')
      },
      onLevel: (level, state) => {
        if (state) setPhase(state)
        // Build a simple waveform from scalar level
        const bars = Array.from({ length: 32 }, (_, i) => {
          const wobble = 0.15 * Math.sin(Date.now() / 120 + i * 0.45)
          return Math.min(1, Math.max(0.04, level * 2.8 + wobble * level))
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
        // Live Deepgram interim — status only (avoid flooding transcript list)
        pushStatus(`Hearing… ${text.slice(0, 90)}${text.length > 90 ? '…' : ''}`)
        setPhase('hearing')
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
        setMetrics(m)
      },
      onAnswer: (ans) => {
        const q = (ans.question || 'Interview question').trim()
        // Long interviews: match by question text (not only last streaming card),
        // so Q2 doesn't overwrite Q1 and pending cards stay paired correctly.
        setCards((prev) => {
          const next = [...prev]
          const card: QACard = { id: ans.id, question: q, answer: ans }
          const qNorm = q.toLowerCase()
          let idx = -1
          for (let i = next.length - 1; i >= 0; i--) {
            const cq = (next[i]?.question || '').trim().toLowerCase()
            if (cq && (cq === qNorm || qNorm.includes(cq.slice(0, 40)) || cq.includes(qNorm.slice(0, 40)))) {
              idx = i
              break
            }
            if (next[i]?.answer?.streaming) {
              idx = i
              break
            }
          }
          if (idx >= 0) {
            next[idx] = card
          } else {
            next.push(card)
            idx = next.length - 1
          }
          cardIndexRef.current = idx
          setCardIndex(idx)
          return next
        })
        setAnswer(ans)
        // Prefer full stage metrics from onMetrics/latency events; fall back to first token
        if (ans.latencyMs != null) {
          setMetrics({
            vadMs: 0,
            sttMs: 0,
            firstTokenMs: ans.latencyMs,
            totalMs: ans.latencyMs,
            lastUpdated: Date.now(),
          })
        }
        setPhase('listening')
        pushStatus('Answer ready — still listening')
        // Refresh competitor benchmark snapshot
        void fetchLatencyMetrics().then((s) => {
          if (s) setLatencySnap(s)
        })
      },
      onError: (msg) => {
        // Session/audio errors are not the same as "API offline"
        pushStatus(`Error: ${msg}`)
        if (/not connected|websocket not open|backend connection closed|failed to fetch/i.test(msg)) {
          setApiOk(false)
        }
      },
    })

    // Warm OpenAI + Whisper so the first answer is not cold-start slow
    void warmCopilotApi()

    // Probe HTTP health + WS (poll so buttons re-enable when API starts)
    const ping = () => {
      void checkCopilotHealth().then((h) => {
        // Online = API reachable. openai_key is optional soft warning.
        if (h.ok) {
          setApiOk(true)
          if (h.openai_key === false) {
            pushStatus('API online — set OPENAI_API_KEY on the server for AI answers')
          }
        } else if (!liveInterview.connected) {
          setApiOk(false)
        }
      })
      void liveInterview
        .ensureOpen()
        .then(() => setApiOk(true))
        .catch(() => {
          /* health poll handles message */
        })
    }
    ping()
    const id = window.setInterval(ping, 5000)

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
      setLevels(Array.from({ length: 32 }, () => 0.08))
      pushStatus('Interview session stopped')
      return
    }

    try {
      pushStatus('Starting interview — allow microphone if prompted…')
      await liveInterview.start({
        jobContext: settings.jobContext || activeJobTitle,
        tone: settings.tone,
        mode: answerMode,
        // Always browser mic unless user opted into Stereo Mix (ip_audio_source=system)
        source: 'browser',
        // Admin-assigned models (null → server gpt-4.1-mini / nano)
        userAnswerModel: user?.answer_model ?? user?.effective_answer_model ?? null,
        userFallbackModel:
          user?.fallback_model ?? user?.effective_fallback_model ?? null,
        // Deepgram Nova-3 streaming STT (Settings key or server DEEPGRAM_API_KEY)
        deepgramKey: settings.deepgramKey || null,
        sttProvider: settings.deepgramKey ? 'deepgram' : 'auto',
      })
      setSessionOn(true)
      setListening(true)
      setApiOk(true)
      setDevice('browser-mic')
      pushStatus(
        settings.deepgramKey
          ? 'Listening (browser mic) · Deepgram Nova-3 STT'
          : 'Listening (browser mic) · Whisper STT (add Deepgram key in Settings for faster streaming)',
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
          `• Allow microphone access in the browser\n` +
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
    <div className="space-y-5">
      {/* Loud offline / no-LLM banner — hidden when API + LLM are healthy */}
      <ApiStatusBadge variant="banner" />

      <div className="grid min-h-[calc(100vh-9rem)] gap-8 xl:grid-cols-12 xl:items-stretch xl:gap-10">
      <div className="flex flex-col gap-6 xl:col-span-4">
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
            <div className="text-right">
              <div className="flex items-center justify-end gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    sessionOn
                      ? 'listening-pulse bg-[#20B8CD]'
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

          <div className="mb-8 rounded-[22px] glass-inset px-6 py-8">
            <Waveform levels={levels} active={sessionOn} className="h-16 w-full" />
          </div>

          {/* Always-visible status so actions never feel silent */}
          {statusLog[0] && (
            <div
              className={`mb-4 rounded-sm border px-4 py-3 text-[12px] tracking-normal ${
                apiOk
                  ? 'border-[#20B8CD]/30 text-[#20B8CD]'
                  : 'border-[#E8C547]/40 text-[#E8C547]'
              }`}
            >
              {statusLog[0]}
            </div>
          )}

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
                  <Mic className="h-4 w-4" strokeWidth={1.75} /> Start interview
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
                setLevels(Array.from({ length: 32 }, () => 0.08))
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
              <li>Press <strong className="text-white/70">Start interview</strong> — allow mic if asked</li>
              <li>Play the interviewer on speakers (or speak the question)</li>
              <li>Browser mic streams audio to the API; chatter is filtered</li>
              <li>When a real question ends, an answer appears here</li>
            </ol>
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
            <AnimatePresence initial={false}>
              {transcript.length === 0 && (
                <p className="py-8 text-center text-[14px] text-white/35">
                  {sessionOn
                    ? 'Waiting for speech…'
                    : 'Start interview to begin listening'}
                </p>
              )}
              {transcript.map((line) => (
                <motion.div
                  key={line.id + line.text.slice(0, 24)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-[16px] glass-inset px-4 py-3 text-[14px] leading-relaxed text-white/80"
                >
                  {line.text}
                </motion.div>
              ))}
            </AnimatePresence>
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

      <div className="flex min-h-[720px] flex-col gap-5 xl:col-span-8 xl:min-h-0">
        <div className="min-h-0 flex-1">
          <WhisperStream
            cards={cards}
            cardIndex={cardIndex}
            onCardIndex={updateCardIndex}
            mode={answerMode}
            onMode={(m) => void handleModeChange(m)}
            preparing={sessionOn && phase === 'processing'}
            regenerating={regenerating}
          />
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
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
            <div key={k.label} className="glass rounded-[18px] px-4 py-4">
              <div className="text-[12px] text-white/35">{k.label}</div>
              <div
                className={`mt-1.5 text-[20px] font-medium tracking-tight ${
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
