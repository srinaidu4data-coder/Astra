/**
 * Enrich every concept with:
 * - mnemonic (memory hook)
 * - useCases (clear pictures)
 * - designTradeoffs (3+ architect-level)
 * - linkedGames (intro + mastery challenges)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "../content/concepts");

function trade(decision, optionA, optionB, whenA, whenB, risk) {
  return { decision, optionA, optionB, whenChooseA: whenA, whenChooseB: whenB, risk };
}

/** Domain-level default trade-offs */
const DOMAIN_TRADES = {
  security: [
    trade(
      "Authn placement",
      "Central IdP + token validation at every edge",
      "App-local user stores",
      "Enterprise SSO, audit, many apps",
      "Tiny isolated prototype only",
      "Local stores fragment identity and weaken IR",
    ),
    trade(
      "Authorization grain",
      "Fine scopes per action",
      "Broad Admin.All roles",
      "Production multi-team landscapes",
      "Never in prod — only throwaway sandboxes",
      "Broad roles maximize blast radius",
    ),
    trade(
      "Tenant isolation",
      "Server-side tenant predicate on every query",
      "UI-only filtering",
      "Multi-tenant SaaS / shared DB",
      "Single-tenant dedicated DB (still validate)",
      "UI filters are not a security boundary",
    ),
  ],
  cap: [
    trade(
      "Extension style",
      "CAP side-by-side service",
      "On-stack RAP near BO",
      "Differentiating UX/API velocity, multi-cloud events",
      "Tight transactional fidelity to S/4 BO",
      "Wrong placement creates dual-write or upgrade pain",
    ),
    trade(
      "API surface",
      "Narrow projections + actions",
      "Expose full persistence model",
      "Stable contracts for consumers",
      "Internal-only tools with no external clients",
      "Wide APIs couple consumers to schema churn",
    ),
    trade(
      "Persistence",
      "HDI-owned schema with least privilege",
      "Shared ad-hoc schema",
      "Team isolation and CI deploys",
      "Throwaway spike",
      "Shared schemas block ownership and safe deploy",
    ),
  ],
  "rap-abap": [
    trade(
      "RAP managed vs unmanaged",
      "Managed RAP for standard CRUD patterns",
      "Unmanaged for special persistence control",
      "Standard BO lifecycle with framework help",
      "Complex legacy persistence you must own",
      "Unmanaged increases maintenance surface",
    ),
    trade(
      "Clean core",
      "Released APIs + extensions",
      "Modify SAP standard",
      "Always for sustainable landscapes",
      "Never — false short-term speed",
      "Core mods poison upgrades",
    ),
    trade(
      "Draft",
      "Draft-enabled long edits",
      "Immediate save only",
      "Multi-step UX with exclusive locks",
      "Simple atomic transactions",
      "Draft without cleanup creates lock/orphan debt",
    ),
  ],
  integration: [
    trade(
      "Sync vs event",
      "Event-driven projection from SoR",
      "Dual-write both systems in one UI tx",
      "Loose coupling, fan-out consumers",
      "Strict same-transaction need (rare & costly)",
      "Dual-write desync under partial failure",
    ),
    trade(
      "Delivery",
      "At-least-once + idempotent handlers",
      "Assume exactly-once network",
      "All partner and cloud integrations",
      "Never assume — networks retry",
      "Duplicates become double posts",
    ),
    trade(
      "Error path",
      "DLQ + owner + replay runbook",
      "Drop poison silently",
      "Production integrations",
      "Never",
      "Silent loss destroys trust",
    ),
  ],
  events: [
    trade(
      "Event vs command",
      "Events as facts, many consumers",
      "Commands as intent, one handler",
      "Broadcast state changes",
      "Directed do-this actions",
      "Mixing styles confuses ownership",
    ),
    trade(
      "Schema evolution",
      "Additive compatible changes",
      "Breaking fields without version",
      "Multi-consumer landscapes",
      "Single controlled consumer only",
      "Breaks silent consumers",
    ),
    trade(
      "Ordering",
      "Partition keys + consumer design for out-of-order",
      "Global total order everywhere",
      "Scale and availability",
      "Tiny volumes where order is free",
      "Global order kills throughput",
    ),
  ],
  operations: [
    trade(
      "Account structure",
      "Separate dev/test/prod subaccounts",
      "One shared subaccount",
      "Any serious landscape",
      "Personal sandbox only",
      "Shared subaccounts maximize blast radius",
    ),
    trade(
      "Entitlements",
      "Least service plans per stage",
      "Enable everything everywhere",
      "Cost and security control",
      "Never long-term",
      "Cost and attack surface grow",
    ),
    trade(
      "Observability",
      "Logs + metrics + traces with correlation",
      "CPU screenshots only",
      "Operable production",
      "Local demos",
      "You cannot fix what you cannot see",
    ),
  ],
  architecture: [
    trade(
      "Platform placement",
      "BTP for extension/integration",
      "Force all logic into core mods",
      "Clean-core strategy",
      "Never for sustainable ERP",
      "Core mods block upgrades",
    ),
    trade(
      "Service count",
      "Few services, clear owners",
      "One service per team preference",
      "Operability and cost",
      "Hackathons only",
      "Tool sprawl without architecture",
    ),
    trade(
      "Decision record",
      "Write trade-offs with constraints",
      "Tribal knowledge only",
      "Always for enterprise",
      "Never",
      "Re-litigate every review",
    ),
  ],
  ai: [
    trade(
      "Grounding",
      "RAG/tools over approved corpora + citations",
      "Unconstrained free generation",
      "Enterprise answers and actions",
      "Creative brainstorming offline only",
      "Hallucinations become decisions",
    ),
    trade(
      "Tool agency",
      "Scoped tools + human confirm for high risk",
      "Agent can call anything",
      "Any production agent",
      "Never",
      "Unscoped tools are breach paths",
    ),
    trade(
      "Model routing",
      "Route by task (cost/latency/quality)",
      "Always largest model",
      "Scale and SLOs",
      "Tiny experiments",
      "Cost and latency explode",
    ),
  ],
  "hana-cloud": [
    trade(
      "Compute placement",
      "Push heavy logic to DB carefully",
      "Pull huge sets to app",
      "Analytical aggregates",
      "Tiny datasets",
      "Network and memory blow up",
    ),
    trade(
      "HDI isolation",
      "Containerized deployable artifacts",
      "Shared wild schema",
      "Team CI/CD",
      "Throwaway",
      "No safe ownership",
    ),
    trade(
      "Privileges",
      "Least privilege DB roles",
      "SAP_ALL style access",
      "Always production",
      "Never",
      "Data exfil risk",
    ),
  ],
  datasphere: [
    trade(
      "Semantic layer",
      "Governed metrics in semantic models",
      "Each report invents definitions",
      "Enterprise KPIs",
      "Personal sandbox",
      "Conflicting numbers destroy trust",
    ),
    trade(
      "Federation vs replicate",
      "Federate when freshness + governance allow",
      "Copy everything always",
      "Latency/cost trade-offs",
      "When offline/performance requires",
      "Blind copies create residency/cost issues",
    ),
    trade(
      "Spaces",
      "Space boundaries by ownership",
      "One mega space",
      "Multi-team data products",
      "Tiny single team",
      "Access and cost blur",
    ),
  ],
  bdc: [
    trade(
      "Data product",
      "Owned product with SLA + interface",
      "Raw table dump",
      "Cross-team consumption",
      "Never for shared enterprise use",
      "Dumps have no contract",
    ),
    trade(
      "Governance",
      "Steward + quality metrics",
      "Hope and tribal knowledge",
      "Always",
      "Never",
      "Silent quality decay",
    ),
    trade(
      "Lakehouse layers",
      "Bronze/silver/gold progression",
      "Consumers on raw only",
      "Scale analytics",
      "Tiny files",
      "Raw access bypasses quality",
    ),
  ],
  sac: [
    trade(
      "Live vs import",
      "Live for current operational truth",
      "Import for snapshot performance",
      "Need freshness",
      "Need offline/perf snapshots",
      "Wrong mode misleads decisions",
    ),
    trade(
      "Security",
      "Model + folder + row constraints",
      "Share all stories widely",
      "Sensitive KPIs",
      "Public non-sensitive only",
      "Export leaks",
    ),
    trade(
      "Metric ownership",
      "One definition in semantic layer",
      "Story-local calculations",
      "Enterprise reporting",
      "Personal exploration",
      "Conflicting revenue numbers",
    ),
  ],
  bpa: [
    trade(
      "Workflow vs full app",
      "BPA for human approval chains",
      "Full CAP/RAP app",
      "Form+approve dominant",
      "Rich domain UX/API needed",
      "Wrong tool under/overbuilds",
    ),
    trade(
      "Rules location",
      "Versioned decision rules",
      "Hardcode in UI scripts",
      "Changing policy",
      "Static never-change rules",
      "UI hardcode resists audit",
    ),
    trade(
      "Governance",
      "Publish rights + data access reviews",
      "Citizen automation free-for-all",
      "Enterprise",
      "Never long-term",
      "Shadow IT and leaks",
    ),
  ],
  workzone: [
    trade(
      "Content governance",
      "Role-based content + review",
      "Anyone publishes anywhere",
      "Enterprise portal",
      "Team wiki only",
      "Stale/wrong content at scale",
    ),
    trade(
      "Federation",
      "Federate with trust + latency budgets",
      "Deep copy everything",
      "Multi-source workplaces",
      "Single source simple sites",
      "Latency and auth debt",
    ),
    trade(
      "Perf",
      "Lazy load + measure RUM",
      "Ship giant bundles",
      "Global users",
      "LAN-only demos",
      "UX SLO fails",
    ),
  ],
  "ui5-fiori": [
    trade(
      "Fiori elements vs freestyle",
      "Elements when annotations suffice",
      "Freestyle for unique UX",
      "Standard floorplans",
      "Highly custom interaction",
      "Freestyle multiplies cost",
    ),
    trade(
      "OData binding",
      "Server-side filter/page",
      "Load all then filter in UI",
      "Large sets",
      "Tiny lists",
      "Browser memory death",
    ),
    trade(
      "Accessibility",
      "Keyboard/contrast as requirements",
      "Mouse-only demos",
      "Always enterprise",
      "Never",
      "Legal and inclusion risk",
    ),
  ],
  incident: [
    trade(
      "Detection",
      "SLO burn alerts",
      "Wait for executive email",
      "Always",
      "Never",
      "Late detection multiplies impact",
    ),
    trade(
      "Response",
      "Runbook + evidence preserve",
      "Restart everything blindly",
      "Production IR",
      "Local toy systems",
      "Destroys root cause",
    ),
    trade(
      "Comms",
      "Clear status + ETA culture",
      "Silence",
      "Customer-facing systems",
      "Never",
      "Trust collapse",
    ),
  ],
};

