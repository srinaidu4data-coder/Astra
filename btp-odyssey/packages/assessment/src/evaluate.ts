import type {
  EvidenceDimension,
  MasteryEvidence,
  MasteryLevel,
  Mission,
} from "@btp-odyssey/shared";

export interface StepAnswer {
  stepId: string;
  text?: string;
  selectedOptionIds?: string[];
  configPatch?: Record<string, unknown>;
  diagnosis?: string;
  reflection?: string;
}

export interface EvaluationInput {
  mission: Mission;
  answers: StepAnswer[];
  diagnosisCorrect?: boolean;
  defectFixed?: boolean;
  architectureDefenseScore?: number;
  /** Average score from embedded concept checks (0..1) */
  conceptCheckScore?: number;
  checksPassed?: number;
  checksTotal?: number;
}

export interface EvaluationResult {
  overallScore: number;
  evidence: MasteryEvidence[];
  passed: boolean;
  summary: string;
  dimensionScores: Record<string, number>;
}

function scoreTextCoverage(text: string, keywords: string[]): number {
  if (!text.trim()) return 0;
  const lower = text.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase())).length;
  return keywords.length ? hits / keywords.length : 0;
}

export function evaluateMission(input: EvaluationInput): EvaluationResult {
  const { mission, answers } = input;
  const now = new Date().toISOString();
  const evidence: MasteryEvidence[] = [];
  const dimensionScores: Record<string, number> = {};
  const byStep = new Map(answers.map((a) => [a.stepId, a]));

  const req =
    byStep.get("step-requirements") ||
    [...byStep.values()].find((a) => a.stepId.includes("requirement"));
  const arch =
    byStep.get("step-architecture") ||
    [...byStep.values()].find((a) => a.stepId.includes("architecture"));

  const reqScore = scoreTextCoverage(req?.text ?? "", [
    "functional",
    "non-functional",
    "identity",
    "security",
    "observability",
    "integration",
    "event",
    "constraint",
    "resilience",
    "privacy",
    "cost",
  ]);
  const archScore = Math.max(
    input.architectureDefenseScore ?? 0,
    scoreTextCoverage(arch?.text ?? "", [
      "cap",
      "rap",
      "ui5",
      "hana",
      "destination",
      "xsuaa",
      "event",
      "integration",
      "reject",
      "tenant",
      "residency",
      "idempoten",
      "alternative",
      "trade",
    ]),
  );

  const conceptScore =
    input.conceptCheckScore ??
    (input.checksTotal && input.checksTotal > 0
      ? (input.checksPassed ?? 0) / input.checksTotal
      : 0.5);

  dimensionScores.architecture = archScore;
  dimensionScores.conceptual = Math.min(1, reqScore * 0.45 + conceptScore * 0.55);

  evidence.push({
    id: `ev-${mission.id}-concept`,
    competencyId: mission.competencyIds[0] ?? "unknown",
    dimension: "conceptual" as EvidenceDimension,
    level: mission.targetLevel as MasteryLevel,
    assessmentType: "retrieval",
    score: dimensionScores.conceptual,
    maxScore: 1,
    rationale: `Concept checks ${((input.checksPassed ?? 0) / Math.max(input.checksTotal ?? 1, 1) * 100).toFixed(0)}% pass rate · conceptual score ${dimensionScores.conceptual.toFixed(2)}`,
    recordedAt: now,
    appealable: true,
  });

  evidence.push({
    id: `ev-${mission.id}-arch`,
    competencyId: mission.competencyIds[0] ?? "unknown",
    dimension: "architecture" as EvidenceDimension,
    level: mission.targetLevel as MasteryLevel,
    assessmentType: "architecture_construction",
    score: archScore,
    maxScore: 1,
    rationale: `Architecture coverage ${archScore.toFixed(2)}`,
    recordedAt: now,
    appealable: true,
  });

  const debugScore = input.diagnosisCorrect ? 1 : 0.15;
  dimensionScores.debugging = debugScore;
  evidence.push({
    id: `ev-${mission.id}-debug`,
    competencyId: mission.competencyIds[0] ?? "unknown",
    dimension: "debugging",
    level: mission.targetLevel,
    assessmentType: "debugging",
    score: debugScore,
    maxScore: 1,
    rationale: input.diagnosisCorrect
      ? "Diagnosis matched incident evidence keywords and process"
      : "Diagnosis not aligned with primary evidence chain",
    processNotes: "Process-scored; not final-answer only",
    recordedAt: now,
    appealable: true,
  });

  const opsScore = input.defectFixed ? 1 : 0.1;
  dimensionScores.operations = opsScore;
  dimensionScores.security = input.defectFixed ? 0.9 : 0.2;
  evidence.push({
    id: `ev-${mission.id}-ops`,
    competencyId: mission.competencyIds[0] ?? "unknown",
    dimension: "operations",
    level: mission.targetLevel,
    assessmentType: "configuration",
    score: opsScore,
    maxScore: 1,
    rationale: input.defectFixed
      ? "Defect remediated in simulation without disabling auth controls"
      : "Defect not remediated",
    recordedAt: now,
    appealable: true,
  });

  const refl =
    byStep.get("step-reflection") ||
    [...byStep.values()].find((a) => a.stepId.includes("reflection"));
  const reflScore = scoreTextCoverage(refl?.text ?? refl?.reflection ?? "", [
    "assumption",
    "evidence",
    "prevent",
    "next",
    "mistake",
    "transfer",
    "owner",
    "control",
  ]);
  dimensionScores.communication = reflScore;
  evidence.push({
    id: `ev-${mission.id}-refl`,
    competencyId: mission.competencyIds[0] ?? "unknown",
    dimension: "communication",
    level: mission.targetLevel,
    assessmentType: "reflection",
    score: reflScore,
    maxScore: 1,
    rationale: `Reflection quality ${reflScore.toFixed(2)}`,
    recordedAt: now,
    appealable: true,
  });

  const weights =
    mission.assessmentRubric.length > 0
      ? mission.assessmentRubric
      : [
          { dimension: "architecture", criteria: "default", weight: 0.25 },
          { dimension: "debugging", criteria: "default", weight: 0.3 },
          { dimension: "operations", criteria: "default", weight: 0.25 },
          { dimension: "communication", criteria: "default", weight: 0.1 },
          { dimension: "conceptual", criteria: "default", weight: 0.1 },
        ];

  let overall = 0;
  let wsum = 0;
  for (const w of weights) {
    const s = dimensionScores[w.dimension] ?? 0;
    overall += s * w.weight;
    wsum += w.weight;
  }
  overall = wsum ? overall / wsum : 0;
  const passed = overall >= 0.7 && !!input.diagnosisCorrect && !!input.defectFixed;

  return {
    overallScore: overall,
    evidence,
    passed,
    summary: passed
      ? `Passed with overall score ${(overall * 100).toFixed(0)}%. Evidence captured for this simulated mission only — not SAP certification or employment qualification.`
      : `Not yet passed (score ${(overall * 100).toFixed(0)}%). Require evidence-aligned diagnosis and secure remediation. Mastery is not XP.`,
    dimensionScores,
  };
}
