/**
 * Enrich thin concepts + write concept alias map so mission/quest/path IDs all resolve.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "content", "concepts");

function loadAll() {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => {
      const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return { file: f, c };
    });
}

const all = loadAll();
const byId = new Map(all.map(({ c }) => [c.id, c]));

// Aliases: mega-teach IDs (c-*) → full-curriculum IDs where equivalent
const ALIASES = {
  "c-observability": "ops-observability",
  "c-shared-responsibility": "sec-shared-resp",
  "c-functional-nfr": "c-functional-nfr", // keep mega
  "c-global-account": "ops-accounts",
  "c-subaccount": "ops-accounts",
  "c-cf-space": "ops-cf",
  "c-jwt-audience": "sec-jwt-claims",
  "c-idempotency": "cpi-idempotency",
  "c-slo": "ops-sre",
  "c-change-mgmt": "ops-sre",
  "c-finops": "ops-finops",
  "c-least-privilege": "sec-secrets",
  "c-xsuaa-roles": "sec-xsuaa-roles",
  "c-destination": "sec-destinations",
  "c-binding": "cap-persistence",
  "c-scope-403": "sec-authn-authz",
  "c-cap-odata": "cap-services",
  "c-ui5-odata": "odata-v4-basics",
  "c-cap-vs-rap": "rap-vs-cap",
  "c-clean-core": "rap-clean-core",
  "c-draft": "rap-draft",
  "c-retry-backoff": "cpi-exception",
  "c-dlq": "evt-dlq",
  "c-events-mesh": "evt-mesh-concepts",
  "c-data-product": "bdc-data-product",
  "c-lineage": "ds-lineage",
  "c-hana-hdi": "hana-hdi",
  "c-tenant-isolation": "sec-tenant-isolation",
  "c-threat-model": "sec-threat-model",
  "c-iflow": "cpi-iflow",
  "c-residency": "sec-tenant-isolation",
  "c-saga": "evt-saga",
  "c-principal-propagation": "sec-principal-prop",
};

// Ensure alias targets exist; if not, keep source id
const resolvedAliases = {};
for (const [from, to] of Object.entries(ALIASES)) {
  if (byId.has(to)) resolvedAliases[from] = to;
  else if (byId.has(from)) resolvedAliases[from] = from;
}

// Enrich thin concepts
let enriched = 0;
for (const { file, c } of all) {
  let changed = false;
  if (!c.explain || c.explain.length < 80) {
    c.explain = [
      c.explain || c.summary || c.title,
      "",
      `### What it is`,
      `${c.title} is a core building block in the SAP BTP learning map (domain: ${c.domainId}, level: ${c.level}).`,
      ``,
      `### How you use it`,
      ...(c.howToApply?.length
        ? c.howToApply.map((x) => `- ${x}`)
        : [`- Apply ${c.title} explicitly when designing or diagnosing a landscape.`]),
      ``,
      `### How you recognize problems`,
      ...(c.howToRecognize?.length
        ? c.howToRecognize.map((x) => `- ${x}`)
        : [`- Incidents or design reviews that touch ${c.domainId} often involve ${c.title}.`]),
      ``,
      `### Common mistakes`,
      ...(c.commonMistakes?.length
        ? c.commonMistakes.map((x) => `- ${x}`)
        : [`- Treating ${c.title} as trivia instead of an operational constraint.`]),
      ``,
      `### Practice prompt`,
      `In one paragraph, explain ${c.title} to a non-expert, then name one failure mode if it is ignored.`,
      ``,
      `(Simulation content — verify production facts in official SAP documentation.)`,
    ].join("\n");
    changed = true;
  }
  if (!c.analogy || c.analogy.length < 20) {
    c.analogy = `Imagine ${c.title} as a labeled control on an aircraft panel: you must know what it does before you flip it in an incident.`;
    changed = true;
  }
  if (!c.whyItMatters || c.whyItMatters.length < 20) {
    c.whyItMatters = `Skipping ${c.title} leads to weak architecture defenses and slow incident diagnosis.`;
    changed = true;
  }
  if (!c.formalPoints?.length) {
    c.formalPoints = [c.summary || c.title, `Domain: ${c.domainId}`, `Level: ${c.level}`];
    changed = true;
  }
  if (!c.commonMistakes?.length) {
    c.commonMistakes = [`Memorizing the name without a concrete example of ${c.title}`];
    changed = true;
  }
  if (!c.howToApply?.length) {
    c.howToApply = [
      `Write one architecture sentence that depends on ${c.title}.`,
      `List one metric or log that would prove ${c.title} is healthy.`,
    ];
    changed = true;
  }
  if (!c.glossary) c.glossary = [];
  if (changed) {
    writeFileSync(join(dir, file), JSON.stringify(c, null, 2) + "\n");
    enriched++;
  }
}

// Write alias map for API
mkdirSync(join(root, "content", "meta"), { recursive: true });
writeFileSync(
  join(root, "content", "meta", "concept-aliases.json"),
  JSON.stringify(
    {
      version: "1.0.0",
      aliases: resolvedAliases,
      note: "Map legacy/mega concept IDs to canonical content IDs",
    },
    null,
    2,
  ) + "\n",
);

// Rebuild index
const ids = all.map(({ c }) => c.id).sort();
writeFileSync(
  join(dir, "index.json"),
  JSON.stringify(
    {
      version: "3.1.0",
      count: ids.length,
      ids,
      domainsCovered: [...new Set(all.map(({ c }) => c.domainId))].sort(),
    },
    null,
    2,
  ) + "\n",
);

console.log(
  JSON.stringify(
    { concepts: ids.length, enriched, aliases: Object.keys(resolvedAliases).length },
    null,
    2,
  ),
);
