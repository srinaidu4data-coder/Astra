import { Waveform } from '@/components/Waveform'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PERSONA_LABELS, SAMPLE_QUESTIONS } from '@/lib/demo-data'
import { uid } from '@/lib/utils'
import { pipeline } from '@/services/pipeline'
import { useAppStore } from '@/stores/app-store'
import type { InterviewerPersona } from '@/types'
import { Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const personas: InterviewerPersona[] = [
  'strict-tech-lead',
  'behavioral-hr',
  'system-design',
  'friendly-recruiter',
]

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
    pushTranscript,
    setAnswer,
    transcript,
    answer,
    memories,
    clearTranscript,
  } = useAppStore()

  const [elapsed, setElapsed] = useState(0)
  const [currentQ, setCurrentQ] = useState(SAMPLE_QUESTIONS[0])
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const waveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef<string>('')

  useEffect(() => {
    pipeline.setMemories(memories)
  }, [memories])

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      if (waveRef.current) clearInterval(waveRef.current)
      pipeline.stop()
    }
  }, [])

  const start = async () => {
    clearTranscript()
    setAnswer(null)
    setPracticeActive(true)
    startedAt.current = new Date().toISOString()
    setElapsed(0)
    setLiveFeedback({ confidence: 70, fillerWords: 0, starCoverage: 55, technicalDepth: 65 })

    let seconds = 0
    const persona = practicePersona
    tickRef.current = setInterval(() => {
      seconds += 1
      setElapsed(seconds)
      setLiveFeedback({
        confidence: Math.min(98, 68 + Math.random() * 25),
        fillerWords: Math.floor(seconds / 18 + Math.random() * 2),
        starCoverage: Math.min(98, 50 + seconds * 0.6 + Math.random() * 8),
        technicalDepth:
          persona === 'behavioral-hr' ? 45 + Math.random() * 20 : 70 + Math.random() * 25,
      })
    }, 1000)

    waveRef.current = setInterval(() => {
      setLevels(Array.from({ length: 32 }, () => 0.12 + Math.random() * 0.75))
    }, 90)

    const q = SAMPLE_QUESTIONS[Math.floor(Math.random() * SAMPLE_QUESTIONS.length)]
    setCurrentQ(q)
    await pipeline.injectQuestion(q, {
      onTranscript: pushTranscript,
      onAnswerDelta: setAnswer,
      onAnswerDone: setAnswer,
    })
  }

  const nextQuestion = async () => {
    const q = SAMPLE_QUESTIONS[Math.floor(Math.random() * SAMPLE_QUESTIONS.length)]
    setCurrentQ(q)
    await pipeline.injectQuestion(q, {
      onTranscript: pushTranscript,
      onAnswerDelta: setAnswer,
      onAnswerDone: setAnswer,
    })
  }

  const stop = () => {
    setPracticeActive(false)
    pipeline.stop()
    if (tickRef.current) clearInterval(tickRef.current)
    if (waveRef.current) clearInterval(waveRef.current)
    setLevels(Array.from({ length: 32 }, () => 0.08))

    addSession({
      id: uid('sess'),
      persona: practicePersona,
      startedAt: startedAt.current || new Date().toISOString(),
      endedAt: new Date().toISOString(),
      questions: Math.max(1, transcript.filter((t) => t.final).length),
      fillerWords: liveFeedback.fillerWords,
      starCoverage: Math.round(liveFeedback.starCoverage),
      confidence: Math.round(liveFeedback.confidence),
      technicalDepth: Math.round(liveFeedback.technicalDepth),
      notes: [
        liveFeedback.starCoverage > 80 ? 'Strong STAR structure' : 'Expand Result metrics',
        liveFeedback.fillerWords > 10 ? 'Reduce filler words' : 'Clean delivery',
      ],
    })
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="grid gap-10 xl:grid-cols-12 xl:gap-12">
      <div className="flex flex-col gap-8 xl:col-span-7">
        <section className="glass rounded-[28px] p-8 md:p-10">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                Mock interview
              </h2>
              <p className="mt-1 text-[13px] text-white/40">Pick a persona and practice</p>
            </div>
            <Badge tone={practiceActive ? 'emerald' : 'default'}>{mm}:{ss}</Badge>
          </div>

          <div className="mb-8 flex flex-wrap gap-2">
            {personas.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={practicePersona === p ? 'default' : 'secondary'}
                onClick={() => setPracticePersona(p)}
                disabled={practiceActive}
              >
                {PERSONA_LABELS[p]}
              </Button>
            ))}
          </div>

          <div className="mb-8 rounded-[24px] glass-inset px-7 py-8">
            <p className="mb-3 text-[12px] font-light text-white/35">
              {PERSONA_LABELS[practicePersona]}
            </p>
            <p className="text-[20px] font-light leading-snug tracking-tight text-white/95 md:text-[22px]">
              {currentQ}
            </p>
            <div className="mt-8">
              <Waveform levels={levels} active={practiceActive} className="h-14" />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {!practiceActive ? (
              <Button size="lg" onClick={() => void start()}>
                Start session
              </Button>
            ) : (
              <>
                <Button size="lg" variant="secondary" onClick={() => void nextQuestion()}>
                  Next question
                </Button>
                <Button size="lg" variant="danger" onClick={stop}>
                  <Square className="h-4 w-4" strokeWidth={1.75} /> End
                </Button>
              </>
            )}
          </div>
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <h2 className="mb-6 text-[17px] font-medium tracking-tight text-white/95">
            Coach notes
          </h2>
          {answer ? (
            <ul className="space-y-3">
              {answer.bullets.map((b, i) => (
                <li
                  key={i}
                  className="rounded-[18px] glass-inset px-5 py-4 text-[15px] leading-relaxed text-white/88"
                >
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-[14px] text-white/35">
              Start a session for live coaching.
            </p>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-8 xl:col-span-5">
        <section className="glass rounded-[28px] p-8 md:p-10">
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">
            Feedback
          </h2>
          <p className="mt-1 mb-8 text-[13px] text-white/40">Live session meters</p>
          <Meter label="Confidence" value={liveFeedback.confidence} color="#20B8CD" />
          <Meter label="STAR coverage" value={liveFeedback.starCoverage} color="#20B8CD" />
          <Meter label="Technical depth" value={liveFeedback.technicalDepth} color="#5DD5E3" />
          <div className="mt-6 rounded-[20px] glass-inset px-5 py-5">
            <div className="text-[12px] text-white/35">Filler words</div>
            <div className="mt-1 text-[32px] font-medium tracking-tight text-[#E8C547]">
              {liveFeedback.fillerWords}
            </div>
          </div>
        </section>

        <section className="glass rounded-[28px] p-8 md:p-10">
          <h2 className="mb-6 text-[17px] font-medium tracking-tight text-white/95">
            Tips
          </h2>
          <ul className="space-y-4 text-[14px] leading-relaxed text-white/55">
            <li>Open with Situation in one breath</li>
            <li>Quantify Result with a clear metric</li>
            <li>Pause instead of filler words</li>
            <li>Mirror language from the job description</li>
          </ul>
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
    <div className="mb-5">
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
