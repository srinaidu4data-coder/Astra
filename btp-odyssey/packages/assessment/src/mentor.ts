export type MentorRole =
  | "patient_instructor"
  | "socratic_coach"
  | "security_architect"
  | "btp_admin"
  | "sre"
  | "architecture_review_board"
  | "data_architect"
  | "integration_architect";

export interface MentorMessage {
  role: MentorRole;
  content: string;
  hintLevel: number;
  citesUncertainty: boolean;
}

export function mentorRespond(input: {
  role: MentorRole;
  stepKind: string;
  learnerMessage: string;
  hintLevel?: number;
  diagnosisCorrect?: boolean;
  missionHints?: string[];
}): MentorMessage {
  const hints = input.missionHints?.length
    ? input.missionHints
    : [
        "Which dependency edge fails first?",
        "Separate symptoms from root cause using logs and traces.",
        "Prefer least privilege fixes over disabling controls.",
      ];
  const hintLevel = Math.min(Math.max(input.hintLevel ?? 0, 0), hints.length);

  if (input.role === "architecture_review_board") {
    return {
      role: input.role,
      content:
        "Board: Defend service selection, rejected alternatives, identity propagation, retry/idempotency, residency, monitoring, cost, rollback, and clean-core alignment. Cite verified facts vs assumptions. Simulated board only — not SAP endorsement.",
      hintLevel: 0,
      citesUncertainty: true,
    };
  }

  if (input.stepKind === "diagnose" || /401|403|fail|outage|duplicate|stale/i.test(input.learnerMessage)) {
    if (input.diagnosisCorrect) {
      return {
        role: input.role,
        content:
          "Diagnosis aligns with evidence. Remediate with least privilege, re-test expected and failure paths, add a prevention control, then reflect. Simulated coach only.",
        hintLevel,
        citesUncertainty: true,
      };
    }
    const hint =
      hintLevel > 0
        ? hints[Math.min(hintLevel - 1, hints.length - 1)]!
        : "Gather evidence before concluding. Inspect degraded resources and error logs first.";
    return { role: input.role, content: hint, hintLevel, citesUncertainty: false };
  }

  if (input.stepKind === "reflection") {
    return {
      role: "patient_instructor",
      content:
        "Reflect: failed assumption, correcting evidence, prevention control, transfer scenario. Take a break if your session is long — optional streaks never punish rest.",
      hintLevel: 0,
      citesUncertainty: false,
    };
  }

  if (input.stepKind === "architecture_hypothesis" || input.stepKind === "option_compare") {
    return {
      role: input.role === "socratic_coach" ? "socratic_coach" : input.role,
      content:
        "State constraints and what you verified in the landscape. Compare at least two options and explicitly reject one with rationale. I will not hand you the design.",
      hintLevel: 0,
      citesUncertainty: true,
    };
  }

  return {
    role: input.role,
    content:
      "State the business goal, constraints, and verified landscape facts. Simulated mentor — verify critical SAP facts against official documentation.",
    hintLevel: 0,
    citesUncertainty: true,
  };
}
