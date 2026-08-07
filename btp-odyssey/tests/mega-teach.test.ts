import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateStepCheck } from "@btp-odyssey/assessment";
import type { ConceptCard, Mission } from "@btp-odyssey/shared";

const contentRoot = join(__dirname, "../content");

function loadJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
}

describe("mega teach pack", () => {
  const concepts = loadJsonDir<ConceptCard>(join(contentRoot, "concepts"));
  const missions = loadJsonDir<Mission>(join(contentRoot, "missions"));

  it("ships a large concept library", () => {
    expect(concepts.length).toBeGreaterThanOrEqual(45);
    for (const c of concepts) {
      expect(c.explain.length).toBeGreaterThan(40);
      expect(c.analogy.length).toBeGreaterThan(10);
      expect(c.whyItMatters.length).toBeGreaterThan(10);
    }
  });

  it("missions are ultra-granular with teaching on most steps", () => {
    let totalSteps = 0;
    let taught = 0;
    for (const m of missions) {
      expect(m.steps.length).toBeGreaterThanOrEqual(30);
      totalSteps += m.steps.length;
      taught += m.steps.filter((s) => s.teach || s.check).length;
      const withCheck = m.steps.filter((s) => s.check);
      expect(withCheck.length).toBeGreaterThan(10);
    }
    expect(totalSteps).toBeGreaterThanOrEqual(250);
    expect(taught / totalSteps).toBeGreaterThan(0.7);
  });

  it("concept checks evaluate correctly", () => {
    const mission = missions[0]!;
    const step = mission.steps.find((s) => s.check?.type === "mc");
    expect(step?.check).toBeTruthy();
    const correct = step!.check!.options.filter((o) => o.correct).map((o) => o.id);
    const pass = evaluateStepCheck(step!.check!, { selectedOptionIds: correct });
    expect(pass.passed).toBe(true);
    const fail = evaluateStepCheck(step!.check!, {
      selectedOptionIds: step!.check!.options.filter((o) => !o.correct).map((o) => o.id).slice(0, 1),
    });
    expect(fail.passed).toBe(false);
  });
});
