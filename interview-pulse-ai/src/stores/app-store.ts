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

  /**
   * Copilot "Hide" focus mode: answer panel goes full width,
   * app sidebar collapses to icons, page shell max-width lifts.
   */
  copilotWideAnswer: boolean
  setCopilotWideAnswer: (v: boolean) => void

  /** Materials accordion open on Interview (also used when redirecting from old Knowledge route) */
  materialsOpen: boolean
  setMaterialsOpen: (v: boolean) => void

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
  /**
   * Wipe Knowledge uploads, STAR memory chunks, job match, role, and server pack.
   * Call on every new login / account switch / Sign out / Clear on Knowledge page.
   */
  clearKnowledgeContext: () => void
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
      route: 'sprint',
      setRoute: (route) => {
        // Legacy Knowledge tab → Interview with Materials open (no feature lost)
        if (route === 'knowledge') {
          set({
            route: 'copilot',
            materialsOpen: true,
            copilotWideAnswer: false,
          })
          return
        }
        // Leaving copilot ends wide-answer focus so other pages keep normal chrome
        set((s) => ({
          route,
          copilotWideAnswer: route === 'copilot' ? s.copilotWideAnswer : false,
        }))
      },
      copilotWideAnswer: (() => {
        try {
          return localStorage.getItem('ip_copilot_left_collapsed') === '1'
        } catch {
          return false
        }
      })(),
      setCopilotWideAnswer: (copilotWideAnswer) => {
        try {
          localStorage.setItem(
            'ip_copilot_left_collapsed',
            copilotWideAnswer ? '1' : '0',
          )
        } catch {
          /* ignore */
        }
        set({ copilotWideAnswer })
      },
      materialsOpen: false,
      setMaterialsOpen: (materialsOpen) => set({ materialsOpen }),

      authReady: false,
      authConfig: null,
      user: null,
      authToken: getToken(),
      setAuth: ({ user, token }) => {
        setToken(token)
        const prevId =
          useAppStore.getState().user?.id || useAppStore.getState().user?.email
        const nextId = user?.id || user?.email
        // Always wipe knowledge on login / account switch (never carry STAR chunks)
        const switched = Boolean(
          prevId && nextId && String(prevId) !== String(nextId),
        )
        const clearIdentity = !prevId || switched
        try {
          if (nextId) sessionStorage.setItem('ip_auth_identity', String(nextId))
        } catch {
          /* ignore */
        }
        set({
          user,
          authToken: token,
          ...(clearIdentity
            ? {
                activeJobTitle: '',
                settings: {
                  ...useAppStore.getState().settings,
                  jobContext: '',
                },
                documents: [],
                memories: [],
                jobMatch: null,
                sessions: [],
                answer: null,
                transcript: [],
              }
            : {}),
        })
        if (clearIdentity) {
          try {
            void import('@/services/pipeline').then((m) =>
              m.pipeline.setMemories([]),
            )
          } catch {
            /* ignore */
          }
          void import('@/services/real-api')
            .then((m) => m.fullSessionReset())
            .catch(() => {})
        }
      },
      setAuthFromUser: (user) => {
        set((s) => {
          const nextUser = {
            ...user,
            subscription_active: Boolean(user.subscription_active),
            is_admin: Boolean(user.is_admin),
          }
          const route =
            s.route === 'admin' && !nextUser.is_admin ? 'copilot' : s.route
          const prevId = s.user?.id || s.user?.email
          const nextId = nextUser.id || nextUser.email
          let stored = ''
          try {
            stored = sessionStorage.getItem('ip_auth_identity') || ''
          } catch {
            stored = ''
          }
          const switched =
            Boolean(prevId && nextId && String(prevId) !== String(nextId)) ||
            Boolean(stored && nextId && stored !== String(nextId))
          if (nextId) {
            try {
              sessionStorage.setItem('ip_auth_identity', String(nextId))
            } catch {
              /* ignore */
            }
          }
          if (switched) {
            void import('@/services/real-api')
              .then((m) => m.fullSessionReset())
              .catch(() => {})
            void import('@/services/pipeline')
              .then((m) => m.pipeline.setMemories([]))
              .catch(() => {})
            return {
              user: nextUser,
              route,
              activeJobTitle: '',
              settings: { ...s.settings, jobContext: '' },
              documents: [],
              memories: [],
              jobMatch: null,
              sessions: [],
              answer: null,
              transcript: [],
            }
          }
          return { user: nextUser, route }
        })
      },
      clearAuth: () => {
        setToken(null)
        try {
          sessionStorage.removeItem('ip_auth_identity')
        } catch {
          /* ignore */
        }
        void import('@/services/real-api')
          .then((m) => m.fullSessionReset())
          .catch(() => {})
        void import('@/services/pipeline')
          .then((m) => m.pipeline.setMemories([]))
          .catch(() => {})
        set({
          user: null,
          authToken: null,
          activeJobTitle: '',
          settings: {
            ...useAppStore.getState().settings,
            jobContext: '',
          },
          documents: [],
          memories: [],
          jobMatch: null,
          sessions: [],
          answer: null,
          transcript: [],
        })
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
                const nextId = me.user?.id || me.user?.email || ''
                let stored = ''
                try {
                  stored = sessionStorage.getItem('ip_auth_identity') || ''
                } catch {
                  stored = ''
                }
                // Different account than last session in this tab → wipe knowledge
                if (stored && nextId && stored !== String(nextId)) {
                  useAppStore.getState().clearKnowledgeContext()
                }
                if (nextId) {
                  try {
                    sessionStorage.setItem('ip_auth_identity', String(nextId))
                  } catch {
                    /* ignore */
                  }
                }
                set({
                  user: {
                    ...me.user,
                    subscription_active: me.subscription_active,
                  },
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
        // Empty until the user types a role — no baked-in placeholder title
        jobContext: '',
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
        // Skip no-op — was re-publishing overlay state every status tick
        if (useAppStore.getState().listening === listening) return
        set({ listening })
        try {
          publishLiveSync({
            listening,
            levels: useAppStore.getState().levels,
            answerMode: useAppStore.getState().answerMode,
          })
        } catch {
          /* ignore */
        }
      },
      levels: Array.from({ length: 16 }, () => 0.08),
      setLevels: (levels) => {
        // Idle/reset bars (all near floor) always apply so Stop doesn't stick mid-wave
        const isIdle = levels.every((v) => v <= 0.12)
        const now = Date.now()
        // Throttle live activity writes (~4/s) — waveform is isolated via selector
        if (!isIdle && now - (_levelsSyncAt || 0) < 220) return
        _levelsSyncAt = now
        set({ levels })
        try {
          // Levels only — do NOT re-serialize the full answer to localStorage
          publishLiveSync({
            levels,
            listening: useAppStore.getState().listening,
            answerMode: useAppStore.getState().answerMode,
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
            // No baked-in demo memories — empty when user removes uploads
            memories:
              docs.filter((d) => d.type !== 'job').length === 0
                ? []
                : memories.length
                  ? memories
                  : [],
          }
        }),
      memories: [] as typeof DEMO_MEMORIES,
      setMemories: (memories) => set({ memories }),
      addMemories: (m) =>
        set((s) => {
          // Keep only memories tied to uploaded sources + new ones
          const keep = s.memories.filter((x) => Boolean(x.sourceFile))
          return { memories: [...m, ...keep].slice(0, 200) }
        }),
      clearKnowledgeContext: () => {
        set({
          documents: [],
          memories: [],
          jobMatch: null,
          activeJobTitle: '',
          settings: {
            ...useAppStore.getState().settings,
            jobContext: '',
          },
          answer: null,
          transcript: [],
        })
        void import('@/services/pipeline')
          .then((m) => m.pipeline.setMemories([]))
          .catch(() => {})
        void import('@/services/real-api')
          .then((m) => m.fullSessionReset())
          .catch(() => {})
      },
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
      // Never persist identity / knowledge across logins (old skills leak).
      partialize: (s) => {
        const { jobContext: _jc, ...settingsRest } = s.settings
        return {
          settings: { ...settingsRest, jobContext: '' },
          stealth: s.stealth,
          // documents / memories / sessions / activeJobTitle NOT persisted
          answerMode: s.answerMode,
        }
      },
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<typeof current> & {
          activeJobTitle?: string
          settings?: Partial<typeof current.settings>
          documents?: unknown
          memories?: unknown
        }
        const mergedSettings = {
          ...current.settings,
          ...(p.settings || {}),
          jobContext: '',
        }
        return {
          ...current,
          ...p,
          settings: mergedSettings,
          // Always empty identity + knowledge on rehydrate
          activeJobTitle: '',
          documents: [],
          memories: [],
          jobMatch: null,
          sessions: [],
        }
      },
    },
  ),
)