function defaultDomainTrades(domainId) {
  return DOMAIN_TRADES[domainId] || DOMAIN_TRADES.architecture;
}

function mnemonicFor(c) {
  const s = `${c.id} ${c.title}`.toLowerCase();
  if (/btp-what|what is/.test(s)) return "VAULT + BRANCHES: S/4 is the vault; BTP is the modern branches around it — don't demolish the vault.";
  if (/platform-structure|global account|subaccount/.test(s)) return "HQ → FLOORS → ROOMS: Global account HQ, directories floors, subaccounts locked rooms.";
  if (/services-map/.test(s)) return "CITY MAP: Learn districts (integration, data, AI) before picking a street (service).";
  if (/security-admin|least.?priv|scope|xsuaa|role/.test(s)) return "KEYS ≠ BADGES: Admin keys open buildings; scopes/badges open rooms. Never master-key everyone.";
  if (/authn|authz/.test(s)) return "WHO then WHAT: Authn proves who; Authz decides what. Login ≠ permission.";
  if (/jwt|audience|claim/.test(s)) return "PASSPORT STAMP: Token is passport; audience is the visa country. Wrong visa → 401.";
  if (/destination/.test(s)) return "COURIER BAG: Destination is the sealed bag (URL+auth) between apps.";
  if (/tenant|isolat/.test(s)) return "HOTEL WALLS: Tenant walls are load-bearing — not curtains (UI filters).";
  if (/principal|propagat/.test(s)) return "NAME TAG TRAVELS: The human's name tag must ride every hop for audit.";
  if (/clean.?core|rap-clean/.test(s)) return "DON'T CARVE THE CROWN: Extend the kingdom; don't chisel the crown jewels (standard code).";
  if (/rap.?vs.?cap|cap.?vs.?rap/.test(s)) return "KNIGHT vs BISHOP: RAP knight stays near the king (core); CAP bishop ranges side-by-side.";
  if (/idempot/.test(s)) return "TWICE-CLICK ONCE: Retries may fire twice; business result must happen once.";
  if (/dlq|dead.?letter/.test(s)) return "LOST & FOUND with OWNER: DLQ is not trash — named owner + replay.";
  if (/event|mesh/.test(s)) return "NEWSFLASH not PHONE CALL: Events broadcast facts; don't dual-write two editors.";
  if (/odata|expand|query.?perf/.test(s)) return "EXPAND = EXPLOSION: Each $expand multiplies payload — bound it or p99 dies.";
  if (/slo|sre/.test(s)) return "PROMISE + BUDGET: SLO is the promise; error budget is the fuel for change.";
  if (/hallucin|rag|ground/.test(s)) return "OPEN-BOOK TEST: Don't let the model guess closed-book — retrieve then answer.";
  if (/data.?product|bdc/.test(s)) return "PRODUCT not DUMP: Owner + contract + quality — not a pile of tables.";
  if (/draft/.test(s)) return "SKETCH then INK: Draft is pencil; activate is ink.";
  if (/finops|cost/.test(s)) return "ARCHITECTURE HAS A BILL: Every runtime is a monthly decision.";
  if (/mta|binding/.test(s)) return "BUNDLE + PLUG: MTA ships the bundle; binding plugs secrets without hardcode.";
  if (/threat|zero.?trust/.test(s)) return "ASSUME BREACH: Verify every call; network location is not trust.";
  if (/saga/.test(s)) return "TV SEASON not MOVIE: Long business tx as episodes with compensations, not one 2PC film.";
  if (/csrf/.test(s)) return "FORGED ORDER SLIP: Browser tricked into action — token the writes.";
  if (/observ|trace|metric|log/.test(s)) return "THREE CAMERAS: Logs dialogue, metrics score, traces camera moves — correlate them.";
  // generic but sticky
  const word = (c.title || c.id).split(/\s+/)[0];
  return `NAME IT TO TAME IT: Say “${c.title}” + one failure mode out loud — if you can't, you don't own it yet. (${word} → mechanism → failure)`;
}

