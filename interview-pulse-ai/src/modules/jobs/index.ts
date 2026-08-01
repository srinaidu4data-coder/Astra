/**
 * Jobs hub module barrel — rework surface for all Jobs UI engines.
 *
 * Pages import from here instead of scattering helpers across 2k-line files.
 */

export { JobHubShell } from './JobHubShell'
export type { JobHubShellProps, JobHubMode, FlowStep, FlowNextAction } from './JobHubShell'
export { FlowNextBanner } from './FlowNextBanner'
export { ApplicationsPanel } from './ApplicationsPanel'
export { JobCard } from './JobCard'
export type { JobCardProps } from './JobCard'
export { ApplyTrustPanel, trustRowsFromOneClick } from './ApplyTrustPanel'
export type { TrustRow, TrustStatus } from './ApplyTrustPanel'
export { LabOnlyBanner } from './LabOnlyBanner'
export { HitlClaimGate } from './HitlClaimGate'
export type { ClaimPreview } from './HitlClaimGate'
export { JobsJourney, WeeklyCompletedChip } from './JobsJourney'
export type { JourneyStep } from './JobsJourney'
export { JobsCoach, ApplyLegend } from './JobsCoach'
export type { CoachPhase, JobsCoachProps } from './JobsCoach'
export type { ClaimJob } from './HitlClaimGate'
export { useJobLabHealth } from './useJobLabHealth'
export {
  JOB_HUB_PRIMARY,
  JOB_HUB_ADVANCED,
  JOB_HUB_PLAYBOOKS,
  isPlaybookMode,
  isAdvancedMode,
  hubModeFromHash,
  setHubHash,
} from './hubConfig'
