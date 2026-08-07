const BASE = "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface CatalogMission {
  id: string;
  title: string;
  summary: string;
  campaignId?: string;
  targetLevel: string;
  estimatedMinutes: number;
  fidelityTier: string;
  domainIds: string[];
  competencyIds: string[];
  naturalStoppingPoints: string[];
  stepCount: number;
}

export interface ConceptSummary {
  id: string;
  title: string;
  domainId: string;
  level: string;
  summary: string;
  tags: string[];
  explain?: string;
  analogy?: string;
  whyItMatters?: string;
}

export interface ConceptFull extends ConceptSummary {
  explain: string;
  analogy: string;
  whyItMatters: string;
  formalPoints: string[];
  commonMistakes: string[];
  howToRecognize: string[];
  howToApply: string[];
  glossary: { term: string; definition: string }[];
  relatedIds: string[];
  mnemonic?: string;
  memoryHook?: string;
  useCases?: string[];
  designTradeoffs?: {
    decision: string;
    optionA: string;
    optionB: string;
    whenChooseA: string;
    whenChooseB: string;
    risk: string;
  }[];
  linkedGames?: { id: string; title: string; role: string; purpose?: string }[];
}

export interface Catalog {
  domains: {
    id: string;
    title: string;
    districtName: string;
    summary: string;
    specializations?: string[];
  }[];
  competencies: {
    id: string;
    title: string;
    level: string;
    domainId: string;
    prerequisites: string[];
  }[];
  concepts: ConceptSummary[];
  conceptCount: number;
  glossary: { term: string; definition: string; conceptId?: string }[];
  learningPaths: {
    id: string;
    title: string;
    conceptIds: string[];
    nextHint?: string;
    domainId?: string;
  }[];
  missions: CatalogMission[];
  campaigns: { id: string; title: string; missionIds: string[] }[];
  specializations: { id: string; title: string; competencyIds: string[] }[];
  competencyOrder: string[];
  product: { name: string; version: string; fidelityDefault: string; edition?: string };
}

export interface TeachBlock {
  headline: string;
  explain: string;
  analogy?: string;
  whyItMatters?: string;
  formalPoints: string[];
  commonMistakes: string[];
  workedExample?: { setup: string; steps: string[]; takeaway: string };
  revealLevels: { title: string; body: string }[];
  miniDiagram?: string;
}

export interface StepCheck {
  type: string;
  question: string;
  options: { id: string; text: string; correct?: boolean; feedback: string }[];
  acceptKeywords: string[];
  explanation: string;
}

export interface MissionStep {
  id: string;
  title: string;
  kind: string;
  prompt: string;
  tools: string[];
  successCriteria: string[];
  hints: string[];
  conceptIds?: string[];
  teach?: TeachBlock;
  check?: StepCheck;
  phase?: string;
  estimatedSeconds?: number;
}

export interface Mission {
  id: string;
  title: string;
  summary: string;
  steps: MissionStep[];
  fidelity: {
    tier: string;
    behaviorsRepresented: string[];
    behaviorsSimplified: string[];
    behaviorsOmitted: string[];
    differencesFromReal: string[];
    knownLimitations: string[];
  };
  naturalStoppingPoints: string[];
  estimatedMinutes: number;
  competencyIds: string[];
  targetLevel: string;
}

export interface WorldSnapshot {
  seed: number;
  tick: number;
  resourceCount?: number;
  costAccumulatorUsd?: number;
  resources: {
    id: string;
    kind: string;
    name: string;
    health: string;
    owner?: string;
    region?: string;
    dependencies: string[];
    costMonthlyUsd: number;
    securityPosture: string;
    configuration: Record<string, unknown>;
    tags: string[];
  }[];
}

export interface LearnerState {
  profile: {
    learnerId: string;
    displayName: string;
    settings: {
      theme: "system" | "dark" | "light";
      reducedMotion: boolean;
      highContrast: boolean;
      sessionBreakMinutes: number;
      notificationsEnabled: boolean;
    };
    demonstratedCompetencies: string[];
    completedMissions: string[];
    engagement?: {
      prestige: number;
      flowScore: number;
      architectRank: string;
      openLoops: { id: string; title: string; createdAt?: string }[];
      masteryMoments: { id: string; title: string; detail: string; at: string }[];
      architectCasesCleared?: string[];
    };
  };
  engagement?: LearnerState["profile"]["engagement"];
  curiosityCards?: { id: string; hook: string; payoffConcept: string }[];
  unlocked: string[];
  sessions: {
    sessionId: string;
    missionId: string;
    status: string;
    updatedAt: string;
  }[];
}

