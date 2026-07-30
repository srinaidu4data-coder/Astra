export type NavRoute =
  | 'copilot'
  | 'knowledge'
  | 'practice'
  | 'analytics'
  | 'settings'
  | 'admin'

export type AnswerMode =
  | 'star'
  | 'shorter'
  | 'technical'
  | 'code'

export type InterviewerPersona =
  | 'strict-tech-lead'
  | 'behavioral-hr'
  | 'system-design'
  | 'friendly-recruiter'

export interface StarMemory {
  id: string
  situation: string
  task: string
  action: string
  result: string
  metrics: string[]
  tags: string[]
  sourceFile?: string
  score?: number
}

export type KnowledgeDocType =
  | 'resume'
  | 'job'
  | 'notes'
  | 'reference' // subject PDFs, study guides, cheatsheets, project docs

export interface ResumeDocument {
  id: string
  name: string
  type: KnowledgeDocType
  text: string
  uploadedAt: string
  sizeBytes: number
}

export interface JobMatch {
  jobId: string
  title: string
  company?: string
  description: string
  matchedMemories: StarMemory[]
  matchScore: number
}

export interface TranscriptLine {
  id: string
  role: 'interviewer' | 'you' | 'system'
  text: string
  ts: number
  final?: boolean
}

export interface SuggestedAnswer {
  id: string
  mode: AnswerMode
  bullets: string[]
  star?: {
    situation: string
    task: string
    action: string
    result: string
  }
  codeSnippet?: string
  metrics: string[]
  streaming: boolean
  latencyMs?: number
  /** Interviewer question this answer is for */
  question?: string
}

/** One paced Q&A card — user steps through these */
export interface QACard {
  id: string
  question: string
  answer: SuggestedAnswer
}

export interface AudioDeviceInfo {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

export interface PipelineMetrics {
  vadMs: number
  sttMs: number
  firstTokenMs: number
  totalMs: number
  lastUpdated: number
}

export interface PracticeSession {
  id: string
  persona: InterviewerPersona
  startedAt: string
  endedAt?: string
  questions: number
  fillerWords: number
  starCoverage: number
  confidence: number
  technicalDepth: number
  notes: string[]
  /** Mock interview extras */
  overall?: number
  grade?: string
  jobTitle?: string
  difficulty?: string
  focus?: string
  communication?: number
  summary?: string
  practicePlan?: string[]
}

export interface AnalyticsPoint {
  date: string
  confidence: number
  technicalDepth: number
  fillerRate: number
  starScore: number
}

export interface StealthSettings {
  contentProtection: boolean
  alwaysOnTop: boolean
  opacity: number
  clickThrough: boolean
  hotkey: string
}

export interface AppSettings {
  openaiKey: string
  deepgramKey: string
  anthropicKey: string
  demoMode: boolean
  jobContext: string
  tone: 'professional' | 'casual' | 'confident'
}

export type OverlaySizePreset =
  | 'compact'
  | 'medium'
  | 'large'
  | 'wide'
  | 'tall'
  | 'max'

export type OverlayBounds = {
  ok?: boolean
  x: number
  y: number
  width: number
  height: number
  maximized?: boolean
  isFullScreen?: boolean
}

declare global {
  interface Window {
    interviewPulse?: {
      platform: () => Promise<string>
      setContentProtection: (enabled: boolean) => Promise<{ ok: boolean }>
      openOverlay: () => Promise<{ ok: boolean }>
      closeOverlay: () => Promise<{ ok: boolean }>
      setOverlayOpacity: (opacity: number) => Promise<{ ok: boolean }>
      setClickThrough: (enabled: boolean) => Promise<{ ok: boolean }>
      setAlwaysOnTop: (enabled: boolean) => Promise<{ ok: boolean }>
      getOverlayBounds?: () => Promise<OverlayBounds>
      setOverlayBounds?: (
        bounds: Partial<Pick<OverlayBounds, 'x' | 'y' | 'width' | 'height'>>,
      ) => Promise<OverlayBounds>
      resizeOverlayBy?: (delta: {
        width?: number
        height?: number
      }) => Promise<OverlayBounds>
      moveOverlayBy?: (delta: {
        x?: number
        y?: number
      }) => Promise<OverlayBounds>
      resetOverlayPosition?: () => Promise<OverlayBounds>
      setOverlayPreset?: (
        preset: OverlaySizePreset,
      ) => Promise<OverlayBounds & { preset?: string }>
      toggleOverlayMaximize?: () => Promise<OverlayBounds>
      onToggleClickThrough: (cb: () => void) => () => void
      onDeepLink: (cb: (url: string) => void) => () => void
    }
  }
}
