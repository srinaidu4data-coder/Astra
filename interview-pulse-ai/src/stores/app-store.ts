import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEMO_ANALYTICS, DEMO_MEMORIES, DEMO_SESSIONS } from '@/lib/demo-data'
import {
  fetchAuthConfig,
  fetchMe,
  getToken,
  setToken,
  type AuthConfig,
  type AuthUser,
} from '@/services/auth'
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

  /** Auth / billing gate */
  authReady: boolean
  authConfig: AuthConfig | null
  user: AuthUser | null
  authToken: string | null
  setAuth: (p: { user: AuthUser; token: string }) => void
  setAuthFromUser: (user: AuthUser) => void
  clearAuth: () => void
  refreshAuth: () => Promise<void>
  bootstrapAuth: () => Promise<void>

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
    (set, get) => ({
      route: 'copilot',
      setRoute: (route) => set({ route }),

      authReady: false,
      authConfig: null,
      user: null,
      authToken: getToken(),
      setAuth: ({ user, token }) => {
        setToken(token)
        set({ user, authToken: token })
      },
      setAuthFromUser: (user) => {
        set({
          user: {
            ...user,
            subscription_active: Boolean(user.subscription_active),
          },
        })
      },
      clearAuth: () => {
        setToken(null)
        set({ user: null, authToken: null })
      },
      refreshAuth: async () => {
        const me = await fetchMe()
        if (!me) {
          set({ user: null, authToken: null })
          return
        }
        set({
          user: { ...me.user, subscription_active: me.subscription_active },
          authToken: getToken(),
        })
      },
      bootstrapAuth: async () => {
        const config = await fetchAuthConfig()
        set({ authConfig: config })
        if (getToken()) {
          try {
            const me = await fetchMe()
            if (me) {
              set({
                user: { ...me.user, subscription_active: me.subscription_active },
                authToken: getToken(),
              })
            } else {
              set({ user: null, authToken: null })
            }
          } catch {
            set({ user: null })
          }
        }
        set({ authReady: true })
      },

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
        set((s) => ({ documents: [d, ...s.documents].slice(0, 80) })),
      removeDocument: (id) =>
        set((s) => {
          const doomed = s.documents.find((d) => d.id === id)
          const docs = s.documents.filter((d) => d.id !== id)
          const memories = doomed
            ? s.memories.filter((m) => m.sourceFile !== doomed.name)
            : s.memories
          return {
            documents: docs,
            // If nothing left from user uploads, restore demo memories
            memories:
              docs.filter((d) => d.type !== 'job').length === 0
                ? DEMO_MEMORIES
                : memories.length
                  ? memories
                  : DEMO_MEMORIES,
          }
        }),
      memories: DEMO_MEMORIES,
      setMemories: (memories) => set({ memories }),
      addMemories: (m) =>
        set((s) => {
          // Drop demo memories (no sourceFile) once the user uploads real docs
          const keep = s.memories.filter((x) => Boolean(x.sourceFile))
          return { memories: [...m, ...keep].slice(0, 200) }
        }),
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
