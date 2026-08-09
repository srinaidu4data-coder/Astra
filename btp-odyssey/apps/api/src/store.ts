import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorldState } from "@btp-odyssey/simulation";
import type { StepAnswer } from "./types.js";

export interface EngagementBlob {
  prestige: number;
  flowScore: number;
  openLoops: { id: string; title: string; missionId?: string; createdAt: string }[];
  masteryMoments: { id: string; title: string; at: string; detail: string }[];
  architectRank: string;
  sessionsToday: number;
  lastBreakNudgeAt?: string;
  architectCasesCleared: string[];
  challengesCleared?: string[];
  /** Atlas concepts the learner opened (beginner quest tracking) */
  conceptsViewed?: string[];
  unfinishedChallenge?: {
    challengeId: string;
    title: string;
    stepIndex: number;
    updatedAt: string;
  } | null;
  precisionClears?: number;
}

export interface LearnerProfile {
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
  evidence: unknown[];
  engagement?: EngagementBlob;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  sessionId: string;
  learnerId: string;
  missionId: string;
  seed: number;
  incidentId: string;
  landscapeId: string;
  world: SerializedWorld;
  currentStepId: string;
  completedStepIds: string[];
  answers: StepAnswer[];
  diagnosisCorrect?: boolean;
  defectFixed?: boolean;
  checkResults: Record<
    string,
    { passed: boolean; score: number; feedback: string[]; explanation: string }
  >;
  teachReveals: Record<string, number>;
  startedAt: string;
  updatedAt: string;
  status: "in_progress" | "completed";
  lastEvaluation?: unknown;
}

interface SerializedWorld {
  seed: number;
  tick: number;
  resources: [string, unknown][];
  logs: unknown[];
  metrics: unknown[];
  traces: unknown[];
  changeHistory: unknown[];
  costAccumulatorUsd: number;
}

export function serializeWorld(world: WorldState): SerializedWorld {
  return {
    seed: world.seed,
    tick: world.tick,
    resources: [...world.resources.entries()],
    logs: world.logs,
    metrics: world.metrics,
    traces: world.traces,
    changeHistory: world.changeHistory,
    costAccumulatorUsd: world.costAccumulatorUsd,
  };
}

export function deserializeWorld(data: SerializedWorld): WorldState {
  return {
    seed: data.seed,
    tick: data.tick,
    resources: new Map(data.resources as [string, never][]),
    logs: data.logs as WorldState["logs"],
    metrics: data.metrics as WorldState["metrics"],
    traces: data.traces as WorldState["traces"],
    changeHistory: data.changeHistory as WorldState["changeHistory"],
    costAccumulatorUsd: data.costAccumulatorUsd,
  };
}

export class FileStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "sessions"), { recursive: true });
  }

  private profilePath(id: string) {
    return join(this.dir, `learner-${id}.json`);
  }

  private sessionPath(id: string) {
    return join(this.dir, "sessions", `${id}.json`);
  }

  getOrCreateLearner(learnerId = "local-learner"): LearnerProfile {
    const p = this.profilePath(learnerId);
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf8")) as LearnerProfile;
    }
    const profile: LearnerProfile = {
      learnerId,
      displayName: "Local Learner",
      settings: {
        theme: "system",
        reducedMotion: false,
        highContrast: false,
        sessionBreakMinutes: 50,
        notificationsEnabled: false,
      },
      demonstratedCompetencies: [],
      completedMissions: [],
      evidence: [],
      engagement: {
        prestige: 0,
        flowScore: 42,
        openLoops: [],
        masteryMoments: [],
        architectRank: "Apprentice Designer",
        sessionsToday: 0,
        architectCasesCleared: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.saveLearner(profile);
    return profile;
  }

  saveLearner(profile: LearnerProfile) {
    profile.updatedAt = new Date().toISOString();
    writeFileSync(this.profilePath(profile.learnerId), JSON.stringify(profile, null, 2));
  }

  saveSession(session: SessionRecord) {
    session.updatedAt = new Date().toISOString();
    writeFileSync(this.sessionPath(session.sessionId), JSON.stringify(session, null, 2));
  }

  getSession(sessionId: string): SessionRecord | null {
    const p = this.sessionPath(sessionId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as SessionRecord;
  }

  listSessions(learnerId: string): SessionRecord[] {
    const dir = join(this.dir, "sessions");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionRecord)
      .filter((s) => s.learnerId === learnerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
