import { Waveform } from '@/components/Waveform'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getReadyMadeCategory,
  READY_MADE_CATEGORIES,
  type ReadyMadePack,
} from '@/data/readyMadeMocks'
import { PERSONA_LABELS } from '@/lib/demo-data'
import { uid } from '@/lib/utils'
import { MicDictation } from '@/services/dictation'
import {
  speakInterviewer,
  stopInterviewerSpeech,
} from '@/services/interviewer-voice'
import {
  buildMockReport,
  countFillersLocal,
  scoreMockAnswer,
  spokenQuestionLine,
  startMockSession,
  type MockDifficulty,
  type MockFocus,
  type MockPersona,
  type MockQuestion,
  type MockReport,
  type MockScore,
} from '@/services/mock-interview'
import { useAppStore } from '@/stores/app-store'
import type { InterviewerPersona } from '@/types'
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Gamepad2,
  Headphones,
  Lightbulb,
  Mic,
  MicOff,
  RotateCcw,
  Sparkles,
  Square,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const personas: InterviewerPersona[] = [
  'strict-tech-lead',
  'behavioral-hr',
  'system-design',
  'friendly-recruiter',
]

const difficulties: MockDifficulty[] = ['easy', 'medium', 'hard']
const focuses: { id: MockFocus; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'behavioral', label: 'Behavioral' },
  { id: 'technical', label: 'Technical' },
  { id: 'system-design', label: 'System design' },
]

type Phase = 'setup' | 'live' | 'report' | 'audio'

type SetupTab = 'ready' | 'custom'

type Turn = {
  question: string
  answer: string
  scores: MockScore
  elapsedSec: number
}

type TurnPhase = 'intro' | 'asking' | 'answering' | 'feedback'

/**
 * Audio mock interview — conversational spoken interviewer:
 * intro → spoken question → your mic answer → score → spoken next / follow-up → debrief
 */
