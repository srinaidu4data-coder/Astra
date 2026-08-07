import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const contentRoot = join(root, "content");

// Resolve via workspace after build, or use vitest path — for zero-build validate,
// inline minimal validation using dynamic import of source via ts is hard;
// use a pure JS reimplementation calling built packages if present, else inline zod-less checks.

import { readFileSync, readdirSync, existsSync } from "node:fs";

function loadDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

const domains = loadDir(join(contentRoot, "domains"));
const competencies = loadDir(join(contentRoot, "competencies"));
const missions = loadDir(join(contentRoot, "missions"));

const errors = [];
const warnings = [];

const domainIds = new Set(domains.map((d) => d.id));
const competencyIds = new Set(competencies.map((c) => c.id));

for (const d of domains) {
  if (!d.id || !d.title) errors.push(`domain missing id/title`);
  if (!d.sources?.length) warnings.push(`domain ${d.id}: no sources`);
}

for (const c of competencies) {
  if (!c.id || !c.title) errors.push(`competency missing id/title`);
  if (!domainIds.has(c.domainId)) errors.push(`competency ${c.id}: bad domain ${c.domainId}`);
  for (const p of c.prerequisites || []) {
    if (!competencyIds.has(p)) errors.push(`competency ${c.id}: unknown prereq ${p}`);
  }
  if (!c.sources?.length) warnings.push(`competency ${c.id}: no sources`);
}

for (const m of missions) {
  if (!m.id || !m.steps?.length) errors.push(`mission ${m.id || "?"}: missing steps`);
  if (!m.fidelity?.tier) errors.push(`mission ${m.id}: missing fidelity.tier`);
  for (const d of m.domainIds || []) {
    if (!domainIds.has(d)) errors.push(`mission ${m.id}: unknown domain ${d}`);
  }
  for (const c of m.competencyIds || []) {
    if (!competencyIds.has(c)) errors.push(`mission ${m.id}: unknown competency ${c}`);
  }
}

console.log(
  JSON.stringify(
    {
      domains: domains.length,
      competencies: competencies.length,
      missions: missions.length,
      errors,
      warnings,
    },
    null,
    2,
  ),
);

if (errors.length) {
  console.error("CONTENT VALIDATION FAILED");
  process.exit(1);
}
console.log("CONTENT VALIDATION OK");
