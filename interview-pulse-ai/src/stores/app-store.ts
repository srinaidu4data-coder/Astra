import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEMO_ANALYTICS, DEMO_MEMORIES, DEMO_SESSIONS } from '@/lib/demo-data'
import { publishLiveSync } from '@/lib/window-sync'
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

/** throttle for level→overlay bridge */
let _levelsSyncAt = 0

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
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
        set((s) => {
          const nextUser = {
            ...user,
            subscription_active: Boolean(user.subscription_active),
            is_admin: Boolean(user.is_admin),
          }
          // Drop admin route if user lost admin access
          const route =
            s.route === 'admin' && !nextUser.is_admin ? 'copilot' : s.route
          return { user: nextUser, route }
        })
      },
      clearAuth: () => {
        setToken(null)
        set({ user: null, authToken: null })
      },
      refreshAuth: async () => {
        const me = await fetchMe()
        if (!me) {
          setToken(null)
          set({ user: null, authToken: null })
          return
        }
        set({
          user: { ...me.user, subscription_active: me.subscription_active },
          authToken: getToken(),
        })
      },
      bootstrapAuth: async () => {
        try {
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
                setToken(null)
                set({ user: null, authToken: null })
              }
            } catch {
              set({ user: null })
            }
          }
        } catch {
          /* keep defaults */
        } finally {
          set({ authReady: true })
        }
      },

      settings: {
        openaiKey: '',
        deepgramKey: '',
        anthropicKey: '',
        demoMode: false,
        jobContext: 'Senior Full-Stack Engineer',
        tone: 'confident',
        // Speakers only by default — never mic (your answers must not be STT'd)
        audioSource: 'auto' as const,
      },
      updateSettings: (p) =>
        set((s) => {
          const next = { ...s.settings, ...p }
          // Keep resolveInterviewAudioSource() in sync for any callers
          if (p.audioSource) {
            try {
              if (p.audioSource === 'auto') {
                localStorage.removeItem('ip_audio_source')
              } else {
                localStorage.setItem('ip_audio_source', p.audioSource)
              }
            } catch {
              /* ignore */
            }
          }
          return { settings: next }
        }),

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
      setListening: (listening) => {
        set({ listening })
        // Overlay is a separate Electron window — push listening flag
        try {
          const s = useAppStore.getState()
          publishLiveSync({
            listening,
            answer: s.answer,
            levels: s.levels,
            answerMode: s.answerMode,
          })
        } catch {
          /* ignore */
        }
      },
      levels: Array.from({ length: 24 }, () => 0.08),
      setLevels: (levels) => {
        set({ levels })
        // Throttle level bridge (~8/s) so we don't flood IPC with full answer blobs
        const now = Date.now()
        if (now - (_levelsSyncAt || 0) < 120) return
        _levelsSyncAt = now
        try {
          const s = useAppStore.getState()
          publishLiveSync({
            levels,
            answer: s.answer,
            listening: s.listening,
            answerMode: s.answerMode,
          })
        } catch {
          /* ignore */
        }
      },

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
      // Always start empty — user types the real target role (no demo placeholder)
      activeJobTitle: '',
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
      clearTranscript: () => {
        set({ transcript: [], answer: null })
        try {
          const s = useAppStore.getState()
          publishLiveSync({
            answer: null,
            listening: s.listening,
            levels: s.levels,
            answerMode: s.answerMode,
          })
        } catch {
          /* ignore */
        }
      },

      answer: null,
      setAnswer: (answer) => {
        set({ answer })
        // Critical: overlay window has its own React heap — must bridge answers
        try {
          const s = useAppStore.getState()
          publishLiveSync({
            answer,
            listening: s.listening,
            levels: s.levels,
            answerMode: s.answerMode,
          })
        } catch {
          /* ignore */
        }
      },
      answerMode: 'star',
      setAnswerMode: (answerMode) => {
        set({ answerMode })
        try {
          const s = useAppStore.getState()
          publishLiveSync({
            answerMode,
            answer: s.answer,
            listening: s.listening,
            levels: s.levels,
          })
        } catch {
          /* ignore */
        }
      },

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
      // Drop the old demo job title so Knowledge "Job match" stays blank
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<typeof current> & {
          activeJobTitle?: string
        }
        const demoTitles = new Set([
          'Staff Frontend / AI Copilot Engineer',
          'Staff Frontend / AI Copilot Engineer ',
        ])
        const title = (p.activeJobTitle || '').trim()
        return {
          ...current,
          ...p,
          activeJobTitle:
            !title || demoTitles.has(title) ? '' : p.activeJobTitle || '',
        }
      },
    },
  ),
)
