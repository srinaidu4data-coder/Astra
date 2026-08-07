import { z } from "zod";

export const SourceCitationSchema = z.object({
  productOrService: z.string(),
  environment: z.string().optional(),
  sourceUrl: z.string().url().or(z.literal("unverified")),
  sourceTitle: z.string(),
  retrievalDate: z.string(),
  productVersion: z.string().optional(),
  regionCaveats: z.string().optional(),
  licensingCaveats: z.string().optional(),
  lastExpertReviewDate: z.string().optional(),
  contentOwner: z.string().optional(),
  confidence: z.enum(["high", "medium", "low", "uncertain"]),
  reviewExpirationDate: z.string().optional(),
  deprecationStatus: z
    .enum(["current", "deprecated", "sunset", "unknown"])
    .default("unknown"),
});

export type SourceCitation = z.infer<typeof SourceCitationSchema>;

export const FidelityDisclosureSchema = z.object({
  tier: z.enum(["tier1_conceptual", "tier2_behavioral", "tier3_sandbox"]),
  behaviorsRepresented: z.array(z.string()),
  behaviorsSimplified: z.array(z.string()),
  behaviorsOmitted: z.array(z.string()),
  differencesFromReal: z.array(z.string()),
  lastVerificationDate: z.string(),
  knownLimitations: z.array(z.string()),
  sourceVersions: z.array(z.string()),
});

export const CompetencySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  domainId: z.string().min(1),
  description: z.string(),
  level: z.enum(["basic", "advanced", "expert"]),
  prerequisites: z.array(z.string()).default([]),
  misconceptions: z.array(z.string()).default([]),
  practiceFormats: z.array(z.string()).default([]),
  evidenceRequirements: z.array(z.string()).default([]),
  transferTasks: z.array(z.string()).default([]),
  retentionChecks: z.array(z.string()).default([]),
  sources: z.array(SourceCitationSchema).default([]),
  reviewStatus: z
    .enum(["draft", "in_review", "approved", "expired", "deprecated"])
    .default("draft"),
  version: z.string().default("0.1.0"),
});

export type Competency = z.infer<typeof CompetencySchema>;

export const MissionStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum([
    "business_situation",
    "stakeholder_interview",
    "requirements",
    "landscape_inspect",
    "architecture_hypothesis",
    "option_compare",
    "design",
    "implement",
    "configure",
    "test_expected",
    "test_failure",
    "observe",
    "diagnose",
    "mitigate",
    "resolve",
    "architecture_defense",
    "production_readiness",
    "reflection",
    "spaced_practice",
    "transfer",
    "concept_teach",
    "concept_check",
    "guided_example",
    "evidence_gather",
    "hypothesis_form",
    "hypothesis_test",
    "compare_terms",
    "map_components",
    "security_review",
    "cost_review",
  ]),
  prompt: z.string(),
  tools: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([]),
  hints: z.array(z.string()).default([]),
  conceptIds: z.array(z.string()).default([]),
  teach: z
    .object({
      headline: z.string(),
      explain: z.string(),
      analogy: z.string().optional(),
      whyItMatters: z.string().optional(),
      formalPoints: z.array(z.string()).default([]),
      commonMistakes: z.array(z.string()).default([]),
      workedExample: z
        .object({
          setup: z.string(),
          steps: z.array(z.string()),
          takeaway: z.string(),
        })
        .optional(),
      revealLevels: z
        .array(z.object({ title: z.string(), body: z.string() }))
        .default([]),
      miniDiagram: z.string().optional(),
    })
    .optional(),
  check: z
    .object({
      type: z.enum(["mc", "multi", "order", "short", "match"]),
      question: z.string(),
      options: z
        .array(
          z.object({
            id: z.string(),
            text: z.string(),
            correct: z.boolean().default(false),
            feedback: z.string(),
          }),
        )
        .default([]),
      acceptKeywords: z.array(z.string()).default([]),
      explanation: z.string(),
      passScore: z.number().min(0).max(1).default(1),
    })
    .optional(),
  phase: z.string().optional(),
  estimatedSeconds: z.number().int().positive().optional(),
});

export const MissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  campaignId: z.string().optional(),
  domainIds: z.array(z.string()),
  competencyIds: z.array(z.string()),
  targetLevel: z.enum(["basic", "advanced", "expert"]),
  fidelity: FidelityDisclosureSchema,
  estimatedMinutes: z.number().int().positive(),
  naturalStoppingPoints: z.array(z.string()).default([]),
  steps: z.array(MissionStepSchema).min(1),
  injectedDefects: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        symptoms: z.array(z.string()),
        rootCause: z.string(),
        distractors: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  assessmentRubric: z
    .array(
      z.object({
        dimension: z.string(),
        criteria: z.string(),
        weight: z.number().min(0).max(1),
      }),
    )
    .default([]),
  sources: z.array(SourceCitationSchema).default([]),
  version: z.string().default("0.1.0"),
  reviewStatus: z
    .enum(["draft", "in_review", "approved", "expired", "deprecated"])
    .default("draft"),
  meta: z
    .object({
      incidentId: z.string().optional(),
      landscapeId: z.string().optional(),
    })
    .optional(),
});

export type Mission = z.infer<typeof MissionSchema>;
export type MissionStep = z.infer<typeof MissionStepSchema>;

export const DomainSchema = z.object({
  id: z.string(),
  title: z.string(),
  districtName: z.string(),
  summary: z.string(),
  sapProducts: z.array(z.string()),
  specializations: z.array(z.string()).default([]),
  sources: z.array(SourceCitationSchema).default([]),
  confidence: z.enum(["high", "medium", "low", "uncertain"]),
  notes: z.string().optional(),
});

export type Domain = z.infer<typeof DomainSchema>;

export const SimulationResourceSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "global_account",
    "directory",
    "subaccount",
    "environment",
    "service_instance",
    "application",
    "database",
    "destination",
    "identity",
    "role_collection",
    "certificate",
    "api",
    "integration_flow",
    "event_topic",
    "workflow",
    "pipeline",
    "dashboard",
    "deployment",
  ]),
  name: z.string(),
  region: z.string().optional(),
  owner: z.string().optional(),
  configuration: z.record(z.unknown()).default({}),
  health: z.enum(["healthy", "degraded", "down", "unknown"]).default("unknown"),
  dependencies: z.array(z.string()).default([]),
  costMonthlyUsd: z.number().nonnegative().default(0),
  securityPosture: z
    .enum(["strong", "adequate", "weak", "critical", "unknown"])
    .default("unknown"),
  fidelityStatus: z
    .enum(["tier1_conceptual", "tier2_behavioral", "tier3_sandbox"])
    .default("tier1_conceptual"),
  tags: z.array(z.string()).default([]),
});

export type SimulationResource = z.infer<typeof SimulationResourceSchema>;

export const LearnerProgressSchema = z.object({
  learnerId: z.string(),
  missionId: z.string(),
  currentStepId: z.string().optional(),
  completedStepIds: z.array(z.string()).default([]),
  answers: z.record(z.unknown()).default({}),
  evidenceIds: z.array(z.string()).default([]),
  status: z
    .enum(["not_started", "in_progress", "completed", "abandoned"])
    .default("not_started"),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  seed: z.number().int().optional(),
});

export type LearnerProgress = z.infer<typeof LearnerProgressSchema>;