function useCasesFor(c) {
  const t = c.title;
  const domain = c.domainId;
  const base = [
    `Greenfield design workshop: decide if “${t}” is required given constraints (latency, clean-core, team skills).`,
    `Incident bridge: symptoms appear; use “${t}” to classify the failing hop before changing config.`,
    `Architecture review board: defend why you accepted residual risk around “${t}”.`,
  ];
  // specialized extras
  const s = `${c.id} ${t}`.toLowerCase();
  if (/jwt|destination|auth/.test(s)) {
    base[0] = `Fiori app calls CAP and gets 401 after login — apply ${t} to fix the trust chain.`;
  }
  if (/tenant/.test(s)) {
    base[1] = `Multi-tenant SaaS demo: Tenant B token must not read Tenant A orders — prove ${t}.`;
  }
  if (/cap|rap|clean/.test(s)) {
    base[0] = `Discount approval near S/4 — choose placement using ${t} without core mods.`;
  }
  if (/idempot|iflow|event/.test(s)) {
    base[1] = `Partner retries the same order POST — ${t} prevents double billing.`;
  }
  if (/ai|rag|hallucin/.test(s)) {
    base[0] = `Support chatbot answers policy — ${t} forces grounding before actions.`;
  }
  if (/data.?product|semantic|sac/.test(s)) {
    base[2] = `Finance and Sales disagree on “revenue” — ${t} forces one productized definition.`;
  }
  if (domain === "operations") {
    base[0] = `Landing zone setup week: apply ${t} so Dev/Test/Prod don't share blast radius.`;
  }
  return base.slice(0, 3);
}

