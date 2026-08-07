export type MasteryLevel = "basic" | "advanced" | "expert";

export type EvidenceDimension =
  | "conceptual"
  | "application"
  | "architecture"
  | "debugging"
  | "security"
  | "operations"
  | "data"
  | "integration"
  | "communication"
  | "confidence_calibration"
  | "retention"
  | "transfer"
  | "collaboration";

export type AssessmentType =
  | "retrieval"
  | "explanation"
  | "concept_mapping"
  | "code_completion"
  | "code_review"
  | "configuration"
  | "architecture_construction"
  | "design_critique"
  | "tradeoff_analysis"
  | "debugging"
  | "incident_response"
  | "security_review"
  | "performance_optimization"
  | "reverse_engineering"
  | "stakeholder_communication"
  | "capstone"
  | "reflection";

export type ClaimStatus =
  | "planned"
  | "designed"
  | "scaffolded"
  | "partially_implemented"
  | "implemented"
  | "tested"
  | "verified"
  | "release_ready";

export interface MasteryEvidence {
  id: string;
  competencyId: string;
  dimension: EvidenceDimension;
  level: MasteryLevel;
  assessmentType: AssessmentType;
  score: number; // 0..1
  maxScore: number;
  rationale: string;
  processNotes?: string;
  recordedAt: string;
  appealable: boolean;
}