export const fetchCatalog = () => req<Catalog>("/api/catalog");
export const fetchLearner = () => req<LearnerState>("/api/learner");

export function saveSettings(settings: LearnerState["profile"]["settings"], displayName?: string) {
  return req<{ profile: LearnerState["profile"] }>("/api/learner/settings", {
    method: "PUT",
    body: JSON.stringify({ settings, displayName, learnerId: "local-learner" }),
  });
}

export function startSession(missionId: string, seed = 42) {
  return req<{
    sessionId: string;
    mission: Mission;
    world: WorldSnapshot;
    currentStepId: string;
    fidelity: Mission["fidelity"];
    incident: { id: string; title: string; businessImpact: string };
    disclaimer: string;
  }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ missionId, seed, learnerId: "local-learner" }),
  });
}

export function fetchWorld(sessionId: string) {
  return req<{
    world: WorldSnapshot;
    logs: { id: string; level: string; message: string; resourceId: string }[];
    metrics: { name: string; value: number; unit: string; resourceId: string }[];
    traces: {
      name: string;
      status: string;
      resourceId: string;
      durationMs: number;
      traceId?: string;
    }[];
    incidentId: string;
  }>(`/api/sessions/${sessionId}/world`);
}

export function submitAnswer(
  sessionId: string,
  body: { stepId: string; text?: string; diagnosis?: string; advance?: boolean },
) {
  return req<{
    ok: boolean;
    currentStepId: string;
    completedStepIds: string[];
    diagnosisCorrect?: boolean;
  }>(`/api/sessions/${sessionId}/answer`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function diagnose(sessionId: string, hypothesis: string) {
  return req<{ correct: boolean; feedback: string; rootCause?: string }>(
    `/api/sessions/${sessionId}/diagnose`,
    { method: "POST", body: JSON.stringify({ hypothesis }) },
  );
}

export function applyFix(sessionId: string) {
  return req<{ ok: boolean; message: string; world: WorldSnapshot }>(
    `/api/sessions/${sessionId}/fix`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function askMentor(
  sessionId: string,
  message: string,
  hintLevel = 1,
  role = "socratic_coach",
) {
  return req<{ content: string; role: string; citesUncertainty: boolean }>(
    `/api/sessions/${sessionId}/mentor`,
    { method: "POST", body: JSON.stringify({ role, message, hintLevel }) },
  );
}

export function evaluate(sessionId: string) {
  return req<{
    overallScore: number;
    passed: boolean;
    summary: string;
    dimensionScores: Record<string, number>;
    evidence: { dimension: string; score: number; rationale: string }[];
    demonstratedCompetencies?: string[];
    disclaimer: string;
  }>(`/api/sessions/${sessionId}/evaluate`, { method: "POST", body: "{}" });
}

export function exportData() {
  return req<unknown>("/api/export");
}

export function deleteProgress() {
  return req<{ ok: boolean }>("/api/learner/delete", {
    method: "POST",
    body: JSON.stringify({ learnerId: "local-learner" }),
  });
}

export function submitCheck(
  sessionId: string,
  body: {
    stepId: string;
    selectedOptionIds?: string[];
    shortText?: string;
  },
) {
  return req<{
    passed: boolean;
    score: number;
    feedback: string[];
    explanation: string;
    completedStepIds: string[];
  }>(`/api/sessions/${sessionId}/check`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revealTeach(sessionId: string, stepId: string) {
  return req<{ revealLevel: number }>(`/api/sessions/${sessionId}/reveal`, {
    method: "POST",
    body: JSON.stringify({ stepId }),
  });
}

export function fetchConcept(id: string) {
  return req<{ concept: ConceptFull; resolvedFrom?: string }>(
    `/api/concepts/${encodeURIComponent(id)}`,
  );
}

export function resetProgress() {
  return req<{ ok: boolean; message: string }>("/api/learner/reset-progress", {
    method: "POST",
    body: JSON.stringify({ learnerId: "local-learner" }),
  });
}

export interface ArchitectScenario {
  id: string;
  title: string;
  businessContext: string;
  constraints: string[];
  nonNegotiables: string[];
  options: {
    id: string;
    title: string;
    summary: string;
    scores: Record<string, number>;
    risks: string[];
    whenToChoose: string[];
    whenToReject: string[];
  }[];
  boardChallenges: { id: string; voice: string; question: string }[];
  note: string;
}

export function fetchArchitectScenarios() {
  return req<{ scenarios: ArchitectScenario[]; psychNote: string }>(
    "/api/architect/scenarios",
  );
}

export function evaluateArchitect(body: {
  scenarioId: string;
  selectedOptionId: string;
  rejectedOptionIds: string[];
  weights: Record<string, number>;
  rationale: string;
  boardAnswers: Record<string, string>;
}) {
  return req<{
    overall: number;
    passed: boolean;
    feedback: string[];
    dimensionScores: Record<string, number>;
    boardResults: { id: string; score: number; feedback: string }[];
    radar: { axis: string; selected: number; weight: number }[];
    prestigeDelta: number;
    engagement?: {
      prestige: number;
      flowScore: number;
      architectRank: string;
      openLoops: { id: string; title: string }[];
      masteryMoments: { id: string; title: string; detail: string; at: string }[];
    };
  }>("/api/architect/evaluate", {
    method: "POST",
    body: JSON.stringify({ ...body, learnerId: "local-learner" }),
  });
}

export interface QuestBoard {
  ethics?: string;
  quests: {
    id: string;
    title: string;
    tier: string;
    order: number;
    objective: string;
    missionId?: string | null;
    arenaScenarioId?: string;
    challengeId?: string;
    conceptIds?: string[];
    rewardLabel?: string;
    nextQuestId?: string | null;
    done?: boolean;
    current?: boolean;
  }[];
  currentQuest: {
    id: string;
    title: string;
    objective: string;
    whyNext: string;
    cta: { type: string; id?: string; label: string };
    rewardLabel?: string;
    tier: string;
    conceptIds?: string[];
    challengeId?: string;
    order?: number;
  } | null;
  followingQuest: { id: string; title: string; objective: string } | null;
  skillTrees: Record<
    string,
    {
      basic: { id: string; title: string }[];
      advanced: { id: string; title: string }[];
      expert: { id: string; title: string }[];
    }
  >;
  skillTreeLabels: Record<string, string>;
}

export function fetchQuests() {
  return req<QuestBoard>("/api/quests");
}

export type ReturnLoopPayload = {
  unfinishedChallengeId: string | null;
  unfinishedTitle: string | null;
  unfinishedStep: number;
  nextUnlockId: string | null;
  nextUnlockTitle: string | null;
  clearedCount: number;
  totalChallenges: number;
  goalGradient: number;
  stepsLeftInLoop?: number | null;
  nearMiss?: boolean;
  dailySeed: number;
  dailyLabel: string;
  curiosityHook?: string;
  comebackLine: string;
  ethicsLine: string;
  rankProgress?: {
    current: string;
    next: string | null;
    prestige: number;
    need: number;
    pct: number;
  };
  comebackBonusAvailable?: boolean;
  comebackBonusLabel?: string | null;
  stopHint?: string;
};

export function fetchChallenges() {
  return req<{
    pack: {
      title: string;
      intro: string;
      challenges: unknown[];
      tools: { id: string; label: string; icon: string; color: string }[];
    };
    clearedIds: string[];
    ethics: string;
    returnLoop: ReturnLoopPayload;
  }>("/api/challenges");
}

export function clearChallenge(
  challengeId: string,
  stats?: {
    wrongs?: number;
    hintsUsed?: number;
    precisionMode?: boolean;
    stepCount?: number;
    combo?: number;
  },
) {
  return req<{
    ok: boolean;
    clearedIds: string[];
    reward?: {
      prestige: number;
      label: string;
      peak: "normal" | "strong" | "epic";
      breakdown?: string[];
      peakCopy?: { headline: string; sub: string };
    };
    engagement?: { prestige: number; flowScore: number; architectRank: string };
    returnLoop?: ReturnLoopPayload;
  }>("/api/challenges/clear", {
    method: "POST",
    body: JSON.stringify({
      learnerId: "local-learner",
      challengeId,
      ...stats,
    }),
  });
}

export function saveChallengeProgress(body: {
  challengeId: string;
  title: string;
  stepIndex: number;
  clearUnfinished?: boolean;
}) {
  return req<{ ok: boolean }>("/api/challenges/progress", {
    method: "POST",
    body: JSON.stringify({ learnerId: "local-learner", ...body }),
  });
}