function keywordTrades(c) {
  const s = `${c.id} ${c.title}`.toLowerCase();
  if (/jwt|audience/.test(s)) {
    return [
      trade("Audience config", "Destination/API audience aligned to resource", "Reuse one audience for all apps", "Multi-app landscapes", "Never in shared prod", "Cross-app token acceptance"),
      trade("Token validation", "Validate iss, aud, exp, signature", "Trust any bearer string", "All APIs", "Never", "Forged tokens"),
      trade("Error handling", "Distinct 401 vs 403 diagnostics", "Generic 500 for all auth fails", "Operable IR", "Never", "Wrong fix path"),
    ];
  }
  if (/idempot/.test(s)) {
    return [
      trade("Key design", "Natural business key + idempotency store", "Random UUID each retry", "Partners retry", "Never", "Duplicates"),
      trade("Side effects", "Dedupe before post to finance", "Post then hope", "Money movements", "Read-only probes", "Double charge"),
      trade("Storage TTL", "Retain keys for retry window", "Forget immediately", "At-least-once channels", "Exactly-once mythical middleware only", "Replay storms"),
    ];
  }
  if (/tenant/.test(s)) {
    return [
      trade("Isolation layer", "App + DB predicates", "UI hide only", "Shared tenancy", "Dedicated single-tenant infra", "Cross-tenant read"),
      trade("Testing", "Negative tests with foreign IDs", "Happy path only", "Always", "Never", "False confidence"),
      trade("Ops access", "Break-glass audited", "Standing admin across tenants", "Support needs", "Never standing", "Insider risk"),
    ];
  }
  if (/clean.?core|rap.?vs.?cap/.test(s)) {
    return [
      trade("Logic placement", "RAP on-stack for BO fidelity", "CAP side-by-side for velocity", "Transactional purity", "Differentiating UX/API", "Dual-write if both write same truth"),
      trade("Upgrade", "Released APIs only", "Implicit internal APIs", "Clean core", "Throwaway", "Break on upgrade"),
      trade("Team fit", "Match to ABAP vs Node skills", "Ignore skills", "Year-1 delivery", "Never ignore", "Schedule slip"),
    ];
  }
  if (/odata|expand|perf/.test(s)) {
    return [
      trade("Query shape", "Bound $expand + $select + page", "Unbounded deep expand", "Any list UX", "Never for large graphs", "p99 collapse"),
      trade("Chatty vs chunky", "Fewer round-trips with projections", "N+1 from UI", "Mobile/high latency", "LAN demos", "Latency budget death"),
      trade("Caching", "Cache stable reference data", "Cache personalized secured data carelessly", "Reference data", "Sensitive per-user", "Stale or leak"),
    ];
  }
  if (/ai|rag|hallucin|agent|prompt/.test(s)) {
    return [
      trade("Answer policy", "Ground + cite or abstain", "Always invent fluent answers", "Enterprise Q&A", "Fiction writing", "Wrong actions"),
      trade("Actions", "Confirm high-risk tool calls", "Autonomous spend/change", "Agents with tools", "Never auto high-risk", "Runaway changes"),
      trade("Data in context", "Minimize PII in prompts", "Paste full customer records", "Privacy regimes", "Never paste freely", "Leak via logs/providers"),
    ];
  }
  return null;
}

