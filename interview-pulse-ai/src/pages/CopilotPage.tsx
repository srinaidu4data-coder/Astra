import { ApiStatusBadge } from '@/components/ApiStatusBadge'
import { LiveWaveform } from '@/components/LiveWaveform'
import { MaterialsPanel } from '@/components/MaterialsPanel'
import { WhisperStream } from '@/components/WhisperStream'
import { Button } from '@/components/ui/button'
import { openAnswerPopout } from '@/lib/answer-popout'
import { liveInterview } from '@/services/live-interview'
import { pipeline } from '@/services/pipeline'
import {
  checkCopilotHealth,
  fetchAnswer,
  fullSessionReset,
  setSessionContext,
  warmCopilotApi,
} from '@/services/real-api'
import { useAppStore } from '@/stores/app-store'
import type { AnswerMode, QACard } from '@/types'
import {
  ChevronDown,
  MicOff,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Volume2,
} from 'lucide-react'
import {
  isRemoteCopilotApi,
  resolveInterviewAudioSource,
  type InterviewAudioSource,
} from '@/lib/api-base'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Unified Interview home (Copilot + Materials/Knowledge).
 * Latency metrics live in Settings. Apple-simple: Start, answer, materials.
 */
export function CopilotPage() {
  // Granular selectors — NEVER subscribe to the whole store (levels thrash was
  // re-rendering the answer panel ~10×/s and looked like constant flicker).
  const setLevels = useAppStore((s) => s.setLevels)
  const answerMode = useAppStore((s) => s.answerMode)
  const setAnswerMode = useAppStore((s) => s.setAnswerMode)
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
  /** Abort in-flight format rewrite so mode toggles never stick disabled */
  const modeRewriteAbortRef = useRef<AbortController | null>(null)
  const [manualQ, setManualQ] = useState('')
  const [answering, setAnswering] = useState(false)
  const [depth, setDepth] = useState<'fast' | 'balanced' | 'deep'>('balanced')
  /** Hide left controls — full-bleed answer (store drives shell + sidebar) */
  const leftCollapsed = useAppStore((s) => s.copilotWideAnswer)
  const setCopilotWideAnswer = useAppStore((s) => s.setCopilotWideAnswer)
  const toggleLeftPanel = useCallback(() => {
    setCopilotWideAnswer(!leftCollapsed)
  }, [leftCollapsed, setCopilotWideAnswer])
  /** In-app expand: answer fills the viewport over chrome */
  const [answerExpanded, setAnswerExpanded] = useState(false)
  const [detaching, setDetaching] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)

  const toggleAnswerExpand = useCallback(() => {
    setAnswerExpanded((v) => !v)
  }, [])

  /** Role title + Job context for answer prompts (both fields from Live interview UI). */
  const effectiveJobContext = useCallback(() => {
    const role = (activeJobTitle || '').trim()
    const jc = (settings.jobContext || '').trim()
    if (role && jc && role.toLowerCase() !== jc.toLowerCase()) {
      return `${role} · ${jc}`
    }
    return role || jc || ''
  }, [activeJobTitle, settings.jobContext])

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

  const failPending = useCallback(
    (message: string) => {
      setCards((prev) => {
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          const c = next[i]
          if (c?.answer?.streaming || c?.id?.startsWith('pending_')) {
            next[i] = {
              ...c,
              answer: {
                ...c.answer,
                streaming: false,
                bullets: [
                  message || 'Answer timed out. Type the question below and retry.',
                ],
              },
            }
            setAnswer(next[i]!.answer)
            break
          }
        }
        return next
      })
      setPhase('idle')
    },
    [setAnswer],
  )

  const showPending = useCallback(
    (question: string) => {
      const pendingId = `pending_${Date.now()}`
      const pending: QACard = {
        id: pendingId,
        question,
        answer: {
          id: pendingId,
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
      // Support #22: never leave "Writing…" forever
      window.setTimeout(() => {
        setCards((prev) => {
          const c = prev.find((x) => x.id === pendingId)
          if (!c?.answer?.streaming) return prev
          return prev.map((x) =>
            x.id === pendingId
              ? {
                  ...x,
                  answer: {
                    ...x.answer,
                    streaming: false,
                    bullets: [
                      'Still waiting on the model — try typing the question below, or Reset and Start again.',
                    ],
                  },
                }
              : x,
          )
        })
      }, 45_000)
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

  // Never auto-fill Role / Job context from server pack or JD bootstrap.
  // Fields stay empty until the user types (and are not restored from storage).

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
        const r = reason || 'chatter'
        pushStatus(`Filtered (${r}): ${text.slice(0, 60)}… — type it below to Answer anyway`)
        // Keep last filtered line in manual box so user can force-answer
        if (text?.trim() && text.trim().length > 12) {
          setManualQ((prev) => (prev.trim() ? prev : text.trim()))
        }
      },
      onError: (message) => {
        pushStatus(`Error: ${message}`)
        failPending(`Error: ${message}`)
        if (/not connected|websocket|offline|closed/i.test(message)) {
          setApiOk(false)
        }
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
      // Preflight: health before capture dialog (support #1, #4)
      const health = await checkCopilotHealth()
      if (!health.ok) {
        setApiOk(false)
        throw new Error(
          health.error ||
            'API offline. Start the backend (cd src && python copilot_api.py) or check api.jobinterviewcracker.com',
        )
      }
      if (health.openai_ready === false && health.openai_key === false) {
        throw new Error(
          'LLM key missing on the server (OPENAI_API_KEY / GROQ). Keys in Settings → OpenAI are not sent to the API — set them on Railway/local env.',
        )
      }
      setApiOk(true)

      const rawSource = settings.audioSource || 'auto'
      let audioMode: InterviewAudioSource =
        rawSource === 'auto' || !rawSource
          ? resolveInterviewAudioSource()
          : (rawSource as InterviewAudioSource)
      // Cloud API cannot capture PC speakers on Railway (support #2)
      if (audioMode === 'system' && isRemoteCopilotApi()) {
        audioMode = 'display'
        pushStatus('Cloud API: using tab share audio (system loopback is local-only)')
      }
      const modeHint =
        audioMode === 'system'
          ? 'PC speakers (Stereo Mix / loopback)'
          : audioMode === 'mic'
            ? '⚠ microphone (your answers may be transcribed)'
            : 'shared tab / system audio — enable “Share tab audio”'
      pushStatus(
        `Starting interview — ${modeHint}. Prefer speakers so only the interviewer is heard…`,
      )
      const jobCtx = effectiveJobContext()
      // THIS interview materials only: Role + attached JD + Resume (no RAG / prior packs)
      const docs = useAppStore.getState().documents || []
      const jdDoc = docs.find((d) => d.type === 'job')
      const resumeDoc = docs.find((d) => d.type === 'resume')
      const jobDescription = (jdDoc?.text || '').slice(0, 8000)
      const resumeText = (resumeDoc?.text || '').slice(0, 6000)
      void setSessionContext({
        role: jobCtx,
        job_description: jobDescription,
        resume_text: resumeText,
        depth,
        outline_first: true,
      })
      await liveInterview.start({
        jobContext: jobCtx,
        jobDescription,
        resumeText,
        tone: settings.tone,
        mode: answerMode,
        audioMode,
        userAnswerModel: user?.answer_model ?? user?.effective_answer_model ?? null,
        userFallbackModel:
          user?.fallback_model ?? user?.effective_fallback_model ?? null,
        deepgramKey: settings.deepgramKey || null,
        sttProvider: settings.deepgramKey ? 'deepgram' : 'auto',
      })
      setSessionOn(true)
      setListening(true)
      setDevice(
        audioMode === 'mic'
          ? 'microphone'
          : audioMode === 'system'
            ? 'system loopback'
            : 'tab/speakers',
      )
      const sttChip = settings.deepgramKey
        ? 'Deepgram Nova-3'
        : health.stt_deepgram_ready
          ? 'Deepgram (server key)'
          : 'Whisper'
      pushStatus(
        audioMode === 'mic'
          ? `⚠ Mic mode · STT ${sttChip} — switch to Speakers so your answers are not transcribed`
          : `Listening · STT ${sttChip} · your mic is off`,
      )
    } catch (e) {
      const msg = (e as Error).message || 'Could not start'
      pushStatus(`Could not start: ${msg}`)
      setSessionOn(false)
      setListening(false)
      const offline = /not connected|websocket|failed to fetch|network|offline/i.test(msg)
      if (offline) setApiOk(false)
      window.alert(
        `Cannot start interview.\n\n${msg}\n\n` +
          `Tips:\n` +
          `• Share the Teams/Zoom tab with "Share tab audio" (or system audio)\n` +
          `• Cloud site: do not use System loopback — use Share tab audio\n` +
          `• Local Windows: enable Stereo Mix / Speakers mode (Settings)\n` +
          `• Do NOT use mic mode unless you want your voice transcribed\n` +
          `• LLM keys must be on the API server env, not only in Settings\n` +
          `• Local: cd src && python copilot_api.py`,
      )
    }
  }

  const handleModeChange = async (mode: AnswerMode) => {
    // Always apply mode immediately (selected pill must move even if rewrite fails)
    setAnswerMode(mode)
    try {
      liveInterview.setMode(mode)
    } catch {
      /* offline WS — mode still stored for next answers */
    }

    const idx = cardIndexRef.current
    const current = cards[idx]
    if (!current?.question || !apiOk) {
      pushStatus(`Format → ${mode}`)
      return
    }

    // Cancel any prior format rewrite so toggles never stick on "Rewriting…"
    modeRewriteAbortRef.current?.abort()
    const ac = new AbortController()
    modeRewriteAbortRef.current = ac
    const timeoutId = window.setTimeout(() => ac.abort(), 55_000)

    setRegenerating(true)
    try {
      pushStatus(`Rewriting as ${mode}…`)
      const ans = await fetchAnswer(
        current.question,
        {
          jobContext: effectiveJobContext(),
          tone: settings.tone,
          mode,
          answerModel: user?.answer_model ?? user?.effective_answer_model ?? null,
          fallbackModel:
            user?.fallback_model ?? user?.effective_fallback_model ?? null,
        },
        ac.signal,
      )
      if (ac.signal.aborted) return
      const card: QACard = {
        id: ans.id,
        question: current.question,
        answer: { ...ans, question: current.question, mode },
      }
      setCards((prev) => {
        const next = [...prev]
        // Card may have scrolled; prefer index, fall back to matching question
        if (next[idx]?.question === current.question) {
          next[idx] = card
        } else {
          const j = next.findIndex((c) => c.question === current.question)
          if (j >= 0) next[j] = card
          else next.push(card)
        }
        return next
      })
      setAnswer(card.answer)
      pushStatus(`Rewrote as ${mode}`)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        pushStatus(`Format → ${mode}`)
        return
      }
      pushStatus(`Rewrite failed: ${(e as Error).message}`)
    } finally {
      window.clearTimeout(timeoutId)
      if (modeRewriteAbortRef.current === ac) {
        modeRewriteAbortRef.current = null
        setRegenerating(false)
      }
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
      const jobCtx = effectiveJobContext()
      void setSessionContext({
        role: jobCtx,
        depth,
        outline_first: true,
      })
      if (apiOk && sessionOn && liveInterview.connected) {
        // Live session: inject skips STT (market pattern for lag fallback)
        showPending(q)
        liveInterview.injectQuestion(q, {
          depth,
          jobContext: jobCtx,
        })
        setManualQ('')
      } else if (apiOk) {
        const ans = await fetchAnswer(q, {
          jobContext: effectiveJobContext(),
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

  // Latency strip + competitor board live in Settings (Speed & latency)

  useEffect(() => {
    void setSessionContext({ depth, outline_first: true })
    if (liveInterview.connected) liveInterview.setDepth(depth)
  }, [depth])

  // Live-wire Role + Job context (same pattern as depth) — empty clears server
  useEffect(() => {
    const jobCtx = effectiveJobContext()
    void setSessionContext({ role: jobCtx, outline_first: true })
    if (liveInterview.connected) {
      liveInterview.setJobContext(jobCtx)
    }
  }, [activeJobTitle, settings.jobContext, effectiveJobContext])

  const phaseLabel =
    phase === 'hearing'
      ? 'Hearing speech…'
      : phase === 'processing'
        ? 'Transcribing / answering…'
        : sessionOn
          ? 'Listening'
          : 'Idle'

  return (
    <div className={leftCollapsed ? 'space-y-3' : 'space-y-4'}>
      {/* Offline banner — only when controls visible */}
      {!leftCollapsed && <ApiStatusBadge variant="banner" />}

      <div
        className={
          leftCollapsed
            ? 'relative min-h-[calc(100vh-5rem)] w-full max-w-none'
            : 'grid min-h-[calc(100vh-9rem)] gap-6 xl:grid-cols-12 xl:items-stretch xl:gap-8'
        }
      >
        {/* Floating controls when left panel hidden */}
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
                  sessionOn ? 'bg-[#20B8CD]' : apiOk ? 'bg-white/30' : 'bg-[#E8C547]'
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

        {/* Left: one calm control column */}
        <div className={leftCollapsed ? 'hidden' : 'flex flex-col gap-4 xl:col-span-4'}>
          <section className="glass rounded-[24px] p-5 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-medium tracking-tight text-white/95">
                  Interview
                </h2>
                <p className="mt-0.5 text-[12px] text-white/40 sm:block">
                  <span className="sm:hidden">Tap Start · get answers</span>
                  <span className="hidden sm:inline">
                    One tap · hear interviewer · get answers
                  </span>
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={toggleLeftPanel}
                  title="Hide controls — expand answer"
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/55 hover:bg-white/[0.08] hover:text-white/80"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Hide
                </button>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      sessionOn ? 'bg-[#20B8CD]' : apiOk ? 'bg-white/30' : 'bg-[#E8C547]'
                    }`}
                  />
                  <span className="text-[11px] text-white/45">{phaseLabel}</span>
                </div>
                {device && (
                  <p className="max-w-[160px] truncate text-[10px] text-white/30">{device}</p>
                )}
              </div>
            </div>

            <div className="mb-4 rounded-[18px] glass-inset px-4 py-5">
              <LiveWaveform active={sessionOn} className="h-12 w-full" />
            </div>

            <div className="mb-4 min-h-[2.5rem] rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/55">
              <span className="line-clamp-2">
                {statusLine || (sessionOn ? 'Listening…' : 'Ready when you are')}
              </span>
            </div>

            {/* Primary CTA — largest control */}
            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="lg"
                className="min-h-[48px] min-w-[180px] flex-1 text-[15px]"
                variant={sessionOn ? 'danger' : 'default'}
                onClick={() => void toggleSession()}
              >
                {sessionOn ? (
                  <>
                    <MicOff className="h-4 w-4" strokeWidth={1.75} /> Stop
                  </>
                ) : (
                  <>
                    <Volume2 className="h-4 w-4" strokeWidth={1.75} /> Start
                  </>
                )}
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="min-h-[48px]"
                title="Clear answers, transcript, role, and server cache"
                onClick={() => {
                  if (sessionOn) liveInterview.stop()
                  liveInterview.clearStartOpts()
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
                  setManualQ('')
                  setActiveJobTitle('')
                  updateSettings({ jobContext: '' })
                  void fullSessionReset().catch(() =>
                    setSessionContext({ clear: true, role: '' }),
                  )
                  pushStatus('Reset complete — Role, answers, and server cache cleared')
                }}
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                Reset
              </Button>
            </div>

            {/* Role + context — compact */}
            <div className="mb-4 space-y-2.5">
              <label className="block">
                <span className="label-quiet">Role</span>
                <input
                  className="field mt-1"
                  value={activeJobTitle}
                  onChange={(e) => setActiveJobTitle(e.target.value)}
                  placeholder="e.g. Product Manager"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="label-quiet">Job context</span>
                <input
                  className="field mt-1"
                  value={settings.jobContext}
                  onChange={(e) => updateSettings({ jobContext: e.target.value })}
                  placeholder="Optional stack or domain notes"
                  autoComplete="off"
                />
              </label>
              <p className="text-[11px] leading-relaxed text-white/30">
                Answers use:{' '}
                <span className="text-white/50">
                  {effectiveJobContext() || 'question only'}
                </span>
                {sessionOn ? ' · live' : ''}
              </p>
              <label className="block">
                <span className="label-quiet">Answer depth</span>
                <select
                  className="field mt-1"
                  value={depth}
                  onChange={(e) =>
                    setDepth(e.target.value as 'fast' | 'balanced' | 'deep')
                  }
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="deep">Deep</option>
                </select>
              </label>
              {sessionOn && (
                <p className="text-[11px] text-white/28">
                  Audio source / STT keys apply on next Start. Stop first to change capture mode.
                </p>
              )}
            </div>

            {/* Type a question */}
            <div className="mb-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="label-quiet">Type a question</span>
                <div className="flex gap-0.5 rounded-full bg-white/5 p-0.5 text-[11px]">
                  {(['fast', 'balanced', 'deep'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDepth(d)}
                      className={`rounded-full px-2 py-0.5 capitalize ${
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
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="field min-w-0 flex-1"
                  value={manualQ}
                  onChange={(e) => setManualQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void askManual()}
                  placeholder="Paste if audio lags…"
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

            {/* How this works — progressive disclosure */}
            <button
              type="button"
              onClick={() => setShowHowItWorks((v) => !v)}
              className="mb-1 flex w-full items-center justify-between gap-2 rounded-xl px-1 py-2 text-left text-[12px] text-white/40 hover:text-white/65"
            >
              <span>How this works</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showHowItWorks ? 'rotate-180' : ''}`}
                strokeWidth={1.75}
              />
            </button>
            {showHowItWorks && (
              <div className="mb-2 space-y-2 rounded-[16px] glass-inset px-4 py-3 text-[12px] leading-relaxed text-white/45">
                <ol className="list-decimal space-y-1.5 pl-4">
                  <li>
                    Press <strong className="text-white/70">Start</strong> — we capture{' '}
                    <strong className="text-white/70">speakers / meeting audio only</strong>, not
                    your mic
                  </li>
                  <li>
                    Share the <strong className="text-white/70">Teams/Zoom tab</strong> and enable{' '}
                    <strong className="text-white/70">Share tab audio</strong>
                  </li>
                  <li>
                    Answer out loud as usual — your voice is not transcribed; only the interviewer is
                  </li>
                  <li>When a real question ends, a suggested answer appears on the right</li>
                </ol>
                <p className="text-[11px] text-white/30">
                  Audio source: Settings → Interview audio source. Speed metrics: Settings → Speed &
                  latency. Local Windows can use Stereo Mix.
                </p>
                {!apiOk && (
                  <p className="text-[#E8C547]">
                    Backend offline. Production uses{' '}
                    <code className="text-[11px]">api.jobinterviewcracker.com</code>
                    . Local: <code className="text-[11px]">cd src && python copilot_api.py</code>
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Materials = former Knowledge page (all features) */}
          <MaterialsPanel embedded defaultOpen={false} />

          {/* Live transcript — collapsible */}
          <section className="glass overflow-hidden rounded-[22px]">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/[0.03]"
              aria-expanded={showTranscript}
            >
              <div>
                <div className="text-[14px] font-medium text-white/90">Transcript</div>
                <p className="mt-0.5 text-[11px] text-white/35">
                  {transcript.length
                    ? `${transcript.length} line${transcript.length === 1 ? '' : 's'}`
                    : sessionOn
                      ? 'Waiting for speech…'
                      : 'Empty until you Start'}
                </p>
              </div>
              <ChevronDown
                className={`h-5 w-5 text-white/40 transition-transform ${
                  showTranscript ? 'rotate-180' : ''
                }`}
                strokeWidth={1.75}
              />
            </button>
            {showTranscript && (
              <div className="border-t border-white/[0.06] px-5 pb-5">
                <div className="max-h-[220px] space-y-2 overflow-auto pr-1 pt-3">
                  {transcript.length === 0 && (
                    <p className="py-6 text-center text-[13px] text-white/35">
                      {sessionOn
                        ? 'Waiting for speech…'
                        : 'Start interview to begin listening'}
                    </p>
                  )}
                  {transcript.map((line) => (
                    <div
                      key={line.id}
                      className="rounded-[14px] glass-inset px-3.5 py-2.5 text-[13px] leading-relaxed text-white/80"
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
                {statusLog.length > 0 && (
                  <div className="mt-3 max-h-28 space-y-1 overflow-auto text-[11px] leading-relaxed text-white/28">
                    {statusLog.slice(0, 10).map((s, i) => (
                      <div key={i}>{s}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Answer — hero surface, no latency clutter */}
        <div
          className={
            leftCollapsed
              ? 'flex min-h-[calc(100vh-5rem)] w-full min-w-0 flex-col gap-3 pt-12'
              : 'flex min-h-[640px] flex-col gap-4 xl:col-span-8 xl:min-h-0'
          }
        >
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
          {!leftCollapsed && (
            <p className="mobile-hide-helper shrink-0 text-center text-[11px] text-white/25">
              Speed metrics → Settings · Speed & latency
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
