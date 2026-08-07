import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addPrestige,
  bumpFlow,
  emptyEngagement,
  evaluateMission,
  evaluateStepCheck,
  evaluateTradeoff,
  getTradeScenario,
  mentorRespond,
  openLoop,
  ARCHITECT_SCENARIOS,
  buildReturnState,
  challengeClearReward,
  comebackBonus,
  rankFromPrestige,
} from "@btp-odyssey/assessment";
import {
  buildCompetencyGraph,
  topologicalOrder,
  unlockedCompetencies,
} from "@btp-odyssey/competency";
import { loadContentRootSoft } from "@btp-odyssey/content-engine";
import {
  applyIncident,
  diagnoseIncident,
  fixIncident,
  getIncident,
  MISSION_RUNTIME,
  buildLandscape,
  snapshotWorld,
  worldFromSeedAndLandscape,
} from "@btp-odyssey/simulation";
import { deserializeWorld, FileStore, serializeWorld, type SessionRecord } from "./store.js";
import type { Mission, StepAnswer } from "./types.js";
import { readFileSync as readSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");
const contentRoot = join(ROOT, "content");
const webDist = join(ROOT, "apps/web/dist");
const PORT = Number(process.env.PORT ?? 8787);
const store = new FileStore(join(ROOT, "data/runtime"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function loadBundle() {
  return loadContentRootSoft(contentRoot);
}

function loadJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readSync(path, "utf8")) as T;
}

function conceptAliases(): Record<string, string> {
  return loadJsonFile<{ aliases: Record<string, string> }>(
    join(contentRoot, "meta/concept-aliases.json"),
    { aliases: {} },
  ).aliases;
}

function resolveConceptId(id: string, concepts: { id: string }[]): string {
  if (concepts.some((c) => c.id === id)) return id;
  const mapped = conceptAliases()[id];
  if (mapped && concepts.some((c) => c.id === mapped)) return mapped;
  // fuzzy: strip c- prefix and try common patterns
  if (id.startsWith("c-")) {
    const rest = id.slice(2);
    const hit = concepts.find(
      (c) =>
        c.id === rest ||
        c.id.endsWith(rest) ||
        c.id.includes(rest.replace(/-/g, "")),
    );
    if (hit) return hit.id;
  }
  return id;
}

function findConcept(id: string) {
  const { concepts } = loadBundle();
  const resolved = resolveConceptId(id, concepts);
  return concepts.find((c) => c.id === resolved) ?? null;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function getMission(missionId: string): Mission | undefined {
  const { bundle } = loadBundle();
  return bundle.missions.find((m) => m.id === missionId) as Mission | undefined;
}

/** Strip answer keys before sending missions to the browser. */
function publicMission(mission: Mission): Mission {
  return {
    ...mission,
    steps: mission.steps.map((s) => ({
      ...s,
      check: s.check
        ? {
            ...s.check,
            options: s.check.options.map(({ id, text, feedback, correct: _c }) => ({
              id,
              text,
              feedback: "",
              correct: false,
            })),
            explanation: "",
            acceptKeywords: [],
          }
        : s.check,
    })),
  };
}

function runtimeFor(missionId: string) {
  return (
    MISSION_RUNTIME[missionId] ?? {
      landscapeId: "startup-northwind",
      incidentId: "inc-audience-mismatch",
    }
  );
}

function sessionWorld(session: SessionRecord) {
  return deserializeWorld(session.world);
}

function persistWorld(session: SessionRecord, world: ReturnType<typeof sessionWorld>) {
  session.world = serializeWorld(world);
}

const BUILD_PIPE = `pipe-${Date.now().toString(36)}`;

function serveStatic(reqPath: string, res: import("node:http").ServerResponse): boolean {
  if (!existsSync(webDist)) return false;
  let rel = reqPath === "/" ? "/index.html" : reqPath;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  // strip query
  rel = rel.split("?")[0] ?? rel;
  let filePath = join(webDist, rel);
  if (!filePath.startsWith(webDist)) return false;
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(webDist, "index.html");
  }
  if (!existsSync(filePath)) return false;
  const ext = extname(filePath);
  let body: Buffer | string = readFileSync(filePath);
  // Bust HTML asset URLs every boot so Arena piping UI never sticks on a stale bundle.
  if (ext === ".html") {
    const html = body.toString("utf8");
    body = html
      .replace(
        /(src|href)="(\/assets\/[^"]+)"/g,
        `$1="$2?v=${BUILD_PIPE}"`,
      )
      .replace(
        "<div id=\"root\"></div>",
        `<div id="root"></div><script>window.__ODYSSEY_PIPE__=${JSON.stringify(BUILD_PIPE)};</script>`,
      );
  }
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(body);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") return json(res, 204, {});

  try {
    if (req.method === "GET" && path === "/health") {
      return json(res, 200, {
        ok: true,
        product: "SAP BTP Odyssey",
        version: "2.0.0",
        release: "mega-teach-2.0",
        disclaimer:
          "Independent learning simulation. Not affiliated with or endorsed by SAP. Not official certification.",
      });
    }

    if (req.method === "GET" && path === "/api/catalog") {
      const { bundle, issues, concepts } = loadBundle();
      const graph = buildCompetencyGraph(bundle.competencies);
      const campaigns = loadJsonFile<{ campaigns: unknown[] }>(
        join(contentRoot, "campaigns/index.json"),
        { campaigns: [] },
      );
      const specializations = loadJsonFile<{ specializations: unknown[] }>(
        join(contentRoot, "specializations/index.json"),
        { specializations: [] },
      );
      const learningPaths = loadJsonFile<{ paths: unknown[] }>(
        join(contentRoot, "learning-paths/index.json"),
        { paths: [] },
      );
      const glossary = loadJsonFile<{ terms: unknown[] }>(
        join(contentRoot, "glossary/index.json"),
        { terms: [] },
      );
      return json(res, 200, {
        domains: bundle.domains,
        competencies: bundle.competencies,
        concepts: concepts.map((c) => ({
          id: c.id,
          title: c.title,
          domainId: c.domainId,
          level: c.level,
          summary: c.summary,
          tags: c.tags,
        })),
        conceptCount: concepts.length,
        glossary: glossary.terms,
        learningPaths: learningPaths.paths,
        missions: bundle.missions.map((m) => ({
          id: m.id,
          title: m.title,
          summary: m.summary,
          campaignId: (m as { campaignId?: string }).campaignId,
          targetLevel: m.targetLevel,
          estimatedMinutes: m.estimatedMinutes,
          fidelityTier: m.fidelity.tier,
          domainIds: m.domainIds,
          competencyIds: m.competencyIds,
          naturalStoppingPoints: m.naturalStoppingPoints,
          stepCount: m.steps.length,
          teachStepCount: m.steps.filter((s) => s.teach || s.check).length,
        })),
        campaigns: campaigns.campaigns,
        specializations: specializations.specializations,
        competencyOrder: topologicalOrder(graph),
        contentIssues: issues.filter((i) => i.severity === "error"),
        product: {
          name: "SAP BTP Odyssey",
          version: "2.0.0",
          edition: "mega-teach",
          fidelityDefault: "tier2_behavioral",
        },
      });
    }

    if (req.method === "GET" && path.startsWith("/api/concepts/")) {
      const id = decodeURIComponent(path.slice("/api/concepts/".length));
      if (!id || id === "undefined" || id === "null") {
        return json(res, 400, { error: "Missing concept id" });
      }
      const concept = findConcept(id);
      if (!concept) {
        return json(res, 404, {
          error: "Concept not found",
          requested: id,
          hint: "Use /api/concepts for the full list",
        });
      }
      // Track Atlas opens for beginner quest spine (no dark patterns — just progress)
      try {
        const learnerId = url.searchParams.get("learnerId") ?? "local-learner";
        const profile = store.getOrCreateLearner(learnerId);
        if (!profile.engagement) {
          profile.engagement = {
            prestige: 0,
            flowScore: 42,
            openLoops: [],
            masteryMoments: [],
            architectRank: "Apprentice Designer",
            sessionsToday: 0,
            architectCasesCleared: [],
            challengesCleared: [],
            conceptsViewed: [],
          };
        }
        if (!profile.engagement.conceptsViewed) profile.engagement.conceptsViewed = [];
        if (!profile.engagement.conceptsViewed.includes(concept.id)) {
          profile.engagement.conceptsViewed.push(concept.id);
          profile.engagement.conceptsViewed = profile.engagement.conceptsViewed.slice(-400);
          store.saveLearner(profile);
        }
      } catch {
        /* non-fatal */
      }
      return json(res, 200, {
        concept,
        resolvedFrom: concept.id !== id ? id : undefined,
      });
    }

    if (req.method === "GET" && path === "/api/concepts") {
      const { concepts } = loadBundle();
      return json(res, 200, {
        concepts: concepts.map((c) => ({
          id: c.id,
          title: c.title,
          domainId: c.domainId,
          level: c.level,
          summary: c.summary,
          tags: c.tags,
          // include body so UI can show content without a second hop when needed
          explain: c.explain,
          analogy: c.analogy,
          whyItMatters: c.whyItMatters,
        })),
        aliases: conceptAliases(),
      });
    }

    if (req.method === "POST" && path === "/api/learner/reset-progress") {
      const body = JSON.parse((await readBody(req)) || "{}") as { learnerId?: string };
      const learnerId = body.learnerId ?? "local-learner";
      const profile = store.getOrCreateLearner(learnerId);
      profile.completedMissions = [];
      profile.demonstratedCompetencies = [];
      profile.evidence = [];
      profile.engagement = {
        prestige: 0,
        flowScore: 42,
        openLoops: [],
        masteryMoments: [],
        architectRank: "Apprentice Designer",
        sessionsToday: 0,
        architectCasesCleared: [],
      };
      store.saveLearner(profile);
      return json(res, 200, {
        ok: true,
        message: "Progress reset. Quest spine returns to the first incomplete step.",
        profile,
      });
    }

    if (req.method === "GET" && path === "/api/quests") {
      const quests = loadJsonFile<{
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
        }[];
        ethics?: string;
      }>(join(contentRoot, "quests/index.json"), { quests: [] });
      const skillTrees = loadJsonFile<{
        trees: Record<string, unknown>;
        labels: Record<string, string>;
      }>(join(contentRoot, "skill-trees/index.json"), { trees: {}, labels: {} });
      const profile = store.getOrCreateLearner(
        url.searchParams.get("learnerId") ?? "local-learner",
      );
      const completedMissions = new Set(profile.completedMissions);
      const clearedArena = new Set(profile.engagement?.architectCasesCleared ?? []);
      const demonstrated = new Set(profile.demonstratedCompetencies);

      // Determine current quest: first not satisfied
      const viewed = new Set(profile.engagement?.conceptsViewed ?? []);
      const clearedCh = new Set(profile.engagement?.challengesCleared ?? []);

      const enriched = quests.quests.map((q) => {
        let done = false;
        if (q.missionId && completedMissions.has(q.missionId)) done = true;
        if (q.arenaScenarioId && clearedArena.has(q.arenaScenarioId)) done = true;
        const qAny = q as { challengeId?: string };

        // Full curriculum phase: every concept needs intro + mastery challenge cleared
        if (q.conceptIds?.length) {
          const need = q.conceptIds.flatMap((id) => [
            `ch-${id}-intro`,
            `ch-${id}-mastery`,
          ]);
          const allGames = need.every((id) => clearedCh.has(id));
          if (allGames) done = true;
        }

        // Single challenge gate (legacy / milestone)
        if (!done && qAny.challengeId && clearedCh.has(qAny.challengeId)) {
          // Only if no concept list, or concept list already handled above
          if (!q.conceptIds?.length) done = true;
        }

        // Atlas-only: all concepts viewed
        if (
          !done &&
          q.conceptIds?.length &&
          !q.missionId &&
          !q.arenaScenarioId &&
          !qAny.challengeId
        ) {
          done = q.conceptIds.every((id) => viewed.has(id));
        }
        return { ...q, done };
      });
      const current = enriched.find((q) => !q.done) ?? enriched[enriched.length - 1];
      const next = current
        ? enriched.find((q) => q.id === current.nextQuestId) ?? null
        : null;

      const curAny = current as { challengeId?: string } | undefined;
      return json(res, 200, {
        ethics: quests.ethics,
        quests: enriched.map((q) => ({
          ...q,
          current: q.id === current?.id,
        })),
        currentQuest: current
          ? {
              ...current,
              current: true,
              whyNext:
                current.order <= 3
                  ? "Beginner spine: understand BTP → structure → security/admin, with a game each step."
                  : "Complete this objective to advance the campaign spine.",
              cta: curAny?.challengeId
                ? {
                    type: "challenge",
                    id: curAny.challengeId,
                    label:
                      current.order <= 4
                        ? "Play beginner game"
                        : "Open PLAY challenge",
                  }
                : current.arenaScenarioId
                ? { type: "arena", id: current.arenaScenarioId, label: "Open Architecture Arena" }
                : current.missionId
                  ? { type: "mission", id: current.missionId, label: "Launch mission cockpit" }
                  : { type: "atlas", id: current.conceptIds?.[0], label: "Study Atlas cards" },
            }
          : null,
        followingQuest: next,
        skillTrees: skillTrees.trees,
        skillTreeLabels: skillTrees.labels,
        demonstratedCount: demonstrated.size,
      });
    }

    if (req.method === "GET" && path === "/api/challenges") {
      const pack = loadJsonFile<{
        challenges: {
          id: string;
          title: string;
          unlockAfter: string | null;
          steps?: unknown[];
        }[];
        tools: unknown[];
        title?: string;
        intro?: string;
      }>(join(contentRoot, "challenges/index.json"), {
        challenges: [],
        tools: [],
      });
      const profile = store.getOrCreateLearner(
        url.searchParams.get("learnerId") ?? "local-learner",
      );
      const cleared = profile.engagement?.challengesCleared ?? [];
      const unfinished = profile.engagement?.unfinishedChallenge;
      const unfinishedMeta = unfinished
        ? pack.challenges.find((c) => c.id === unfinished.challengeId)
        : null;
      const returnLoop = buildReturnState({
        challenges: pack.challenges.map((c) => ({
          id: c.id,
          title: c.title,
          unlockAfter: c.unlockAfter,
          stepCount: Array.isArray(c.steps) ? c.steps.length : undefined,
        })),
        clearedIds: cleared,
        unfinished: unfinished
          ? {
              challengeId: unfinished.challengeId,
              title: unfinished.title,
              stepIndex: unfinished.stepIndex,
            }
          : null,
        prestige: profile.engagement?.prestige ?? 0,
        lastActiveAt:
          unfinished?.updatedAt ??
          profile.updatedAt ??
          profile.engagement?.masteryMoments?.[0]?.at ??
          null,
        unfinishedStepCount: unfinishedMeta?.steps?.length,
      });
      return json(res, 200, {
        pack,
        clearedIds: cleared,
        returnLoop,
        curriculum: {
          totalChallenges: pack.challenges?.length ?? 0,
          totalConcepts:
            (pack as { totalConcepts?: number }).totalConcepts ??
            Math.floor((pack.challenges?.length ?? 0) / 2),
          cleared: cleared.length,
          nextId: returnLoop.nextUnlockId,
        },
        ethics:
          "Linear curriculum: every concept has intro + mastery games in fixed order. Wrong = red teach. Right = unlock next. Missing a day never punishes you.",
      });
    }

    if (req.method === "POST" && path === "/api/challenges/progress") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        learnerId?: string;
        challengeId?: string;
        title?: string;
        stepIndex?: number;
        clearUnfinished?: boolean;
      };
      const profile = store.getOrCreateLearner(body.learnerId ?? "local-learner");
      if (!profile.engagement) {
        profile.engagement = {
          prestige: 0,
          flowScore: 42,
          openLoops: [],
          masteryMoments: [],
          architectRank: "Apprentice Designer",
          sessionsToday: 0,
          architectCasesCleared: [],
          challengesCleared: [],
        };
      }
      if (body.clearUnfinished) {
        profile.engagement.unfinishedChallenge = null;
      } else if (body.challengeId) {
        profile.engagement.unfinishedChallenge = {
          challengeId: body.challengeId,
          title: body.title ?? body.challengeId,
          stepIndex: body.stepIndex ?? 0,
          updatedAt: new Date().toISOString(),
        };
      }
      store.saveLearner(profile);
      return json(res, 200, { ok: true, unfinished: profile.engagement.unfinishedChallenge });
    }

    if (req.method === "POST" && path === "/api/challenges/clear") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        learnerId?: string;
        challengeId?: string;
        wrongs?: number;
        hintsUsed?: number;
        precisionMode?: boolean;
        stepCount?: number;
        combo?: number;
      };
      const profile = store.getOrCreateLearner(body.learnerId ?? "local-learner");
      if (!profile.engagement) {
        profile.engagement = {
          prestige: 0,
          flowScore: 42,
          openLoops: [],
          masteryMoments: [],
          architectRank: "Apprentice Designer",
          sessionsToday: 0,
          architectCasesCleared: [],
          challengesCleared: [],
        };
      }
      const eng = profile.engagement;
      if (!eng.challengesCleared) eng.challengesCleared = [];

      // Soft comeback boost from time away (bonus only — never a debt)
      let hoursAway: number | null = null;
      const lastAt =
        eng.unfinishedChallenge?.updatedAt ??
        eng.masteryMoments?.[0]?.at ??
        profile.updatedAt;
      if (lastAt) {
        const t = Date.parse(lastAt);
        if (!Number.isNaN(t)) hoursAway = (Date.now() - t) / 3_600_000;
      }
      const cb = comebackBonus(hoursAway);

      const reward = challengeClearReward({
        wrongs: body.wrongs ?? 0,
        hintsUsed: body.hintsUsed ?? 0,
        precisionMode: !!body.precisionMode,
        stepCount: body.stepCount ?? 4,
        comebackBoost: cb.prestigeBoost,
        combo: body.combo ?? 0,
      });
      const already = body.challengeId
        ? eng.challengesCleared.includes(body.challengeId)
        : true;
      if (body.challengeId && !already) {
        eng.challengesCleared.push(body.challengeId);
      }
      // Always grant reward for clear attempt finish; smaller if replaying
      const gain = already
        ? Math.max(4, Math.round(reward.prestige * 0.35))
        : reward.prestige;
      eng.prestige += gain;
      eng.flowScore = Math.min(
        100,
        (eng.flowScore ?? 40) + (reward.peak === "epic" ? 14 : reward.peak === "strong" ? 10 : 8),
      );
      if (body.precisionMode && reward.peak === "epic") {
        eng.precisionClears = (eng.precisionClears ?? 0) + 1;
      }
      eng.unfinishedChallenge = null;
      eng.masteryMoments = [
        {
          id: `ch-${Date.now()}`,
          title: reward.label,
          at: new Date().toISOString(),
          detail: `+${gain} prestige · ${reward.peak} peak${cb.available ? " · comeback" : ""}`,
        },
        ...(eng.masteryMoments ?? []),
      ].slice(0, 20);
      eng.architectRank = rankFromPrestige(eng.prestige);
      profile.engagement = eng;
      profile.updatedAt = new Date().toISOString();
      store.saveLearner(profile);

      const pack = loadJsonFile<{
        challenges: {
          id: string;
          title: string;
          unlockAfter: string | null;
          steps?: unknown[];
        }[];
      }>(join(contentRoot, "challenges/index.json"), { challenges: [] });
      const returnLoop = buildReturnState({
        challenges: pack.challenges.map((c) => ({
          id: c.id,
          title: c.title,
          unlockAfter: c.unlockAfter,
          stepCount: Array.isArray(c.steps) ? c.steps.length : undefined,
        })),
        clearedIds: eng.challengesCleared,
        unfinished: null,
        prestige: eng.prestige,
        lastActiveAt: profile.updatedAt,
      });

      return json(res, 200, {
        ok: true,
        clearedIds: eng.challengesCleared,
        reward: {
          ...reward,
          prestige: gain,
          peakCopy:
            reward.peak === "epic"
              ? {
                  headline: "Epic peak — precision mastery",
                  sub: `+${gain} prestige. That clean run is the feeling worth returning for.`,
                }
              : reward.peak === "strong"
                ? {
                    headline: "Strong clear",
                    sub: `+${gain} prestige. Peak-end locked — progress saved, next gate warm.`,
                  }
                : {
                    headline: "Challenge cleared",
                    sub: `+${gain} prestige. Wrong moves taught; right moves advanced.`,
                  },
        },
        engagement: profile.engagement,
        returnLoop,
      });
    }

    if (req.method === "GET" && path === "/api/architect/scenarios") {
      return json(res, 200, {
        scenarios: ARCHITECT_SCENARIOS.map((s) => ({
          id: s.id,
          title: s.title,
          businessContext: s.businessContext,
          constraints: s.constraints,
          nonNegotiables: s.nonNegotiables,
          options: s.options.map((o) => ({
            id: o.id,
            title: o.title,
            summary: o.summary,
            scores: o.scores,
            risks: o.risks,
            whenToChoose: o.whenToChoose,
            whenToReject: o.whenToReject,
          })),
          boardChallenges: s.boardChallenges.map((b) => ({
            id: b.id,
            voice: b.voice,
            question: b.question,
          })),
          note: s.note,
        })),
        psychNote:
          "Engagement uses Flow + Self-Determination Theory (autonomy, competence, relatedness) and curiosity gaps. No shame streaks, loot boxes, or sleep-disrupting urgency.",
      });
    }

    if (req.method === "POST" && path === "/api/architect/evaluate") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        scenarioId?: string;
        learnerId?: string;
        selectedOptionId?: string;
        rejectedOptionIds?: string[];
        weights?: Record<string, number>;
        rationale?: string;
        boardAnswers?: Record<string, string>;
      };
      const scenario = getTradeScenario(body.scenarioId ?? "");
      if (!scenario) return json(res, 404, { error: "Scenario not found" });
      const result = evaluateTradeoff(scenario, {
        selectedOptionId: body.selectedOptionId ?? "",
        rejectedOptionIds: body.rejectedOptionIds ?? [],
        weights: body.weights ?? {},
        rationale: body.rationale ?? "",
        boardAnswers: body.boardAnswers ?? {},
      });
      const profile = store.getOrCreateLearner(body.learnerId ?? "local-learner");
      let eng = profile.engagement ?? {
        ...emptyEngagement(),
        architectCasesCleared: [] as string[],
      };
      // ensure shape
      if (!("architectCasesCleared" in eng)) {
        (eng as { architectCasesCleared: string[] }).architectCasesCleared = [];
      }
      const cleared = (eng as { architectCasesCleared?: string[] }).architectCasesCleared ?? [];
      eng = bumpFlow(
        eng,
        result.passed ? "board_pass" : "check_fail",
      ) as typeof eng;
      eng = addPrestige(
        eng,
        result.prestigeDelta,
        result.passed ? `Architect case: ${scenario.title}` : undefined,
      ) as typeof eng;
      eng = openLoop(eng, {
        id: `loop-${scenario.id}`,
        title: `Residual risks — ${scenario.title}`,
        missionId: scenario.id,
      }) as typeof eng;
      if (result.passed && !cleared.includes(scenario.id)) {
        cleared.push(scenario.id);
      }
      profile.engagement = {
        prestige: eng.prestige,
        flowScore: eng.flowScore,
        openLoops: eng.openLoops,
        masteryMoments: eng.masteryMoments,
        architectRank: rankFromPrestige(eng.prestige),
        sessionsToday: eng.sessionsToday ?? 0,
        architectCasesCleared: cleared,
      };
      store.saveLearner(profile);
      return json(res, 200, {
        ...result,
        engagement: profile.engagement,
        disclaimer:
          "Architect prestige reflects simulated judgment quality only — not SAP certification or job title.",
      });
    }

    if (req.method === "GET" && path.startsWith("/api/missions/")) {
      const id = decodeURIComponent(path.slice("/api/missions/".length));
      const mission = getMission(id);
      if (!mission) return json(res, 404, { error: "Mission not found" });
      const rt = runtimeFor(id);
      return json(res, 200, {
        mission: publicMission(mission),
        runtime: rt,
        incident: getIncident(rt.incidentId),
      });
    }

    if (req.method === "GET" && path === "/api/learner") {
      const learnerId = url.searchParams.get("learnerId") ?? "local-learner";
      const profile = store.getOrCreateLearner(learnerId);
      if (!profile.engagement) {
        profile.engagement = {
          prestige: 0,
          flowScore: 42,
          openLoops: [],
          masteryMoments: [],
          architectRank: "Apprentice Designer",
          sessionsToday: 0,
          architectCasesCleared: [],
        };
        store.saveLearner(profile);
      }
      const graph = buildCompetencyGraph(loadBundle().bundle.competencies);
      return json(res, 200, {
        profile,
        engagement: profile.engagement,
        curiosityCards: emptyEngagement().curiosityCards,
        unlocked: unlockedCompetencies(
          graph,
          new Set(profile.demonstratedCompetencies),
        ),
        sessions: store.listSessions(learnerId).map((s) => ({
          sessionId: s.sessionId,
          missionId: s.missionId,
          status: s.status,
          updatedAt: s.updatedAt,
          diagnosisCorrect: s.diagnosisCorrect,
          defectFixed: s.defectFixed,
        })),
      });
    }

    if (req.method === "PUT" && path === "/api/learner/settings") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        learnerId?: string;
        settings?: Partial<ReturnType<typeof store.getOrCreateLearner>["settings"]>;
        displayName?: string;
      };
      const profile = store.getOrCreateLearner(body.learnerId ?? "local-learner");
      if (body.settings) profile.settings = { ...profile.settings, ...body.settings };
      if (body.displayName) profile.displayName = body.displayName;
      store.saveLearner(profile);
      return json(res, 200, { profile });
    }

    if (req.method === "POST" && path === "/api/sessions") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        missionId?: string;
        seed?: number;
        learnerId?: string;
      };
      const missionId = body.missionId ?? "r1-northwind-order-insights";
      const mission = getMission(missionId);
      if (!mission) return json(res, 404, { error: "Mission not found" });
      const seed = body.seed ?? 42;
      const learnerId = body.learnerId ?? "local-learner";
      store.getOrCreateLearner(learnerId);
      const rt = runtimeFor(missionId);
      let world = worldFromSeedAndLandscape(seed, buildLandscape(rt.landscapeId));
      world = applyIncident(world, getIncident(rt.incidentId));
      const sessionId = `ses_${Date.now()}_${seed}`;
      const session: SessionRecord = {
        sessionId,
        learnerId,
        missionId,
        seed,
        incidentId: rt.incidentId,
        landscapeId: rt.landscapeId,
        world: serializeWorld(world),
        currentStepId: mission.steps[0]!.id,
        completedStepIds: [],
        answers: [],
        checkResults: {},
        teachReveals: {},
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "in_progress",
      };
      store.saveSession(session);
      const { concepts } = loadBundle();
      const first = mission.steps[0]!;
      const related = (first.conceptIds ?? [])
        .map((cid) => {
          const resolved = resolveConceptId(cid, concepts);
          return concepts.find((c) => c.id === resolved);
        })
        .filter(Boolean);
      return json(res, 201, {
        sessionId,
        mission: publicMission(mission),
        world: snapshotWorld(world),
        currentStepId: session.currentStepId,
        fidelity: mission.fidelity,
        relatedConcepts: related,
        incident: {
          id: rt.incidentId,
          title: getIncident(rt.incidentId).title,
          businessImpact: getIncident(rt.incidentId).businessImpact,
        },
        disclaimer:
          "Simulation fidelity is disclosed. Verify critical SAP facts against official documentation.",
      });
    }

    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(.*)$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]!);
      const rest = sessionMatch[2] || "";
      const session = store.getSession(sessionId);
      if (!session) return json(res, 404, { error: "Session not found" });
      const mission = getMission(session.missionId);
      if (!mission) return json(res, 500, { error: "Mission missing" });

      if (req.method === "GET" && rest === "") {
        return json(res, 200, {
          ...session,
          world: snapshotWorld(sessionWorld(session)),
          mission,
        });
      }

      if (req.method === "GET" && rest === "/world") {
        const world = sessionWorld(session);
        return json(res, 200, {
          world: snapshotWorld(world),
          logs: world.logs,
          metrics: world.metrics,
          traces: world.traces,
          changeHistory: world.changeHistory.slice(-20),
          incidentId: session.incidentId,
        });
      }

      if (req.method === "POST" && rest === "/answer") {
        const body = JSON.parse((await readBody(req)) || "{}") as StepAnswer & {
          advance?: boolean;
        };
        session.answers = [
          ...session.answers.filter((a) => a.stepId !== body.stepId),
          {
            stepId: body.stepId,
            text: body.text,
            diagnosis: body.diagnosis,
            reflection: body.reflection,
            configPatch: body.configPatch,
            selectedOptionIds: body.selectedOptionIds,
          },
        ];
        if (!session.completedStepIds.includes(body.stepId)) {
          session.completedStepIds.push(body.stepId);
        }
        if (body.diagnosis) {
          const world = sessionWorld(session);
          const result = diagnoseIncident(world, session.incidentId, body.diagnosis);
          session.diagnosisCorrect = result.correct;
        }
        if (body.advance) {
          const idx = mission.steps.findIndex((s) => s.id === body.stepId);
          if (idx >= 0 && idx < mission.steps.length - 1) {
            session.currentStepId = mission.steps[idx + 1]!.id;
          }
        }
        store.saveSession(session);
        return json(res, 200, {
          ok: true,
          currentStepId: session.currentStepId,
          completedStepIds: session.completedStepIds,
          diagnosisCorrect: session.diagnosisCorrect,
        });
      }

      if (req.method === "POST" && rest === "/check") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          stepId?: string;
          selectedOptionIds?: string[];
          shortText?: string;
          orderedIds?: string[];
        };
        const step = mission.steps.find((s) => s.id === body.stepId);
        if (!step?.check) return json(res, 400, { error: "Step has no check" });
        const result = evaluateStepCheck(step.check, {
          selectedOptionIds: body.selectedOptionIds,
          shortText: body.shortText,
          orderedIds: body.orderedIds,
        });
        if (!session.checkResults) session.checkResults = {};
        session.checkResults[step.id] = {
          passed: result.passed,
          score: result.score,
          feedback: result.feedback,
          explanation: result.explanation,
        };
        if (result.passed && !session.completedStepIds.includes(step.id)) {
          session.completedStepIds.push(step.id);
        }
        // Save short/mc into answers for evaluation corpus
        session.answers = [
          ...session.answers.filter((a) => a.stepId !== step.id),
          {
            stepId: step.id,
            text: body.shortText,
            selectedOptionIds: body.selectedOptionIds,
            diagnosis: step.kind === "diagnose" ? body.shortText : undefined,
          },
        ];
        store.saveSession(session);
        // Ethical flow bump: competence feedback from real checks
        try {
          const profile = store.getOrCreateLearner(session.learnerId);
          if (profile.engagement) {
            const eng = bumpFlow(
              {
                ...profile.engagement,
                curiosityCards: emptyEngagement().curiosityCards,
              },
              result.passed ? "check_pass" : "check_fail",
            );
            profile.engagement = {
              ...profile.engagement,
              flowScore: eng.flowScore,
            };
            store.saveLearner(profile);
          }
        } catch {
          /* non-fatal */
        }
        return json(res, 200, {
          ...result,
          completedStepIds: session.completedStepIds,
          checkResults: session.checkResults,
        });
      }

      if (req.method === "POST" && rest === "/reveal") {
        const body = JSON.parse((await readBody(req)) || "{}") as { stepId?: string };
        const stepId = body.stepId ?? session.currentStepId;
        if (!session.teachReveals) session.teachReveals = {};
        session.teachReveals[stepId] = (session.teachReveals[stepId] ?? 0) + 1;
        store.saveSession(session);
        return json(res, 200, {
          stepId,
          revealLevel: session.teachReveals[stepId],
        });
      }

      if (req.method === "GET" && rest === "/teach-context") {
        const stepId = url.searchParams.get("stepId") ?? session.currentStepId;
        const step = mission.steps.find((s) => s.id === stepId);
        const { concepts } = loadBundle();
        const related = (step?.conceptIds ?? [])
          .map((cid) => {
            const resolved = resolveConceptId(cid, concepts);
            return concepts.find((c) => c.id === resolved);
          })
          .filter(Boolean);
        return json(res, 200, {
          step,
          relatedConcepts: related,
          checkResult: session.checkResults?.[stepId],
          revealLevel: session.teachReveals?.[stepId] ?? 0,
        });
      }

      if (req.method === "POST" && rest === "/diagnose") {
        const body = JSON.parse((await readBody(req)) || "{}") as { hypothesis?: string };
        const world = sessionWorld(session);
        const result = diagnoseIncident(world, session.incidentId, body.hypothesis ?? "");
        session.diagnosisCorrect = result.correct;
        session.answers = [
          ...session.answers.filter((a) => a.stepId !== "step-diagnose"),
          {
            stepId: "step-diagnose",
            diagnosis: body.hypothesis,
            text: body.hypothesis,
          },
        ];
        store.saveSession(session);
        return json(res, 200, result);
      }

      if (req.method === "POST" && rest === "/fix") {
        const incident = getIncident(session.incidentId);
        let world = sessionWorld(session);
        world = fixIncident(world, session.incidentId);
        persistWorld(session, world);
        session.defectFixed = true;
        store.saveSession(session);
        return json(res, 200, {
          ok: true,
          action: incident.fixAction,
          world: snapshotWorld(world),
          message: `Applied secure remediation (${incident.fixAction}). Re-check health and prevention controls.`,
        });
      }

      if (req.method === "POST" && rest === "/mentor") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          role?: string;
          message?: string;
          hintLevel?: number;
        };
        const step = mission.steps.find((s) => s.id === session.currentStepId);
        const reply = mentorRespond({
          role: (body.role as "socratic_coach") || "socratic_coach",
          stepKind: step?.kind ?? "business_situation",
          learnerMessage: body.message ?? "",
          hintLevel: body.hintLevel,
          diagnosisCorrect: session.diagnosisCorrect,
          missionHints: step?.hints,
        });
        return json(res, 200, reply);
      }

      if (req.method === "POST" && rest === "/evaluate") {
        const checks = Object.values(session.checkResults ?? {});
        const checksPassed = checks.filter((c) => c.passed).length;
        const checksTotal = Math.max(checks.length, 1);
        const conceptCheckScore =
          checks.reduce((a, c) => a + c.score, 0) / checksTotal;
        const result = evaluateMission({
          mission,
          answers: session.answers,
          diagnosisCorrect: session.diagnosisCorrect,
          defectFixed: session.defectFixed,
          architectureDefenseScore: session.answers.some((a) =>
            /identity|security|resilience|cost|reject|alternative/i.test(a.text ?? ""),
          )
            ? 0.85
            : 0.45,
          conceptCheckScore,
          checksPassed,
          checksTotal: checks.length,
        });
        session.lastEvaluation = result;
        if (result.passed) {
          session.status = "completed";
          const profile = store.getOrCreateLearner(session.learnerId);
          for (const id of mission.competencyIds) {
            if (!profile.demonstratedCompetencies.includes(id)) {
              profile.demonstratedCompetencies.push(id);
            }
          }
          if (!profile.completedMissions.includes(mission.id)) {
            profile.completedMissions.push(mission.id);
          }
          profile.evidence.push({
            missionId: mission.id,
            at: new Date().toISOString(),
            overallScore: result.overallScore,
            evidence: result.evidence,
          });
          store.saveLearner(profile);
        }
        store.saveSession(session);
        const graph = buildCompetencyGraph(loadBundle().bundle.competencies);
        const profile = store.getOrCreateLearner(session.learnerId);
        return json(res, 200, {
          ...result,
          unlockedNext: unlockedCompetencies(
            graph,
            new Set(profile.demonstratedCompetencies),
          ),
          demonstratedCompetencies: profile.demonstratedCompetencies,
          disclaimer:
            "Evidence reflects this simulated mission only. Not SAP certification or employment qualification.",
        });
      }

      return json(res, 404, { error: "Unknown session route" });
    }

    if (req.method === "GET" && path === "/api/export") {
      const learnerId = url.searchParams.get("learnerId") ?? "local-learner";
      const profile = store.getOrCreateLearner(learnerId);
      return json(res, 200, {
        exportedAt: new Date().toISOString(),
        profile,
        sessions: store.listSessions(learnerId),
        note: "Local learner data export for portability and deletion rights.",
      });
    }

    if (req.method === "POST" && path === "/api/learner/delete") {
      const body = JSON.parse((await readBody(req)) || "{}") as { learnerId?: string };
      const learnerId = body.learnerId ?? "local-learner";
      const profile = store.getOrCreateLearner(learnerId);
      profile.demonstratedCompetencies = [];
      profile.completedMissions = [];
      profile.evidence = [];
      profile.displayName = "Local Learner";
      store.saveLearner(profile);
      return json(res, 200, { ok: true, message: "Learner progress cleared (local edition)." });
    }

    // Static SPA
    if (req.method === "GET" && !path.startsWith("/api")) {
      if (serveStatic(path, res)) return;
      return json(res, 503, {
        error: "Web UI not built",
        hint: "Run npm run build -w @btp-odyssey/web or npm run dev:web",
      });
    }

    return json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    return json(res, 500, {
      error: "Internal error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

const HOST = process.env.HOST ?? "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`SAP BTP Odyssey http://${HOST}:${PORT}`);
  console.log(`Content: ${contentRoot}`);
  console.log(`Web dist: ${existsSync(webDist) ? webDist : "(not built — use vite dev proxy)"}`);
});
