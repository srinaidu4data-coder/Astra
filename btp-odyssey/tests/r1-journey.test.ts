import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateMission } from "@btp-odyssey/assessment";
import {
  buildCompetencyGraph,
  topologicalOrder,
} from "@btp-odyssey/competency";
import { validateBundle } from "@btp-odyssey/content-engine";
import type { Competency, Domain, Mission } from "@btp-odyssey/shared";
import {
  applyIncident,
  diagnoseIncident,
  fixIncident,
  getIncident,
  MISSION_RUNTIME,
  buildLandscape,
  worldFromSeedAndLandscape,
} from "@btp-odyssey/simulation";

const contentRoot = join(__dirname, "../content");

function loadJsonDir<T>(dir: string): T[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
}

describe("curriculum product pack", () => {
  const domains = loadJsonDir<Domain>(join(contentRoot, "domains"));
  const competencies = loadJsonDir<Competency>(join(contentRoot, "competencies"));
  const missions = loadJsonDir<Mission>(join(contentRoot, "missions"));

  it("validates content bundle", () => {
    const issues = validateBundle({ domains, competencies, missions });
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(domains.length).toBeGreaterThanOrEqual(16);
    expect(competencies.length).toBeGreaterThanOrEqual(40);
    expect(missions.length).toBeGreaterThanOrEqual(8);
  });

  it("competency graph is acyclic", () => {
    const graph = buildCompetencyGraph(competencies);
    const order = topologicalOrder(graph);
    expect(order[0]).toBe("found-landscape");
    expect(order.length).toBe(competencies.length);
  });

  it("every mission has runtime mapping and full loop", () => {
    for (const mission of missions) {
      expect(MISSION_RUNTIME[mission.id], mission.id).toBeTruthy();
      const kinds = new Set(mission.steps.map((s) => s.kind));
      for (const k of [
        "business_situation",
        "requirements",
        "landscape_inspect",
        "architecture_hypothesis",
        "diagnose",
        "resolve",
        "architecture_defense",
        "reflection",
      ]) {
        expect(kinds.has(k), `${mission.id}:${k}`).toBe(true);
      }
      expect(mission.fidelity.tier).toBeTruthy();
    }
  });

  it("plays all missions diagnose → fix → evaluate", () => {
    for (const mission of missions) {
      const rt = MISSION_RUNTIME[mission.id]!;
      let world = worldFromSeedAndLandscape(42, buildLandscape(rt.landscapeId));
      const incident = getIncident(rt.incidentId);
      world = applyIncident(world, incident);

      const good = diagnoseIncident(
        world,
        rt.incidentId,
        incident.diagnoseKeywords.join(" ") + " root cause with evidence",
      );
      expect(good.correct, mission.id).toBe(true);
      world = fixIncident(world, rt.incidentId);

      const result = evaluateMission({
        mission,
        answers: [
          {
            stepId: "step-requirements",
            text: "Functional and non-functional: identity security observability integration events cost privacy constraints",
          },
          {
            stepId: "step-architecture",
            text: "CAP RAP UI5 HANA destination xsuaa event integration reject weak alternative trade residency tenant idempotency",
          },
          {
            stepId: "step-diagnose",
            diagnosis: incident.diagnoseKeywords.join(" "),
            text: incident.diagnoseKeywords.join(" "),
          },
          {
            stepId: "step-reflection",
            text: "assumption failed; evidence corrected me; prevent with control; transfer next; owner assigned",
          },
        ],
        diagnosisCorrect: true,
        defectFixed: true,
        architectureDefenseScore: 0.9,
      });

      expect(result.passed, mission.id).toBe(true);
      expect(result.overallScore, mission.id).toBeGreaterThanOrEqual(0.7);
    }
  });
});
