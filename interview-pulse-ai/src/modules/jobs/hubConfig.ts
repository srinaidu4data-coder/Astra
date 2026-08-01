/** Hub navigation — Search · Apply · Night · Advanced (optional tools only). */

export type JobHubMode =
  | 'search'
  | 'auto'
  | 'night'
  | 'autofill'
  | 'metrics'
  // Legacy hashes map → auto (kept for type-safe setHubHash redirects)
  | 'nexus'
  | 'careerops'
  | 'applypilot'
  | 'aihawk'
  | 'hitl'

export const JOB_HUB_PRIMARY: { id: JobHubMode; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'auto', label: 'Apply' },
  { id: 'night', label: 'Night' },
]

/** Optional tools — not a marketing playbook wall */
export const JOB_HUB_ADVANCED: { id: JobHubMode; label: string; blurb: string }[] = [
  { id: 'autofill', label: 'Form pack', blurb: 'ATS field pack + kit export' },
  { id: 'metrics', label: 'Metrics', blurb: 'Lab ATS success rates' },
]

/** @deprecated use JOB_HUB_ADVANCED */
export const JOB_HUB_PLAYBOOKS = JOB_HUB_ADVANCED.map((a) => ({
  id: a.id,
  label: a.label,
  source: a.blurb,
}))

export function isPlaybookMode(mode: JobHubMode): boolean {
  return JOB_HUB_ADVANCED.some((p) => p.id === mode)
}

export function isAdvancedMode(mode: JobHubMode): boolean {
  return isPlaybookMode(mode)
}

const LEGACY_TO_AUTO = new Set([
  'nexus',
  'careerops',
  'career-ops',
  'applypilot',
  'pilot',
  'aihawk',
  'hawk',
  'hitl',
  'review',
  'marvel',
])

export function hubModeFromHash(): JobHubMode {
  if (typeof window === 'undefined') return 'search'
  const raw = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase()
  const path = raw.split('?')[0] || ''
  const last = path.split('/').filter(Boolean).pop() || path
  if (LEGACY_TO_AUTO.has(last || '')) return 'auto'
  const table: Record<string, JobHubMode> = {
    jobsearch: 'search',
    'job-search': 'search',
    jobs: 'search',
    search: 'search',
    auto: 'auto',
    autoapply: 'auto',
    'auto-apply': 'auto',
    aiapply: 'auto',
    apply: 'auto',
    autofill: 'autofill',
    simplify: 'autofill',
    'form-pack': 'autofill',
    formpack: 'autofill',
    metrics: 'metrics',
    stats: 'metrics',
    night: 'night',
    nightscout: 'night',
    'night-scout': 'night',
    morning: 'night',
  }
  return table[last || ''] || table[path] || 'search'
}

export function setHubHash(mode: JobHubMode) {
  if (typeof window === 'undefined') return
  // Collapse legacy marketing modes onto Apply
  const effective: JobHubMode =
    mode === 'nexus' ||
    mode === 'careerops' ||
    mode === 'applypilot' ||
    mode === 'aihawk' ||
    mode === 'hitl'
      ? 'auto'
      : mode
  const map: Record<string, string> = {
    search: '#/jobsearch',
    auto: '#/jobsearch/auto',
    night: '#/jobsearch/night',
    autofill: '#/jobsearch/autofill',
    metrics: '#/jobsearch/metrics',
  }
  const hash = map[effective] || '#/jobsearch'
  if (window.location.hash !== hash) {
    window.location.hash = hash
  }
}
