import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(root, "data", "runtime");
mkdirSync(runtime, { recursive: true });
writeFileSync(
  join(runtime, "seed-meta.json"),
  JSON.stringify(
    {
      seed: 42,
      missionId: "r1-northwind-order-insights",
      learnerId: "local-learner",
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log("Seed metadata written to data/runtime/seed-meta.json");
