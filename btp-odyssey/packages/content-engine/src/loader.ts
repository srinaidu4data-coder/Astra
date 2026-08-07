import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Competency, ConceptCard, Domain, Mission } from "@btp-odyssey/shared";
import { assertValidBundle, type ContentBundle, validateBundle } from "./validate.js";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadJsonDir<T>(dir: string, skipIndex = true): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && (!skipIndex || f !== "index.json"))
    .map((f) => readJson<T>(join(dir, f)));
}

export function loadContentRoot(root: string): ContentBundle {
  const domains = loadJsonDir<Domain>(join(root, "domains"));
  const competencies = loadJsonDir<Competency>(join(root, "competencies"));
  const missions = loadJsonDir<Mission>(join(root, "missions"));
  const bundle = { domains, competencies, missions };
  assertValidBundle(bundle);
  return bundle;
}

export function loadContentRootSoft(root: string): {
  bundle: ContentBundle;
  issues: ReturnType<typeof validateBundle>;
  concepts: ConceptCard[];
} {
  const domains = loadJsonDir<Domain>(join(root, "domains"));
  const competencies = loadJsonDir<Competency>(join(root, "competencies"));
  const missions = loadJsonDir<Mission>(join(root, "missions"));
  const concepts = loadJsonDir<ConceptCard>(join(root, "concepts"));
  const bundle = { domains, competencies, missions };
  return { bundle, issues: validateBundle(bundle), concepts };
}
