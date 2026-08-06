export type NavRoute =
  | 'copilot'
  | 'knowledge'
  | 'sprint'
  | 'practice'
  | 'analytics'
  | 'settings'
  | 'admin'
  | 'jobsearch'
  | 'autoapply'
  | 'nightscout'

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
  /** First paint (outline/stage-A/cache) — not full E2E */
  firstTokenMs: number
  /**
   * True end-to-end for the answer path (submit → full answer, or STT end → full).
   * Must NEVER equal firstToken when the user waited seconds for completion.
   */
  totalMs: number
  lastUpdated: number
  /** Stage breakdown for competitor benchmarking */
  classifyMs?: number
  cacheMs?: number
  outlineMs?: number
  llmFirstTokenMs?: number
  /** First complete speakable clause (Hook) */
  firstUsefulMs?: number
  fullAnswerMs?: number
  totalPipelineMs?: number
  /** Browser-measured submit → Hook paint (performance.now) */
  clientE2eMs?: number
  clientFirstPaintMs?: number
  source?: string
  depth?: string
  grade?: string
  requestId?: string
  turnId?: string
  answerMode?: string
  groundingViolations?: number
}

/** Live latency snapshot from /api/latency/metrics */
export interface LatencySnapshot {
  ok?: boolean
  sample_count?: number
  stages?: Record<
    string,
    {
      n?: number
      min?: number | null
      avg?: number | null
      p50?: number | null
      p95?: number | null
      p99?: number | null
      max?: number | null
    }
  >
  grades?: Record<
    string,
    {
      p50?: number | null
      p95?: number | null
      grade?: string
      label?: string
      bars?: { excellent?: number; good?: number; acceptable?: number }
    }
  >
  comparison?: Array<{
    id: string
    label: string
    their_claimed_ms?: number
    their_user_reported_ms?: number
    our_p50_ms?: number | null
    beat_their_claim?: boolean
    beat_their_real_world?: boolean
    delta_vs_reported_ms?: number | null
    notes?: string
  }>
  verdict?: {
    rank_vs_market?: string
    beat_real_world_count?: number
    competitor_count?: number
    first_token_grade?: string
    full_answer_grade?: string
    stt_grade?: string
    tips?: string[]
  }
  counters?: Record<string, number>
  recent?: Array<Record<string, unknown>>
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

/**
 * Interview capture — speakers/system by default so your answers are not transcribed.
 * `auto` = local Windows → system loopback; web/cloud → share-tab audio.
 */
export type InterviewAudioSourceSetting = 'auto' | 'system' | 'display' | 'mic'

export interface AppSettings {
  openaiKey: string
  deepgramKey: string
  anthropicKey: string
  demoMode: boolean
  jobContext: string
  tone: 'professional' | 'casual' | 'confident'
  /**
   * Where interviewer audio comes from.
   * - auto: smart default (system on local Windows, display on web)
   * - system: PC speakers via Stereo Mix / WASAPI (local Windows)
   * - display: share Teams/Zoom tab with audio (web / cloud)
   * - mic: last resort only — picks up your spoken answers too
   */
  audioSource: InterviewAudioSourceSetting
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
      /** Push live answer/levels to other windows (overlay) */
      publishLiveState?: (state: unknown) => Promise<{ ok: boolean }>
      /** Last cached live state from main process */
      requestLiveState?: () => Promise<unknown>
      /** Ask main window to re-publish current zustand answer */
      requestLivePublish?: () => Promise<{ ok: boolean; hasState?: boolean }>
      onLiveState?: (cb: (state: unknown) => void) => () => void
      onRequestLivePublish?: (cb: () => void) => () => void
    }
  }
}