function enrich(c) {
  const kw = keywordTrades(c);
  const trades = (kw || defaultDomainTrades(c.domainId)).slice(0, 3);
  // ensure exactly at least 3
  while (trades.length < 3) {
    trades.push(
      trade(
        `${c.title} depth`,
        `Invest in robust ${c.title}`,
        `Defer ${c.title}`,
        "When risk/impact is material",
        "When truly out of scope this release (document residual risk)",
        "Hidden debt returns as incidents",
      ),
    );
  }

  const mnemonic = c.mnemonic && String(c.mnemonic).length > 20 ? c.mnemonic : mnemonicFor(c);
  const useCases =
    Array.isArray(c.useCases) && c.useCases.length >= 3 ? c.useCases.slice(0, 5) : useCasesFor(c);
  const designTradeoffs =
    Array.isArray(c.designTradeoffs) && c.designTradeoffs.length >= 3
      ? c.designTradeoffs
      : trades;

  const linkedGames = [
    {
      id: `ch-${c.id}-intro`,
      title: `Intro: What is ${c.title}?`,
      role: "intro",
      purpose: "First contact — recognize the idea, reject traps, place the control.",
    },
    {
      id: `ch-${c.id}-when`,
      title: `When to use: ${c.title}`,
      role: "when",
      purpose: "Timing radar — pick the right moment; reject vanity or late-only timing.",
    },
    {
      id: `ch-${c.id}-how`,
      title: `How to use: ${c.title}`,
      role: "how",
      purpose: "Procedure pipeline — sequence apply steps, place on the hop, verify evidence.",
    },
    {
      id: `ch-${c.id}-trap`,
      title: `Trap / misuse: ${c.title}`,
      role: "trap",
      purpose: "When NOT — name the anti-pattern, blast radius, re-arm the control.",
    },
    {
      id: `ch-${c.id}-scenario`,
      title: `Scenario story: ${c.title}`,
      role: "scenario",
      purpose: "Live project scene — when to engage and how to act under a real trigger.",
    },
    {
      id: `ch-${c.id}-compare`,
      title: `Compare tradeoff: ${c.title}`,
      role: "compare",
      purpose: "When this control vs defer/alternative — risk, cost, reversibility.",
    },
    {
      id: `ch-${c.id}-mastery`,
      title: `Mastery: ${c.title}`,
      role: "mastery",
      purpose: "Pressure check — mechanism, business risk, hub apply, peak-end seal.",
    },
  ];

  return {
    ...c,
    mnemonic,
    useCases,
    designTradeoffs,
    linkedGames,
    memoryHook: mnemonic,
  };
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json");
let n = 0;
for (const f of files) {
  const p = join(dir, f);
  const c = JSON.parse(readFileSync(p, "utf8"));
  if (!c.id) continue;
  const e = enrich(c);
  writeFileSync(p, JSON.stringify(e, null, 2) + "\n");
  n++;
}
console.log(`Enriched ${n} concepts with mnemonics, use cases, trade-offs, linkedGames`);
