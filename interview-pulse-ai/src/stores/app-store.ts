import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEMO_ANALYTICS, DEMO_MEMORIES, DEMO_SESSIONS } from '@/lib/demo-data'
import type {
  AnalyticsPoint,
  AnswerMode,
  AppSettings,
  AudioDeviceInfo,
  InterviewerPersona,
  JobMatch,
  NavRoute,
  PipelineMetrics,
  PracticeSession,
  ResumeDocument,
  StarMemory,
  StealthSettings,
  SuggestedAnswer,
  TranscriptLine,
} from '@/types'

interface AppState {
  route: NavRoute
  setRoute: (r: NavRoute) => void

  settings: AppSettings
  updateSettings: (p: Partial<AppSettings>) => void

  stealth: StealthSettings
  updateStealth: (p: Partial<StealthSettings>) => void

  listening: boolean
  setListening: (v: boolean) => void
  levels: number[]
  setLevels: (l: number[]) => void

  devices: AudioDeviceInfo[]
  setDevices: (d: AudioDeviceInfo[]) => void
  inputDeviceId: string
  setInputDeviceId: (id: string) => void

  documents: ResumeDocument[]
  addDocument: (d: ResumeDocument) => void
  removeDocument: (id: string) => void
  memories: StarMemory[]
  setMemories: (m: StarMemory[]) => void
  addMemories: (m: StarMemory[]) => void
  jobMatch: JobMatch | null
  setJobMatch: (j: JobMatch | null) => void
  activeJobTitle: string
  setActiveJobTitle: (t: string) => void

  transcript: TranscriptLine[]
  pushTranscript: (line: TranscriptLine) => void
  clearTranscript: () => void

  answer: SuggestedAnswer | null
  setAnswer: (a: SuggestedAnswer | null) => void
  answerMode: AnswerMode
  setAnswerMode: (m: AnswerMode) => void

  metrics: PipelineMetrics | null
  setMetrics: (m: PipelineMetrics) => void

  practicePersona: InterviewerPersona
  setPracticePersona: (p: InterviewerPersona) => void
  practiceActive: boolean
  setPracticeActive: (v: boolean) => void
  sessions: PracticeSession[]
  addSession: (s: PracticeSession) => void
  liveFeedback: {
    confidence: number
    fillerWords: number
    starCoverage: number
    technicalDepth: number
  }
  setLiveFeedback: (p: Partial<AppState['liveFeedback']>) => void

  analytics: AnalyticsPoint[]
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      route: 'copilot',
      setRoute: (route) => set({ route }),

      settings: {
        openaiKey: '',
        deepgramKey: '',
        anthropicKey: '',
        demoMode: false,
        jobContext: 'Senior Full-Stack Engineer',
        tone: 'confident',
      },
      updateSettings: (p) =>
        set((s) => ({ settings: { ...s.settings, ...p } })),

      stealth: {
        contentProtection: true,
        alwaysOnTop: true,
        opacity: 0.92,
        clickThrough: false,
        hotkey: 'Ctrl+Shift+S',
      },
      updateStealth: (p) =>
        set((s) => ({ stealth: { ...s.stealth, ...p } })),

      listening: false,
      setListening: (listening) => set({ listening }),
      levels: Array.from({ length: 24 }, () => 0.08),
      setLevels: (levels) => set({ levels }),

      devices: [],
      setDevices: (devices) => set({ devices }),
      inputDeviceId: '',
      setInputDeviceId: (inputDeviceId) => set({ inputDeviceId }),

      documents: [],
      addDocument: (d) =>
        set((s) => ({ documents: [d, ...s.documents].slice(0, 40) })),
      removeDocument: (id) =>
        set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })),
      memories: DEMO_MEMORIES,
      setMemories: (memories) => set({ memories }),
      addMemories: (m) =>
        set((s) => ({ memories: [...m, ...s.memories].slice(0, 80) })),
      jobMatch: null,
      setJobMatch: (jobMatch) => set({ jobMatch }),
      activeJobTitle: 'Staff Frontend / AI Copilot Engineer',
      setActiveJobTitle: (activeJobTitle) => set({ activeJobTitle }),

      transcript: [],
      pushTranscript: (line) =>
        set((s) => {
          const idx = s.transcript.findIndex((t) => t.id === line.id)
          if (idx >= 0) {
            const next = [...s.transcript]
            next[idx] = line
            return { transcript: next }
          }
          return { transcript: [...s.transcript, line].slice(-40) }
        }),
      clearTranscript: () => set({ transcript: [], answer: null }),

      answer: null,
      setAnswer: (answer) => set({ answer }),
      answerMode: 'star',
      setAnswerMode: (answerMode) => set({ answerMode }),

      metrics: null,
      setMetrics: (metrics) => set({ metrics }),

      practicePersona: 'strict-tech-lead',
      setPracticePersona: (practicePersona) => set({ practicePersona }),
      practiceActive: false,
      setPracticeActive: (practiceActive) => set({ practiceActive }),
      sessions: DEMO_SESSIONS,
      addSession: (session) =>
        set((s) => ({ sessions: [session, ...s.sessions].slice(0, 30) })),
      liveFeedback: {
        confidence: 72,
        fillerWords: 0,
        starCoverage: 64,
        technicalDepth: 70,
      },
      setLiveFeedback: (p) =>
        set((s) => ({ liveFeedback: { ...s.liveFeedback, ...p } })),

      analytics: DEMO_ANALYTICS,
    }),
    {
      name: 'interview-pulse-ai',
      partialize: (s) => ({
        settings: s.settings,
        stealth: s.stealth,
        documents: s.documents,
        memories: s.memories,
        activeJobTitle: s.activeJobTitle,
        sessions: s.sessions,
        answerMode: s.answerMode,
      }),
    },
  ),
)
