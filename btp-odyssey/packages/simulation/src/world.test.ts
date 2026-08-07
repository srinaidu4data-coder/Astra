import { describe, expect, it } from "vitest";
import {
  applyIncident,
  diagnoseIncident,
  fixIncident,
  getIncident,
  MISSION_RUNTIME,
} from "./incidents.js";
import { buildLandscape } from "./landscapes.js";
import { createRng } from "./rng.js";
import {
  listResources,
  snapshotWorld,
  worldFromSeedAndLandscape,
} from "./world.js";

describe("simulation kernel", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("bootstraps all mission landscapes", () => {
    for (const [missionId, rt] of Object.entries(MISSION_RUNTIME)) {
      const world = worldFromSeedAndLandscape(7, buildLandscape(rt.landscapeId));
      expect(snapshotWorld(world).resourceCount, missionId).toBeGreaterThan(2);
    }
  });

  it("applies and fixes every incident", () => {
    for (const [missionId, rt] of Object.entries(MISSION_RUNTIME)) {
      let world = worldFromSeedAndLandscape(99, buildLandscape(rt.landscapeId));
      const incident = getIncident(rt.incidentId);
      world = applyIncident(world, incident);
      expect(world.logs.length, missionId).toBeGreaterThan(0);

      const wrong = diagnoseIncident(world, rt.incidentId, "office wifi is bad");
      expect(wrong.correct, missionId).toBe(false);

      const hypothesis = incident.diagnoseKeywords.slice(0, 3).join(" ") + " detailed root cause analysis";
      const right = diagnoseIncident(world, rt.incidentId, hypothesis);
      expect(right.correct, missionId).toBe(true);

      world = fixIncident(world, rt.incidentId);
      expect(listResources(world).some((r) => r.health === "healthy"), missionId).toBe(true);
    }
  });
});