export function PracticePage() {
  const {
    practicePersona,
    setPracticePersona,
    practiceActive,
    setPracticeActive,
    liveFeedback,
    setLiveFeedback,
    levels,
    setLevels,
    addSession,
    settings,
    memories,
    setRoute,
  } = useAppStore()

  const [phase, setPhase] = useState<Phase>('setup')
  const [setupTab, setSetupTab] = useState<SetupTab>('ready')
  const [readyCategoryId, setReadyCategoryId] = useState(
    READY_MADE_CATEGORIES[0]?.id || 'sap-fico',
  )
  const [activePack, setActivePack] = useState<ReadyMadePack | null>(null)
  const [jobTitle, setJobTitle] = useState(settings.jobContext || '')
  const [company, setCompany] = useState('')
  const [jd, setJd] = useState('')
  const [difficulty, setDifficulty] = useState<MockDifficulty>('medium')
  const [focus, setFocus] = useState<MockFocus>('mixed')
  const [qCount, setQCount] = useState(5)
  const [timeLimit, setTimeLimit] = useState(90) // seconds per answer
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sessionId, setSessionId] = useState('')
  const [questions, setQuestions] = useState<MockQuestion[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [tips, setTips] = useState<string[]>([])
  const [source, setSource] = useState('')

  const [answerText, setAnswerText] = useState('')
  const [listeningMic, setListeningMic] = useState(false)
  const [dictateStatus, setDictateStatus] = useState<string | null>(null)
  const [answerElapsed, setAnswerElapsed] = useState(0)
  const [sessionElapsed, setSessionElapsed] = useState(0)
  const [lastScore, setLastScore] = useState<MockScore | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [report, setReport] = useState<MockReport | null>(null)
  const [showModel, setShowModel] = useState(true)
  const [followUpMode, setFollowUpMode] = useState(false)
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('intro')
  const [interviewerLine, setInterviewerLine] = useState('')
  const [, setIntroScript] = useState('')
  const [closingScript, setClosingScript] = useState('')
  const [voiceHint, setVoiceHint] = useState<string | null>(null)

  const dictationRef = useRef<MicDictation | null>(null)
  const answerTextRef = useRef('')
  const answerTick = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionTick = useRef<ReturnType<typeof setInterval> | null>(null)
  const waveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef('')
  const turnsRef = useRef<Turn[]>([])
  const speakGen = useRef(0)

  // Keep a live ref so mic callbacks always append to the latest box text
  useEffect(() => {
    answerTextRef.current = answerText
  }, [answerText])

  const currentQ = questions[qIndex] ?? null
  const localFillers = countFillersLocal(answerText)
  const timeLeft = Math.max(0, timeLimit - answerElapsed)
  const interviewerTalking = turnPhase === 'intro' || turnPhase === 'asking'

  useEffect(() => {
    return () => {
      speakGen.current += 1
      stopInterviewerSpeech()
      stopTimers()
      stopMic()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopTimers = () => {
    if (answerTick.current) clearInterval(answerTick.current)
    if (sessionTick.current) clearInterval(sessionTick.current)
    if (waveRef.current) clearInterval(waveRef.current)
    answerTick.current = null
    sessionTick.current = null
    waveRef.current = null
  }

  const stopMic = () => {
    const d = dictationRef.current
    dictationRef.current = null
    setListeningMic(false)
    setDictateStatus(null)
    if (d) {
      void d.stop()
    }
  }

  const startWave = () => {
    waveRef.current = setInterval(() => {
      setLevels(Array.from({ length: 32 }, () => 0.1 + Math.random() * 0.8))
    }, 90)
  }

  const startAnswerTimer = () => {
    setAnswerElapsed(0)
    if (answerTick.current) clearInterval(answerTick.current)
    answerTick.current = setInterval(() => {
      setAnswerElapsed((s) => s + 1)
    }, 1000)
  }

  const beginMicDictation = () => {
    if (listeningMic || dictationRef.current?.active) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setDictateStatus('Type your answer — mic not available')
      return
    }
    setError(null)
    setListeningMic(true)
    setDictateStatus('Your turn — listening…')
    if (waveRef.current) {
      clearInterval(waveRef.current)
      waveRef.current = null
    }
    const dictation = new MicDictation()
    dictationRef.current = dictation
    void dictation
      .start({
        onText: (piece) => {
          const prev = answerTextRef.current.trim()
          const next = prev ? `${prev} ${piece}` : piece
          answerTextRef.current = next
          setAnswerText(next)
        },
        onLevels: (lv) => setLevels(lv),
        onStatus: (msg) => setDictateStatus(msg),
        onError: (msg) => {
          setError(msg)
          setDictateStatus(null)
        },
      })
      .catch((e) => {
        setListeningMic(false)
        setDictateStatus(null)
        dictationRef.current = null
        setError((e as Error).message || 'Could not start dictation')
        if (practiceActive && !waveRef.current) startWave()
      })
  }

  /** Speak a line as the interviewer; auto-open mic when asking a question. */
  const deliverInterviewer = async (
    line: string,
    phase: TurnPhase,
    opts?: { openMicAfter?: boolean },
  ) => {
    const gen = ++speakGen.current
    stopMic()
    stopInterviewerSpeech()
    setInterviewerLine(line)
    setTurnPhase(phase)
    setVoiceHint(phase === 'asking' || phase === 'intro' ? 'Interviewer speaking…' : null)
    startWave()
    await speakInterviewer(line, {
      persona: practicePersona as MockPersona,
      onStart: () => {
        if (gen !== speakGen.current) return
        setVoiceHint('Interviewer speaking…')
      },
      onEnd: () => {
        if (gen !== speakGen.current) return
        setVoiceHint(null)
      },
      onError: (msg) => {
        if (gen !== speakGen.current) return
        setVoiceHint(msg)
      },
    })
    if (gen !== speakGen.current) return
    if (opts?.openMicAfter) {
      setTurnPhase('answering')
      setVoiceHint('Your turn — answer out loud')
      startAnswerTimer()
      beginMicDictation()
    }
  }

  const beginLiveSession = async (opts: {
    sessionId: string
    questions: MockQuestion[]
    tips: string[]
    source: string
    intro: string
    closing: string
  }) => {
    setSessionId(opts.sessionId)
    setQuestions(opts.questions)
    setTips(opts.tips)
    setSource(opts.source)
    setIntroScript(opts.intro)
    setClosingScript(opts.closing)
    setQIndex(0)
    setAnswerText('')
    turnsRef.current = []
    setTurns([])
    setLastScore(null)
    setFollowUpMode(false)
    setTurnPhase('intro')
    setInterviewerLine('')
    setReport(null)
    setPhase('live')
    setPracticeActive(true)
    startedAt.current = new Date().toISOString()
    setSessionElapsed(0)
    if (sessionTick.current) clearInterval(sessionTick.current)
    sessionTick.current = setInterval(() => {
      setSessionElapsed((s) => s + 1)
    }, 1000)
    setLiveFeedback({
      confidence: 70,
      fillerWords: 0,
      starCoverage: 55,
      technicalDepth: 60,
    })
    setBusy(false)

    const first = opts.questions[0]
    const firstLine = spokenQuestionLine(first) || first?.text || ''
    await deliverInterviewer(opts.intro, 'intro')
    if (firstLine) {
      await deliverInterviewer(firstLine, 'asking', { openMicAfter: true })
    } else {
      setTurnPhase('answering')
      startAnswerTimer()
      beginMicDictation()
    }
  }

  /** Ready-made pack: fixed bank (no API question gen) + scoring still via API. */
  const startReadyMadePack = async (pack: ReadyMadePack) => {
    setBusy(true)
    setError(null)
    setActivePack(pack)
    try {
      setJobTitle(pack.job_title)
      setCompany(pack.company || '')
      setDifficulty(pack.difficulty)
      setFocus(pack.focus)
      setPracticePersona(pack.persona as InterviewerPersona)
      setTimeLimit(pack.answer_seconds || 90)
      setQCount(pack.questions.length)

      const qs: MockQuestion[] = pack.questions.map((q) => ({
        id: q.id,
        text: q.text,
        spoken_text: q.spoken_text || q.text,
        category: q.category || pack.id,
        hint: q.hint,
        bridge: q.bridge,
      }))

      await beginLiveSession({
        sessionId: uid('ready'),
        questions: qs,
        tips: [
          'Ready-made panel bank — answer with ownership and transaction codes.',
          'Use STAR when the question is scenario-based.',
          'If you hedge, name decision criteria.',
        ],
        source: `ready-made · ${pack.id}`,
        intro: pack.intro_script,
        closing: pack.closing_script,
      })
    } catch (e) {
      setError((e as Error).message || 'Could not start ready-made mock')
      setBusy(false)
    }
  }

  const openPanelAudio = (pack: ReadyMadePack) => {
    if (!pack.audio_url) {
      setError('No panel audio file for this pack yet.')
      return
    }
    setActivePack(pack)
    setJobTitle(pack.job_title)
    setError(null)
    setPhase('audio')
  }

  // Handoff from Company Twin Sprint → fixed mock plan
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ip_sprint_mock_plan')
      if (!raw) return
      sessionStorage.removeItem('ip_sprint_mock_plan')
      const plan = JSON.parse(raw) as {
        questions?: MockQuestion[]
        intro_script?: string
        closing_script?: string
        job_title?: string
      }
      if (!plan.questions?.length) return
      setJobTitle(plan.job_title || 'Company Twin mock')
      setBusy(true)
      void beginLiveSession({
        sessionId: uid('sprint_mock'),
        questions: plan.questions.map((q, i) => ({
          id: q.id || `twin_${i}`,
          text: q.text,
          spoken_text: q.spoken_text || q.text,
          category: q.category || 'twin',
        })),
        tips: ['Company Twin mock — use only verified experience'],
        source: 'sprint-twin-mock',
        intro:
          plan.intro_script ||
          'Company Twin mock. Answer with evidence only from your materials.',
        closing: plan.closing_script || 'Twin mock complete.',
      })
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startSession = async () => {
    setBusy(true)
    setError(null)
    setActivePack(null)
    setReport(null)
    setTurns([])
    setLastScore(null)
    setFollowUpMode(false)
    setTurnPhase('intro')
    setInterviewerLine('')
    try {
      const resumeBits = memories
        .slice(0, 4)
        .map((m) => `${m.situation} → ${m.result}`)
        .join('\n')
      const res = await startMockSession({
        job_title: jobTitle.trim() || '',
        job_description: jd,
        persona: practicePersona as MockPersona,
        difficulty,
        focus,
        question_count: qCount,
        resume_snippets: resumeBits,
        company,
      })
      await beginLiveSession({
        sessionId: res.session_id,
        questions: res.questions,
        tips: res.tips,
        source: res.source,
        intro:
          res.intro_script ||
          `Thanks for joining. This is a mock interview for ${jobTitle || 'this role'}. Let's begin.`,
        closing: res.closing_script || '',
      })
    } catch (e) {
      setError((e as Error).message || 'Could not start mock session')
      setBusy(false)
    }
  }

  const toggleMic = () => {
    if (listeningMic || dictationRef.current?.active) {
      stopMic()
      if (practiceActive && !waveRef.current) startWave()
      return
    }
    if (interviewerTalking) {
      setError('Wait for the interviewer to finish, then your mic will open.')
      return
    }
    beginMicDictation()
  }

  const submitAnswer = async () => {
    if (!currentQ || !answerText.trim() || busy) return
    stopMic()
    stopInterviewerSpeech()
    setBusy(true)
    setError(null)
    setTurnPhase('feedback')
    try {
      const scores = await scoreMockAnswer({
        session_id: sessionId,
        question: currentQ.text,
        answer: answerText.trim(),
        persona: practicePersona as MockPersona,
        difficulty,
        job_title: jobTitle,
        job_description: jd,
        elapsed_sec: answerElapsed,
      })
      setLastScore(scores)
      setLiveFeedback({
        confidence: scores.confidence,
        fillerWords: scores.filler_count,
        starCoverage: scores.star_coverage,
        technicalDepth: scores.technical_depth,
      })
      const turn: Turn = {
        question: currentQ.text,
        answer: answerText.trim(),
        scores,
        elapsedSec: answerElapsed,
      }
      turnsRef.current = [...turnsRef.current, turn]
      setTurns(turnsRef.current)

      // Brief spoken acknowledgment (conversational, not a full debrief)
      const ack =
        scores.overall >= 80
          ? 'Thanks — solid answer. Take a look at the coach notes when you are ready to continue.'
          : 'Thanks. I have a few notes for you on the side — continue when you are ready.'
      void speakInterviewer(ack, { persona: practicePersona as MockPersona })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const goNext = () => {
    stopInterviewerSpeech()
    setLastScore(null)
    setAnswerText('')
    setFollowUpMode(false)
    if (qIndex + 1 >= questions.length) {
      void finishSession()
      return
    }
    const nextIndex = qIndex + 1
    setQIndex(nextIndex)
    const nextQ = questions[nextIndex]
    const line = spokenQuestionLine(nextQ) || nextQ?.text || ''
    void deliverInterviewer(line, 'asking', { openMicAfter: true })
  }

  const askFollowUp = () => {
    if (!lastScore?.follow_up) return
    stopInterviewerSpeech()
    const fuText = lastScore.follow_up
    setFollowUpMode(true)
    setAnswerText('')
    setLastScore(null)
    const fu: MockQuestion = {
      id: `fu_${Date.now()}`,
      text: fuText,
      spoken_text: `Quick follow-up. ${fuText}`,
      category: 'follow-up',
      hint: 'Dig deeper — shorter answer OK.',
    }
    setQuestions((prev) => {
      const next = [...prev]
      next.splice(qIndex + 1, 0, fu)
      return next
    })
    setQIndex((i) => i + 1)
    void deliverInterviewer(fu.spoken_text!, 'asking', { openMicAfter: true })
  }

  const finishSession = async () => {
    setBusy(true)
    speakGen.current += 1
    stopMic()
    stopInterviewerSpeech()
    stopTimers()
    setLevels(Array.from({ length: 32 }, () => 0.08))
    setPracticeActive(false)
    const close =
      closingScript ||
      'That wraps up our mock interview. Here is your debrief.'
    try {
      await speakInterviewer(close, { persona: practicePersona as MockPersona })
    } catch {
      /* ignore */
    }
    try {
      // Use ref so the last scored answer is included (state may lag one tick)
      const allTurns = turnsRef.current
      const rep = await buildMockReport({
        session_id: sessionId,
        job_title: jobTitle,
        persona: practicePersona as MockPersona,
        difficulty,
        turns: allTurns.map((t) => ({
          question: t.question,
          answer: t.answer,
          scores: t.scores,
        })),
      })
      setReport(rep)
      setPhase('report')
      addSession({
        id: uid('sess'),
        persona: practicePersona,
        startedAt: startedAt.current || new Date().toISOString(),
        endedAt: new Date().toISOString(),
        questions: allTurns.length,
        fillerWords: rep.filler_count,
        starCoverage: rep.star_coverage,
        confidence: rep.confidence,
        technicalDepth: rep.technical_depth,
        notes: rep.top_improvements.slice(0, 3),
        overall: rep.overall,
        grade: rep.grade,
        jobTitle,
        difficulty,
        focus,
        communication: rep.communication,
        summary: rep.summary,
        practicePlan: rep.practice_plan,
      })
      // Company Twin debrief (editable follow-up email stored server-side; never auto-sent)
      if (source.startsWith('sprint') || source.includes('twin')) {
        try {
          const { submitDebrief } = await import('@/services/sprint')
          const oppRaw = sessionStorage.getItem('ip_sprint_opportunity_id')
          const oppId = oppRaw ? Number(oppRaw) : NaN
          if (Number.isFinite(oppId)) {
            const twin = await submitDebrief({
              opportunity_id: oppId,
              kind: 'mock',
              readiness_before: undefined,
              turns: allTurns.map((t) => ({
                question: t.question,
                answer: t.answer,
                scores: t.scores as unknown as Record<string, unknown>,
              })),
            })
            try {
              sessionStorage.setItem(
                'ip_sprint_last_debrief',
                JSON.stringify(twin.debrief),
              )
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* debrief optional if unpaid / offline */
        }
      }
    } catch (e) {
      // Keep a local debrief so a report API blip doesn't wipe the session
      const allTurns = turnsRef.current
      const av = (key: keyof MockScore) => {
        if (!allTurns.length) return 0
        return Math.round(
          allTurns.reduce((a, t) => a + Number(t.scores[key] || 0), 0) / allTurns.length,
        )
      }
      const overall = av('overall')
      const grade =
        overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 60 ? 'D' : 'F'
      const local: MockReport = {
        overall,
        star_coverage: av('star_coverage'),
        technical_depth: av('technical_depth'),
        communication: av('communication'),
        confidence: av('confidence'),
        filler_count: allTurns.reduce((a, t) => a + t.scores.filler_count, 0),
        grade,
        summary: `Completed ${allTurns.length} answers (local debrief — report API failed: ${(e as Error).message}).`,
        top_strengths: allTurns.flatMap((t) => t.scores.strengths).slice(0, 4),
        top_improvements: allTurns.flatMap((t) => t.scores.improvements).slice(0, 4),
        practice_plan: ['Re-run this persona one difficulty higher', 'Practice STAR with one metric'],
        highlight_quotes: [],
        source: 'offline-local',
      }
      setReport(local)
      setPhase('report')
      setError(null)
      addSession({
        id: uid('sess'),
        persona: practicePersona,
        startedAt: startedAt.current || new Date().toISOString(),
        endedAt: new Date().toISOString(),
        questions: allTurns.length,
        fillerWords: local.filler_count,
        starCoverage: local.star_coverage,
        confidence: local.confidence,
        technicalDepth: local.technical_depth,
        notes: local.top_improvements.slice(0, 3),
        overall: local.overall,
        grade: local.grade,
        jobTitle,
        difficulty,
        focus,
      })
    } finally {
      setBusy(false)
    }
  }

  const resetAll = () => {
    speakGen.current += 1
    stopInterviewerSpeech()
    stopMic()
    stopTimers()
    setPracticeActive(false)
    setPhase('setup')
    setSetupTab(activePack ? 'ready' : setupTab)
    setActivePack(null)
    setQuestions([])
    setTurns([])
    setLastScore(null)
    setReport(null)
    setAnswerText('')
    setError(null)
    setTurnPhase('intro')
    setInterviewerLine('')
    setVoiceHint(null)
    setLevels(Array.from({ length: 32 }, () => 0.08))
  }

  const skipInterviewerSpeech = () => {
    stopInterviewerSpeech()
    if (turnPhase === 'intro' || turnPhase === 'asking') {
      setTurnPhase('answering')
      setVoiceHint('Your turn — answer out loud')
      startAnswerTimer()
      beginMicDictation()
    }
  }

  const exportReport = () => {
    if (!report) return
    const body = [
      `InterviewPulse Mock Report — ${jobTitle}`,
      `Grade: ${report.grade} (${report.overall}/100)`,
      `Persona: ${PERSONA_LABELS[practicePersona]} · ${difficulty} · ${focus}`,
      '',
      report.summary,
      '',
      'Strengths:',
      ...report.top_strengths.map((s) => `• ${s}`),
      '',
      'Improve:',
      ...report.top_improvements.map((s) => `• ${s}`),
      '',
      'Practice plan:',
      ...report.practice_plan.map((s, i) => `${i + 1}. ${s}`),
      '',
      `Fillers: ${report.filler_count} · STAR ${report.star_coverage}% · Depth ${report.technical_depth}%`,
    ].join('\n')
    void navigator.clipboard.writeText(body)
  }

  const mm = String(Math.floor(sessionElapsed / 60)).padStart(2, '0')
  const ss = String(sessionElapsed % 60).padStart(2, '0')

  // --- SETUP ---
  if (phase === 'setup') {
    const readyCat = getReadyMadeCategory(readyCategoryId)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <section className="glass relative overflow-hidden rounded-[28px] p-8 md:p-10">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5DD5E3]/40 to-transparent"
            aria-hidden
          />
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#20B8CD]/12">
              <Sparkles className="h-4 w-4 text-[#5DD5E3]" strokeWidth={1.75} />
            </span>
            <h2 className="text-[17px] font-medium tracking-tight text-white/95">
              Mock interviews
            </h2>
          </div>
          <p className="mb-6 max-w-xl text-[13px] leading-relaxed text-white/40">
            Pick a ready-made pack (SAP FICO Final 50), launch SAP BTP Odyssey, or
            build a custom mock.
          </p>

          {/* Featured: SAP BTP Odyssey learning game */}
          <button
            type="button"
            onClick={() => setRoute('btp-odyssey')}
            className="group mb-8 flex w-full items-start gap-4 rounded-[20px] border border-[#20B8CD]/30 bg-gradient-to-br from-[#20B8CD]/12 via-[#0a1520] to-transparent p-5 text-left transition hover:border-[#5DD5E3]/50 hover:shadow-[0_0_40px_rgba(32,184,205,0.12)]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#20B8CD]/18 ring-1 ring-[#20B8CD]/35">
              <Gamepad2
                className="h-6 w-6 text-[#5DD5E3] transition group-hover:scale-110"
                strokeWidth={1.75}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-medium tracking-tight text-white/95">
                  SAP BTP Odyssey
                </h3>
                <span className="rounded-full bg-[#20B8CD]/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#5DD5E3] ring-1 ring-[#20B8CD]/30">
                  New · under Mock
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                300+ sequenced challenges: Architect, Build, Operate, Debug, Defend.
                Concept cards with mnemonics, use cases, and design trade-offs — evidence-based
                mastery, no certification claims.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-[#5DD5E3]">
                Launch game
                <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </div>
          </button>

          {/* Setup tabs — Ready-made is default */}
          <div
            className="mb-8 flex flex-wrap gap-2 rounded-full bg-white/[0.04] p-1 ring-1 ring-white/[0.06]"
            role="tablist"
            aria-label="Mock type"
          >
            <button
              type="button"
              role="tab"
              aria-selected={setupTab === 'ready'}
              onClick={() => setSetupTab('ready')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium transition-colors ${
                setupTab === 'ready'
                  ? 'bg-[#20B8CD]/20 text-[#5DD5E3] ring-1 ring-[#20B8CD]/35'
                  : 'text-white/45 hover:text-white/75'
              }`}
            >
              <BookOpen className="h-4 w-4" strokeWidth={1.75} />
              Ready-made mocks
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={setupTab === 'custom'}
              onClick={() => setSetupTab('custom')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium transition-colors ${
                setupTab === 'custom'
                  ? 'bg-[#20B8CD]/20 text-[#5DD5E3] ring-1 ring-[#20B8CD]/35'
                  : 'text-white/45 hover:text-white/75'
              }`}
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              Custom mock
            </button>
          </div>

          {error && (
            <div
              className="mb-5 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]"
              role="alert"
            >
              {error}
            </div>
          )}

          {setupTab === 'ready' ? (
            <div className="space-y-6">
              <div>
                <span className="label-quiet">Category</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {READY_MADE_CATEGORIES.map((c) => (
                    <Button
                      key={c.id}
                      size="sm"
                      variant={readyCategoryId === c.id ? 'default' : 'secondary'}
                      onClick={() => setReadyCategoryId(c.id)}
                    >
                      {c.label}
                    </Button>
                  ))}
                </div>
                {readyCat && (
                  <p className="mt-2 text-[12px] leading-relaxed text-white/40">
                    {readyCat.description}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <span className="label-quiet">Packs · {readyCat?.label || '…'}</span>
                {(readyCat?.packs || []).map((pack) => (
                  <div
                    key={pack.id}
                    className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-medium text-white/95">{pack.title}</h3>
                        <p className="mt-1 text-[12px] text-white/45">{pack.subtitle}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Badge tone="indigo">{pack.question_count} Qs</Badge>
                          <Badge tone="default">{pack.difficulty}</Badge>
                          <Badge tone="emerald">{pack.job_title}</Badge>
                          {pack.tags.slice(0, 3).map((t) => (
                            <Badge key={t} tone="default">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="lg"
                        className="min-h-[44px]"
                        disabled={busy}
                        onClick={() => void startReadyMadePack(pack)}
                      >
                        {busy ? 'Starting…' : 'Start interactive mock'}
                      </Button>
                      {pack.audio_url && (
                        <Button
                          size="lg"
                          variant="secondary"
                          className="min-h-[44px]"
                          disabled={busy}
                          onClick={() => openPanelAudio(pack)}
                        >
                          <Headphones className="h-4 w-4" strokeWidth={1.75} />
                          Play panel audio
                        </Button>
                      )}
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-white/30">
                      Interactive: spoken questions one-by-one with scoring. Panel audio: full
                      Maya / Daniel / Marcus track (~32 min, 25s gaps).
                    </p>
                  </div>
                ))}
                {!readyCat?.packs?.length && (
                  <p className="text-[13px] text-white/40">No packs in this category yet.</p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="ip-label">Target role</span>
                  <input
                    className="ip-field mt-1.5"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Senior Backend Engineer"
                  />
                </label>
                <label>
                  <span className="ip-label">Company (optional)</span>
                  <input
                    className="ip-field mt-1.5"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Stripe"
                  />
                </label>
                <label>
                  <span className="ip-label">Questions</span>
                  <select
                    className="ip-field mt-1.5"
                    value={qCount}
                    onChange={(e) => setQCount(Number(e.target.value))}
                  >
                    {[3, 5, 7, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} questions
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="ip-label">Job description (optional)</span>
                  <textarea
                    className="ip-field mt-1.5 min-h-[100px] resize-y py-2.5"
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder="Paste JD bullets for tailored questions…"
                  />
                </label>
              </div>

              <div className="mt-6">
                <span className="label-quiet">Interviewer persona</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {personas.map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={practicePersona === p ? 'default' : 'secondary'}
                      onClick={() => setPracticePersona(p)}
                    >
                      {PERSONA_LABELS[p]}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <span className="label-quiet">Difficulty</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {difficulties.map((d) => (
                      <Button
                        key={d}
                        size="sm"
                        variant={difficulty === d ? 'default' : 'secondary'}
                        onClick={() => setDifficulty(d)}
                      >
                        {d}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="label-quiet">Focus</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {focuses.map((f) => (
                      <Button
                        key={f.id}
                        size="sm"
                        variant={focus === f.id ? 'default' : 'secondary'}
                        onClick={() => setFocus(f.id)}
                      >
                        {f.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex justify-between text-[12px] text-white/40">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Answer time limit
                  </span>
                  <span>{timeLimit}s</span>
                </div>
                <input
                  type="range"
                  min={45}
                  max={180}
                  step={15}
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(Number(e.target.value))}
                  className="w-full accent-[#20B8CD]"
                />
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  className="min-h-[48px] ip-cta-ready"
                  disabled={busy || !jobTitle.trim()}
                  onClick={() => void startSession()}
                >
                  {busy ? 'Building questions…' : 'Start mock interview'}
                </Button>
                {!jobTitle.trim() && (
                  <p className="w-full text-[12px] text-white/40">
                    Add a target role to start.
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <h3 className="mb-4 text-[15px] font-medium text-white/90">What you get</h3>
          <ul className="grid gap-3 text-[13px] text-white/50 sm:grid-cols-2">
            {[
              'Ready-made SAP FICO Final 50 panel bank',
              'Spoken interviewer intro + questions',
              'Optional full panel audio (25s gaps)',
              'Auto mic after each question',
              'STAR / depth / communication scores',
              'Spoken follow-ups like a real panel',
              'Model answer bullets after each Q',
              'End report with practice plan',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#20B8CD]" />
                {t}
              </li>
            ))}
          </ul>
        </section>
      </div>
    )
  }

  // --- PANEL AUDIO (ready-made full track) ---
  if (phase === 'audio' && activePack?.audio_url) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                {activePack.title}
              </h2>
              <p className="mt-1 text-[13px] text-white/40">
                Panel audio · {activePack.subtitle}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPhase('setup')
                setSetupTab('ready')
              }}
            >
              Back to packs
            </Button>
          </div>
          <p className="mb-5 text-[13px] leading-relaxed text-white/50">
            Full Maya / Daniel / Marcus track with ~25s silence after each question. Use headphones
            and answer out loud during the gaps — or switch to interactive for scored turns.
          </p>
          <audio
            className="w-full"
            controls
            preload="metadata"
            src={activePack.audio_url}
          >
            Your browser does not support audio playback.
          </audio>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              size="lg"
              disabled={busy}
              onClick={() => void startReadyMadePack(activePack)}
            >
              Start interactive mock instead
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPhase('setup')
                setSetupTab('ready')
              }}
            >
              <RotateCcw className="h-4 w-4" /> Choose another pack
            </Button>
          </div>
        </section>
      </div>
    )
  }

  // --- REPORT ---
  if (phase === 'report' && report) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                Session debrief
              </h2>
              <p className="mt-1 text-[13px] text-white/40">
                {jobTitle} · {PERSONA_LABELS[practicePersona]} · {difficulty}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[40px] font-medium tracking-tight text-[#20B8CD]">
                {report.grade}
              </div>
              <div className="text-[13px] text-white/45">{report.overall}/100</div>
            </div>
          </div>

          <p className="mb-8 text-[15px] leading-relaxed text-white/75">{report.summary}</p>

          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="STAR" value={`${report.star_coverage}%`} />
            <MiniStat label="Depth" value={`${report.technical_depth}%`} />
            <MiniStat label="Comm" value={`${report.communication}%`} />
            <MiniStat label="Fillers" value={String(report.filler_count)} warn />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 text-[13px] font-medium text-white/80">Strengths</h3>
              <ul className="space-y-2 text-[13px] text-white/55">
                {report.top_strengths.map((s) => (
                  <li key={s} className="rounded-[14px] glass-inset px-4 py-3">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-3 text-[13px] font-medium text-white/80">Improve</h3>
              <ul className="space-y-2 text-[13px] text-white/55">
                {report.top_improvements.map((s) => (
                  <li key={s} className="rounded-[14px] glass-inset px-4 py-3">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-8">
            <h3 className="mb-3 text-[13px] font-medium text-white/80">Practice plan</h3>
            <ol className="list-decimal space-y-2 pl-5 text-[13px] text-white/55">
              {report.practice_plan.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>

          {report.highlight_quotes.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 text-[13px] font-medium text-white/80">Highlights</h3>
              {report.highlight_quotes.map((q) => (
                <blockquote
                  key={q}
                  className="mb-2 border-l-2 border-[#20B8CD]/40 pl-4 text-[13px] italic text-white/50"
                >
                  {q}
                </blockquote>
              ))}
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={resetAll}>
              <RotateCcw className="h-4 w-4" /> New mock
            </Button>
            <Button size="lg" variant="secondary" onClick={exportReport}>
              Copy report
            </Button>
          </div>
          <p className="mt-4 text-[11px] text-white/30">Coach source: {report.source}</p>
        </section>
      </div>
    )
  }

  // --- LIVE ---
  return (
    <div className="grid gap-8 xl:grid-cols-12 xl:gap-10">
      <div className="flex flex-col gap-6 xl:col-span-7">
        <section className="glass rounded-[28px] p-7 md:p-9">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                {followUpMode
                  ? 'Follow-up'
                  : turnPhase === 'intro'
                    ? 'Interview opening'
                    : 'Live mock interview'}
              </h2>
              <p className="mt-1 text-[12px] text-white/40">
                Q {Math.min(qIndex + 1, Math.max(1, questions.length))}/{questions.length} ·{' '}
                {jobTitle} · audio · {source || '…'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  interviewerTalking
                    ? 'indigo'
                    : turnPhase === 'answering'
                      ? 'emerald'
                      : timeLeft <= 15
                        ? 'amber'
                        : 'default'
                }
              >
                {interviewerTalking
                  ? 'Interviewer'
                  : turnPhase === 'answering'
                    ? 'Your turn'
                    : turnPhase === 'feedback'
                      ? 'Feedback'
                      : 'Idle'}
              </Badge>
              <Badge tone={timeLeft <= 15 && turnPhase === 'answering' ? 'amber' : 'indigo'}>
                <Clock className="mr-1 h-3 w-3" />
                {timeLeft}s
              </Badge>
              <Badge tone={practiceActive ? 'emerald' : 'default'}>
                {mm}:{ss}
              </Badge>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
              {error}
            </div>
          )}

          {(voiceHint || interviewerLine) && (
            <div
              className={`mb-4 rounded-[14px] border px-4 py-3 text-[13px] ${
                interviewerTalking
                  ? 'border-[#20B8CD]/35 bg-[#20B8CD]/10 text-[#5DD5E3]'
                  : 'border-white/10 bg-white/[0.03] text-white/55'
              }`}
            >
              {voiceHint && <p className="mb-1 text-[11px] uppercase tracking-wide opacity-80">{voiceHint}</p>}
              {interviewerLine && (
                <p className="leading-relaxed text-white/85">“{interviewerLine}”</p>
              )}
              {interviewerTalking && (
                <button
                  type="button"
                  className="mt-2 text-[12px] text-[#20B8CD] underline-offset-2 hover:underline"
                  onClick={skipInterviewerSpeech}
                >
                  Skip speech → my turn
                </button>
              )}
            </div>
          )}

          <div className="mb-5 rounded-[22px] glass-inset px-6 py-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[12px] text-white/35">{PERSONA_LABELS[practicePersona]}</p>
              {currentQ?.category && (
                <Badge tone="default">{currentQ.category}</Badge>
              )}
            </div>
            <p className="text-[19px] font-light leading-snug tracking-tight text-white/95 md:text-[21px]">
              {currentQ?.text || (turnPhase === 'intro' ? 'Listen to the interviewer…' : '…')}
            </p>
            {currentQ?.hint && turnPhase === 'answering' && (
              <p className="mt-3 flex items-start gap-2 text-[12px] text-white/40">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#E8C547]" />
                {currentQ.hint}
              </p>
            )}
            <div className="mt-6">
              <Waveform
                levels={levels}
                active={practiceActive || interviewerTalking || listeningMic}
                className="h-12"
              />
            </div>
          </div>

          <label className="mb-3 block">
            <span className="label-quiet">Your answer (speak — mic opens after each question)</span>
            <textarea
              className="field min-h-[140px] resize-y text-[15px] leading-relaxed"
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              placeholder={
                interviewerTalking
                  ? 'Interviewer is speaking… your mic opens next'
                  : listeningMic
                    ? 'Listening… keep talking, words appear after short pauses'
                    : 'Answer out loud or type here…'
              }
              disabled={!!lastScore || interviewerTalking}
            />
          </label>
          <div className="mb-5 flex flex-wrap items-center gap-3 text-[12px] text-white/40">
            <span>Words: {answerText.trim() ? answerText.trim().split(/\s+/).length : 0}</span>
            <span className={localFillers > 3 ? 'text-[#E8C547]' : ''}>
              Live fillers ≈ {localFillers}
            </span>
            {listeningMic && dictateStatus && (
              <span className="text-[#20B8CD]">{dictateStatus}</span>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {!lastScore ? (
              <>
                <Button
                  size="lg"
                  variant={listeningMic ? 'danger' : 'secondary'}
                  onClick={toggleMic}
                  disabled={busy || interviewerTalking}
                >
                  {listeningMic ? (
                    <>
                      <MicOff className="h-4 w-4" /> Stop mic
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4" /> Start mic
                    </>
                  )}
                </Button>
                <Button
                  size="lg"
                  disabled={busy || !answerText.trim() || interviewerTalking}
                  onClick={() => void submitAnswer()}
                >
                  {busy ? 'Scoring…' : 'Submit answer'}
                </Button>
                <Button size="lg" variant="ghost" onClick={() => void finishSession()}>
                  <Square className="h-4 w-4" /> End early
                </Button>
              </>
            ) : (
              <>
                {lastScore.follow_up && (
                  <Button size="lg" variant="secondary" onClick={askFollowUp}>
                    Hear follow-up
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                <Button size="lg" onClick={goNext}>
                  {qIndex + 1 >= questions.length ? 'Finish & report' : 'Next question'}
                </Button>
              </>
            )}
          </div>
        </section>

        {lastScore && showModel && (
          <section className="glass rounded-[28px] p-7 md:p-9">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-medium text-white/95">Model answer sketch</h2>
              <button
                type="button"
                className="text-[12px] text-white/40 hover:text-white/70"
                onClick={() => setShowModel(false)}
              >
                Hide
              </button>
            </div>
            <ul className="space-y-2">
              {lastScore.model_answer_bullets.map((b) => (
                <li
                  key={b}
                  className="rounded-[16px] glass-inset px-4 py-3 text-[14px] leading-relaxed text-white/80"
                >
                  {b}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] text-white/40">{lastScore.coach_note}</p>
          </section>
        )}
      </div>

      <div className="flex flex-col gap-6 xl:col-span-5">
        <section className="glass rounded-[28px] p-7 md:p-9">
          <h2 className="text-[16px] font-medium text-white/95">Live scores</h2>
          <p className="mt-1 mb-6 text-[12px] text-white/40">
            {lastScore ? `Overall ${lastScore.overall}/100` : 'Submit to score this answer'}
          </p>
          <Meter label="Confidence" value={liveFeedback.confidence} color="#20B8CD" />
          <Meter label="STAR coverage" value={liveFeedback.starCoverage} color="#20B8CD" />
          <Meter label="Technical depth" value={liveFeedback.technicalDepth} color="#5DD5E3" />
          {lastScore && (
            <Meter label="Communication" value={lastScore.communication} color="#8A8A88" />
          )}
          <div className="mt-5 rounded-[18px] glass-inset px-5 py-4">
            <div className="text-[12px] text-white/35">Filler words (scored)</div>
            <div className="mt-1 text-[28px] font-medium tracking-tight text-[#E8C547]">
              {lastScore?.filler_count ?? liveFeedback.fillerWords}
            </div>
          </div>
        </section>

        {lastScore && (
          <section className="glass rounded-[28px] p-7 md:p-9">
            <h2 className="mb-4 text-[16px] font-medium text-white/95">Coach notes</h2>
            <div className="mb-4">
              <p className="mb-2 text-[11px] uppercase tracking-tight text-white/35">Strengths</p>
              <ul className="space-y-2 text-[13px] text-white/70">
                {lastScore.strengths.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-tight text-white/35">Improve</p>
              <ul className="space-y-2 text-[13px] text-white/70">
                {lastScore.improvements.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            </div>
            {lastScore.follow_up && (
              <p className="mt-4 rounded-[14px] border border-[#20B8CD]/25 bg-[#20B8CD]/10 px-4 py-3 text-[12px] text-[#5DD5E3]">
                Follow-up ready: {lastScore.follow_up}
              </p>
            )}
          </section>
        )}

        <section className="glass rounded-[28px] p-7 md:p-9">
          <h2 className="mb-3 text-[16px] font-medium text-white/95">Session tips</h2>
          <ul className="space-y-2 text-[13px] text-white/50">
            {(tips.length ? tips : ['Stay concise', 'Use metrics', 'Pause instead of fillers']).map(
              (t) => (
                <li key={t}>• {t}</li>
              ),
            )}
          </ul>
          <p className="mt-4 text-[11px] text-white/30">
            Completed turns: {turns.length}
          </p>
        </section>
      </div>
    </div>
  )
}

function Meter({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex justify-between text-[12px] text-white/40">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, value)}%`, background: color }}
        />
      </div>
    </div>
  )
}

function MiniStat({
  label,
  value,
  warn,
}: {
  label: string
  value: string
  warn?: boolean
}) {
  return (
    <div className="rounded-[16px] glass-inset px-4 py-3">
      <div className="text-[11px] text-white/35">{label}</div>
      <div
        className={`mt-1 text-[20px] font-medium tracking-tight ${
          warn ? 'text-[#E8C547]' : 'text-white/90'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
