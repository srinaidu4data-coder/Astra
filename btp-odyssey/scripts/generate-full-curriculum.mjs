/**
 * Full BTP curriculum: Security, CAP, OData, RAP, CPI/IS, BPA, Joule/AI,
 * BDC, Databricks, Datasphere, SAC, HANA Cloud — basic → advanced → expert.
 * Ethical product only: no gambling, shame streaks, or dark patterns.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const content = join(root, "content");

function w(rel, obj) {
  const p = join(content, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

/** @type {any[]} */
const concepts = [];

function add(domainId, level, id, title, summary, explain, extra = {}) {
  concepts.push({
    id,
    title,
    domainId,
    level,
    summary,
    explain: `${explain} (Tier 1–2 simulation fidelity — verify production details in official SAP docs.)`,
    analogy: extra.analogy || `Think of "${title}" as a named building block you must explain under pressure.`,
    whyItMatters:
      extra.why ||
      `Without ${title}, you mis-diagnose incidents and make weak architecture choices.`,
    formalPoints: extra.points || [summary],
    commonMistakes: extra.mistakes || [`Memorizing the name of ${title} without a failure story`],
    howToRecognize: extra.recognize || [`Appears when discussing ${domainId}`],
    howToApply: extra.apply || [`Use ${title} explicitly in a design defense sentence`],
    relatedIds: extra.related || [],
    glossary: extra.glossary || [],
    sources: [
      {
        title: "SAP documentation hubs (verify current)",
        url: "https://help.sap.com/docs/btp",
        confidence: "medium",
      },
    ],
    tags: [level, domainId, ...(extra.tags || [])],
  });
}

// ——— SECURITY (basic → expert) ———
const sec = "security";
add(sec, "basic", "sec-shared-resp", "Shared responsibility on BTP", "Who secures what", "SAP secures platform layers; you secure apps, identities, data, configs, and tenants.");
add(sec, "basic", "sec-authn-authz", "Authentication vs authorization", "Identity proof vs permissions", "Authn proves who you are; authz decides what you may do. 401 vs 403 diagnosis depends on this split.");
add(sec, "basic", "sec-ias-ips", "Cloud Identity Services concepts", "IAS/IPS overview", "Identity Authentication and Identity Provisioning (terminology evolves) centralize SSO and user lifecycle concepts.");
add(sec, "basic", "sec-oauth-oidc", "OAuth 2.0 and OIDC basics", "Tokens and identity layers", "OAuth delegates access; OIDC adds identity layer. Tokens carry claims resources validate.");
add(sec, "basic", "sec-destinations", "Destinations security role", "Connectivity + auth config", "Destinations store URL and auth method so apps do not hard-code secrets.");
add(sec, "advanced", "sec-jwt-claims", "JWT claims deep dive", "aud, scope, exp, iss", "Audience, scopes, expiry, issuer must match resource expectations; valid signature is not enough.");
add(sec, "advanced", "sec-xsuaa-roles", "Role templates and role collections", "Scopes to people", "Apps declare scopes; admins assign role collections to users/groups.");
add(sec, "advanced", "sec-principal-prop", "Principal propagation concepts", "User identity across hops", "Forward end-user identity instead of god technical users; hybrid patterns involve Cloud Connector concepts.");
add(sec, "advanced", "sec-secrets", "Secrets and key rotation", "Credential lifecycle", "Store secrets in managed stores; rotate; never commit credentials; least privilege service users.");
add(sec, "advanced", "sec-threat-model", "Threat modeling BTP apps", "STRIDE-lite for landscapes", "Enumerate assets, trust boundaries, adversaries, and mitigations before coding.");
add(sec, "expert", "sec-tenant-isolation", "Tenant isolation patterns", "Hard multi-tenant boundaries", "Mandatory tenant predicates, isolation tests, break-glass, audit — Admin.All is an anti-pattern.");
add(sec, "expert", "sec-zero-trust", "Zero trust on BTP landscapes", "Never trust network location", "Authenticate and authorize every hop; continuous verification; minimize standing privilege.");
add(sec, "expert", "sec-supply-chain", "Supply-chain and dependency security", "SBOM and scans", "Dependency scanning, SBOMs, signed artifacts, controlled build pipelines.");
add(sec, "expert", "sec-incident-ir", "Security incident response", "Contain, eradicate, learn", "Triage, forensics evidence, customer comms, root cause, prevention controls.");

// ——— CAP + ODATA ———
const cap = "cap";
add(cap, "basic", "cap-what", "What is CAP", "Cloud Application Programming Model", "CAP is a framework for services and domain models with CDS, supporting Node.js/Java runtimes.");
add(cap, "basic", "cap-cds-entities", "CDS entities and associations", "Domain modeling", "Entities model data; associations/compositions express relationships.");
add(cap, "basic", "cap-services", "Service definitions and projections", "API surface", "Services expose projections of the domain model to consumers.");
add(cap, "basic", "odata-v4-basics", "OData V4 basics", "REST protocol for business data", "Entity sets, keys, queries ($filter,$expand), metadata drive clients like UI5.");
add(cap, "basic", "odata-v2-vs-v4", "OData V2 vs V4", "Protocol differences", "V4 is modern default for many new CAP UIs; V2 still appears in landscapes — clients are not freely interchangeable.");
add(cap, "advanced", "cap-auth", "CAP authentication and authorization", "Restricting services", "Configure auth strategies and restrict entity/operations by roles/attributes.");
add(cap, "advanced", "cap-persistence", "CAP persistence and HANA", "Binding to databases", "CAP binds to persistence (often HANA); deploy design-time artifacts carefully.");
add(cap, "advanced", "cap-actions", "Actions and functions", "Custom operations", "Bound/unbound actions extend CRUD with domain operations.");
add(cap, "advanced", "cap-events", "CAP messaging and events", "Async side effects", "Emit/consume events for decoupled processes; still need idempotency.");
add(cap, "advanced", "odata-query-perf", "OData query performance", "Expand, filter, paging", "Unbounded expands and missing paging create production outages.");
add(cap, "expert", "cap-multitenant", "CAP multitenancy concepts", "SaaS isolation", "Tenant onboarding, data isolation, subscription lifecycle — advanced platform concern.");
add(cap, "expert", "cap-extensibility", "CAP extensibility", "SaaS partner extensions", "Extension models let consumers extend without forking core.");
add(cap, "expert", "cap-resilience", "CAP resilience patterns", "Timeouts, retries, bulkheads", "External calls need resilience; pair retries with idempotency.");

// ——— RAP / ABAP Cloud ———
const rap = "rap-abap";
add(rap, "basic", "rap-what", "What is RAP", "ABAP RESTful Application Programming Model", "RAP builds cloud-ready ABAP transactional services with CDS and behavior definitions.");
add(rap, "basic", "rap-cds-bo", "RAP business objects", "CDS + behavior", "Business objects combine data model and behavior.");
add(rap, "basic", "rap-managed", "Managed RAP scenario", "Framework handles much persistence", "Managed scenarios reduce boilerplate for standard CRUD.");
add(rap, "basic", "rap-fiori-elements", "RAP with Fiori elements", "Metadata-driven UI", "Annotations drive consistent UIs.");
add(rap, "advanced", "rap-unmanaged", "Unmanaged RAP", "Custom control", "Unmanaged when you need full control of persistence logic.");
add(rap, "advanced", "rap-draft", "Draft handling", "Editable temporary state", "Draft enables long transactional edits before activation.");
add(rap, "advanced", "rap-determinations", "Determinations and validations", "Business rules hooks", "Determinations derive fields; validations enforce invariants.");
add(rap, "advanced", "rap-eml", "EML basics", "Entity Manipulation Language", "Programmatic access to RAP BOs.");
add(rap, "advanced", "rap-vs-cap", "RAP vs CAP decision criteria", "On-stack vs side-by-side", "Choose by data gravity, team skills, clean-core, UX needs — not slogans.");
add(rap, "expert", "rap-clean-core", "Clean-core extension strategy", "Upgrade-safe extensions", "Prefer released APIs, key-user extensibility, RAP extensions; avoid core mods.");
add(rap, "expert", "rap-performance", "RAP performance", "Buffers, EML patterns", "Avoid chatty EML in loops; design for set-based operations.");
add(rap, "expert", "rap-extensibility", "ABAP Cloud extensibility", "Restricted ABAP language", "ABAP Cloud restricts APIs to keep systems upgradeable.");

// ——— INTEGRATION SUITE / CPI ———
const integ = "integration";
add(integ, "basic", "is-what", "Integration Suite overview", "Suite of integration capabilities", "Process integration, API management, trading partner, advisor, and more under one suite.");
add(integ, "basic", "cpi-iflow", "Cloud Integration iflows", "Graph of processing steps", "Adapters, mappings, routers, exception subprocesses form integration flows.");
add(integ, "basic", "cpi-adapters", "Adapters basics", "Protocol endpoints", "HTTPS, SFTP, IDoc, etc. connect systems — config quality matters.");
add(integ, "basic", "cpi-mapping", "Mapping and transformation", "Payload shape changes", "Graphical/XSLT/scripts transform messages; schema mismatch is a top failure.");
add(integ, "advanced", "cpi-exception", "Exception subprocesses", "Controlled failure handling", "Catch, log, retry policy, dead-letter patterns.");
add(integ, "advanced", "cpi-idempotency", "Idempotency in CPI", "Safe retries", "Business keys prevent duplicate side effects under at-least-once delivery.");
add(integ, "advanced", "api-mgmt", "API Management concepts", "Expose, protect, productize APIs", "Policies for auth, quota, threat protection, versioning.");
add(integ, "advanced", "cloud-connector", "Cloud Connector concepts", "Hybrid connectivity", "Secure tunnel patterns for on-prem systems (conceptual).");
add(integ, "advanced", "principal-hybrid", "Principal propagation hybrid", "User identity to on-prem", "Complex trust setup; high value and high misconfig risk.");
add(integ, "expert", "is-governance", "Integration governance", "Ownership, versioning, transport", "API sprawl and shadow integrations are enterprise risk.");
add(integ, "expert", "is-tpm", "Trading Partner Management concepts", "B2B partner setup", "Partner profiles, agreements, monitoring for B2B.");
add(integ, "expert", "is-observability", "Integration observability", "MPls, traces, correlation", "Correlate partner message IDs end-to-end.");

// ——— EVENTS ———
const evt = "events";
add(evt, "basic", "evt-vs-cmd", "Events vs commands", "Facts vs requests", "Events state what happened; commands request work.");
add(evt, "basic", "evt-mesh-concepts", "Event Mesh style concepts", "Topics and subscriptions", "Pub/sub decouples producers and consumers.");
add(evt, "advanced", "evt-schema", "Event schema evolution", "Compatible change", "Version payloads carefully; consumers must not break.");
add(evt, "advanced", "evt-dlq", "Dead-letter queues", "Poison message isolation", "Repeated failures should not block the main stream.");
add(evt, "expert", "evt-saga", "Sagas and compensations", "Long-running consistency", "Coordinate steps with compensations instead of distributed locks.");

// ——— BPA ———
const bpa = "bpa";
add(bpa, "basic", "bpa-what", "Build Process Automation overview", "Workflow + automation + decisions", "Orchestrate human and system steps with governance.");
add(bpa, "basic", "bpa-workflow", "Workflow modeling basics", "Process graph", "Gates, tasks, events model business process.");
add(bpa, "basic", "bpa-forms", "Forms and approvals", "Human-in-the-loop", "Inbox tasks, escalations, roles.");
add(bpa, "advanced", "bpa-rules", "Business rules and decisions", "Separate decision logic", "Rules change faster than process graphs.");
add(bpa, "advanced", "bpa-api", "API integration in automations", "Call systems safely", "Auth, retries, error handling for automations.");
add(bpa, "advanced", "bpa-governance", "Citizen development guardrails", "Guard the factory", "Environments, transport, review boards, least privilege.");
add(bpa, "expert", "bpa-scale", "BPA at enterprise scale", "Versioning and ops", "Process versions, monitoring, SLAs for human tasks.");

// ——— WORKZONE ———
const wz = "workzone";
add(wz, "basic", "wz-what", "Build Work Zone concepts", "Digital workplace", "Sites, workspaces, cards, federated content.");
add(wz, "basic", "wz-roles", "Roles and content assignment", "Who sees what", "Role/group driven navigation and tiles.");
add(wz, "advanced", "wz-federation", "Content federation", "Bring apps together", "Integrate remote content with identity alignment.");
add(wz, "advanced", "wz-perf", "Work Zone performance", "Caching and mobile", "Layout and content weight affect UX.");

// ——— HANA CLOUD ———
const hana = "hana-cloud";
add(hana, "basic", "hana-what", "HANA Cloud architecture basics", "Managed cloud database", "Compute, storage, services for transactional and analytical workloads.");
add(hana, "basic", "hana-sql", "SQL fundamentals on HANA", "Query the data", "Select, joins, predicates; always think set-based.");
add(hana, "basic", "hana-hdi", "HDI containers", "Deploy DB design-time", "Isolated deployments with privileges.");
add(hana, "advanced", "hana-calc", "Calculation views concepts", "Modeled analytics", "Reusable analytical semantics.");
add(hana, "advanced", "hana-privileges", "Privileges and schema isolation", "Least privilege DB", "App users should not be DB admins.");
add(hana, "advanced", "hana-perf", "Expensive statements and plans", "Read the plan", "Indexes, partitions, and plan analysis.");
add(hana, "expert", "hana-ha", "Availability and recovery concepts", "RPO/RTO thinking", "Backup, replication concepts, workload classes.");
add(hana, "expert", "hana-vector", "Vector / multi-model awareness", "Where supported", "Multi-model features evolve — verify current capability.");

// ——— DATASPHERE ———
const ds = "datasphere";
add(ds, "basic", "ds-what", "Datasphere overview", "Business data fabric concepts", "Semantic modeling, spaces, and governed data access.");
add(ds, "basic", "ds-spaces", "Spaces and isolation", "Data workspaces", "Separate teams and data products.");
add(ds, "advanced", "ds-semantic", "Semantic models", "Business meaning", "Metrics and entities with owned definitions.");
add(ds, "advanced", "ds-federation", "Federation vs replication", "Move queries or move data", "Trade latency, cost, residency.");
add(ds, "expert", "ds-lineage", "Lineage and impact analysis", "Where did this number come from", "Trust requires lineage.");

// ——— BDC / DATABRICKS / SAC ———
const bdc = "bdc";
add(bdc, "basic", "bdc-what", "Business Data Cloud ecosystem", "Modern SAP data landscape", "Relationships among BDC, Datasphere, Databricks, SAC evolve — not a simple rename.");
add(bdc, "basic", "bdc-data-product", "Data products", "Owned reusable assets", "Contract, owner, quality, consumers.");
add(bdc, "advanced", "bdc-governance", "Data governance", "Catalog, quality, access", "Without governance, KPI wars begin.");
add(bdc, "expert", "bdc-lakehouse", "Lakehouse patterns with SAP Databricks concepts", "Open formats + governance", "Combine lake scale with business semantics carefully.");

const sac = "sac";
add(sac, "basic", "sac-what", "SAP Analytics Cloud overview", "BI, planning, predictive features", "Stories, models, planning processes.");
add(sac, "basic", "sac-stories", "Stories and dashboards", "Visual analytics", "Garbage models produce executive chaos.");
add(sac, "advanced", "sac-planning", "Planning basics", "Budget and forecast cycles", "Process + model + security.");
add(sac, "advanced", "sac-live-vs-import", "Live vs import connections", "Latency and control trade-offs", "Live hits source systems; import snapshots data.");
add(sac, "expert", "sac-security", "SAC security and row-level", "Who sees which numbers", "Misconfigured security leaks financials.");

// ——— AI / JOULE ———
const ai = "ai";
add(ai, "basic", "ai-responsible", "Responsible AI basics", "Human oversight required", "Models err; humans own decisions and privacy.");
add(ai, "basic", "ai-joule-concepts", "Joule concepts (product-aware)", "SAP AI assistant family concepts", "Joule-style assistants aid navigation and tasks; capabilities and availability change — verify official docs.");
add(ai, "basic", "ai-hallucination", "Hallucinations and grounding", "Plausible but wrong", "Require citations, tools, and verification for enterprise use.");
add(ai, "advanced", "ai-rag", "RAG concepts on enterprise data", "Retrieve then generate", "Ground answers in approved corpora with access control.");
add(ai, "advanced", "ai-prompt", "Prompt design for ops", "Clear tasks and constraints", "Specify role, format, allowed tools, and refusal cases.");
add(ai, "advanced", "ai-cost-latency", "AI cost and latency trade-offs", "Budgets and model routing", "Not every task needs the largest model.");
add(ai, "expert", "ai-agent-risks", "Agentic AI risks on BTP landscapes", "Tools + autonomy", "Tool calling needs authz, audit, and kill switches.");
add(ai, "expert", "ai-eval", "Evaluating AI in enterprise", "Offline and online evals", "Measure groundedness, safety, cost regressions.");

// ——— OPERATIONS ———
const ops = "operations";
add(ops, "basic", "ops-accounts", "Global accounts and subaccounts", "Landscape hierarchy", "Commercial root vs isolation slices.");
add(ops, "basic", "ops-entitlements", "Entitlements and quotas", "What you may use", "Quota exhaustion looks like outages.");
add(ops, "basic", "ops-cf", "Cloud Foundry basics", "Orgs, spaces, apps", "Runtime grouping under environments.");
add(ops, "advanced", "ops-observability", "Logs metrics traces", "Three pillars", "Correlate before guessing.");
add(ops, "advanced", "ops-finops", "FinOps on BTP", "Cost as a design constraint", "Owners, tags, budgets.");
add(ops, "expert", "ops-sre", "SRE practices", "SLOs and error budgets", "Alert on user pain, not noise.");

// Learning paths — full fluency tracks
const paths = [
  {
    id: "path-security-fluency",
    title: "Security fluency · basic → expert",
    domainId: "security",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts.filter((c) => c.domainId === "security").map((c) => c.id),
    nextHint: "Complete basic identity cards, then JWT/role labs, then tenant isolation arena cases.",
  },
  {
    id: "path-cap-odata",
    title: "CAP + OData fluency",
    domainId: "cap",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts.filter((c) => c.domainId === "cap" || c.id.startsWith("odata")).map((c) => c.id),
    nextHint: "Model entities → expose OData → secure → performance → multitenancy.",
  },
  {
    id: "path-rap",
    title: "RAP / ABAP Cloud fluency",
    domainId: "rap-abap",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts.filter((c) => c.domainId === "rap-abap").map((c) => c.id),
    nextHint: "Managed RAP → draft/validations → clean-core decisions vs CAP.",
  },
  {
    id: "path-integration",
    title: "Integration Suite + CPI fluency",
    domainId: "integration",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts.filter((c) => c.domainId === "integration" || c.domainId === "events").map((c) => c.id),
    nextHint: "Iflows → exceptions/idempotency → API Mgmt → hybrid/governance.",
  },
  {
    id: "path-bpa",
    title: "Process Automation fluency",
    domainId: "bpa",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts.filter((c) => c.domainId === "bpa").map((c) => c.id),
    nextHint: "Workflow → rules → governance → enterprise scale.",
  },
  {
    id: "path-data",
    title: "HANA + Datasphere + BDC + SAC fluency",
    domainId: "bdc",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts
      .filter((c) => ["hana-cloud", "datasphere", "bdc", "sac"].includes(c.domainId))
      .map((c) => c.id),
    nextHint: "HANA foundations → semantic ownership → analytics stories → lakehouse governance.",
  },
  {
    id: "path-ai-joule",
    title: "Joule / SAP AI fluency",
    domainId: "ai",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts.filter((c) => c.domainId === "ai").map((c) => c.id),
    nextHint: "Responsible AI → grounding/RAG → cost → agent risks/eval.",
  },
  {
    id: "path-platform-ops",
    title: "Platform ops fluency",
    domainId: "operations",
    levels: ["basic", "advanced", "expert"],
    conceptIds: concepts.filter((c) => c.domainId === "operations").map((c) => c.id),
    nextHint: "Accounts → entitlements → observability → FinOps/SRE.",
  },
];

// Quest board — explicit next steps for the HUD
const quests = [
  {
    id: "q-orient",
    title: "Tutorial: How Odyssey works",
    tier: "starter",
    order: 1,
    objective: "Complete the first 3 micro-steps of Northwind mega vertical",
    missionId: "r1-northwind-order-insights",
    conceptIds: ["ops-accounts", "sec-authn-authz"],
    rewardLabel: "Unlock Security path",
    nextQuestId: "q-sec-basic",
  },
  {
    id: "q-sec-basic",
    title: "Security foundations",
    tier: "basic",
    order: 2,
    objective: "Study 5 basic security concepts in Atlas, then pass a concept check in any mission",
    missionId: "r1-northwind-order-insights",
    conceptIds: ["sec-shared-resp", "sec-authn-authz", "sec-oauth-oidc", "sec-destinations", "sec-ias-ips"],
    rewardLabel: "Unlock JWT deep dive",
    nextQuestId: "q-cap-basic",
  },
  {
    id: "q-cap-basic",
    title: "CAP + OData foundations",
    tier: "basic",
    order: 3,
    objective: "Learn CAP CDS + OData V4 cards, apply in Northwind architecture step",
    missionId: "r1-northwind-order-insights",
    conceptIds: ["cap-what", "cap-cds-entities", "cap-services", "odata-v4-basics"],
    rewardLabel: "Unlock RAP path",
    nextQuestId: "q-rap-basic",
  },
  {
    id: "q-rap-basic",
    title: "RAP foundations",
    tier: "basic",
    order: 4,
    objective: "Complete CAP vs RAP mission teaching steps",
    missionId: "r2-cap-rap-extension-lab",
    conceptIds: ["rap-what", "rap-managed", "rap-vs-cap"],
    rewardLabel: "Unlock Integration path",
    nextQuestId: "q-int-basic",
  },
  {
    id: "q-int-basic",
    title: "CPI / Integration foundations",
    tier: "basic",
    order: 5,
    objective: "Run Integration Crisis mission through evidence gather",
    missionId: "r3-integration-crisis",
    conceptIds: ["is-what", "cpi-iflow", "cpi-idempotency"],
    rewardLabel: "Unlock Data galaxy",
    nextQuestId: "q-data-basic",
  },
  {
    id: "q-data-basic",
    title: "Data platform foundations",
    tier: "basic",
    order: 6,
    objective: "Complete Data Galaxy KPI mission teach phases",
    missionId: "r4-data-galaxy",
    conceptIds: ["hana-what", "ds-what", "bdc-data-product", "sac-what"],
    rewardLabel: "Unlock Security siege",
    nextQuestId: "q-sec-adv",
  },
  {
    id: "q-sec-adv",
    title: "Advanced security siege",
    tier: "advanced",
    order: 7,
    objective: "Clear Security Siege mission diagnosis + fix",
    missionId: "r5-security-siege",
    conceptIds: ["sec-tenant-isolation", "sec-threat-model", "sec-jwt-claims"],
    rewardLabel: "Unlock Architecture Arena cases",
    nextQuestId: "q-arena-1",
  },
  {
    id: "q-arena-1",
    title: "Arena: CAP vs RAP war room",
    tier: "advanced",
    order: 8,
    objective: "Pass Architecture Arena case arch-cap-rap-global-orders",
    missionId: null,
    arenaScenarioId: "arch-cap-rap-global-orders",
    conceptIds: ["rap-vs-cap", "rap-clean-core", "cap-auth"],
    rewardLabel: "Unlock multi-region arena",
    nextQuestId: "q-arena-2",
  },
  {
    id: "q-arena-2",
    title: "Arena: Residency vs latency",
    tier: "expert",
    order: 9,
    objective: "Pass arch-multi-region-data without choosing raw PII replica",
    arenaScenarioId: "arch-multi-region-data",
    conceptIds: ["sec-tenant-isolation", "bdc-governance", "ds-federation"],
    rewardLabel: "Unlock event consistency arena",
    nextQuestId: "q-arena-3",
  },
  {
    id: "q-arena-3",
    title: "Arena: Events vs dual-write",
    tier: "expert",
    order: 10,
    objective: "Pass arch-event-vs-sync with idempotency defense",
    arenaScenarioId: "arch-event-vs-sync",
    conceptIds: ["cpi-idempotency", "evt-saga", "evt-dlq"],
    rewardLabel: "Unlock SaaS isolation arena",
    nextQuestId: "q-arena-4",
  },
  {
    id: "q-arena-4",
    title: "Arena: Multi-tenant isolation",
    tier: "expert",
    order: 11,
    objective: "Pass arch-saas-isolation rejecting Admin.All",
    arenaScenarioId: "arch-saas-isolation",
    conceptIds: ["sec-tenant-isolation", "sec-zero-trust", "cap-multitenant"],
    rewardLabel: "Unlock Grand Enterprise",
    nextQuestId: "q-grand",
  },
  {
    id: "q-grand",
    title: "Grand Enterprise capstone",
    tier: "expert",
    order: 12,
    objective: "Complete Grand Enterprise mission end-to-end",
    missionId: "r-grand-enterprise",
    conceptIds: ["ops-sre", "sec-incident-ir", "is-governance"],
    rewardLabel: "Principal track complete (sim evidence)",
    nextQuestId: "q-ai",
  },
  {
    id: "q-ai",
    title: "Joule / AI responsible fluency",
    tier: "advanced",
    order: 13,
    objective: "Study all AI/Joule concept cards basic→expert in Atlas",
    conceptIds: concepts.filter((c) => c.domainId === "ai").map((c) => c.id),
    rewardLabel: "AI path badge (sim)",
    nextQuestId: "q-bpa",
  },
  {
    id: "q-bpa",
    title: "Process Automation fluency",
    tier: "advanced",
    order: 14,
    objective: "Study all BPA concepts and draft a governed approval design in Arena notes",
    conceptIds: concepts.filter((c) => c.domainId === "bpa").map((c) => c.id),
    rewardLabel: "Automation path badge (sim)",
    nextQuestId: null,
  },
];

for (const c of concepts) {
  w(`concepts/${c.id}.json`, c);
}

w("concepts/index.json", {
  version: "3.0.0",
  count: concepts.length,
  ids: concepts.map((c) => c.id),
  domainsCovered: [...new Set(concepts.map((c) => c.domainId))],
});

w("learning-paths/index.json", {
  version: "3.0.0",
  paths,
});

w("quests/index.json", {
  version: "3.0.0",
  ethics:
    "Quest progress is optional mastery scaffolding. No shame streaks, loot boxes, pay-to-win, artificial scarcity, or sleep-disrupting notifications.",
  quests,
});

// Domain skill trees for UI
const trees = {};
for (const c of concepts) {
  if (!trees[c.domainId]) trees[c.domainId] = { basic: [], advanced: [], expert: [] };
  trees[c.domainId][c.level].push({ id: c.id, title: c.title });
}
w("skill-trees/index.json", {
  version: "3.0.0",
  trees,
  labels: {
    security: "Trust Fortress",
    cap: "CAP Foundry",
    "rap-abap": "Clean Core Citadel",
    integration: "Integration Transit",
    events: "Event Constellation",
    bpa: "Automation Works",
    workzone: "Workplace Plaza",
    "hana-cloud": "Data Core",
    datasphere: "Semantic Fabric",
    bdc: "Data Galaxy",
    sac: "Decision Observatory",
    ai: "Cognitive Lab",
    operations: "Mission Control",
  },
});

console.log(
  JSON.stringify(
    {
      concepts: concepts.length,
      byLevel: {
        basic: concepts.filter((c) => c.level === "basic").length,
        advanced: concepts.filter((c) => c.level === "advanced").length,
        expert: concepts.filter((c) => c.level === "expert").length,
      },
      paths: paths.length,
      quests: quests.length,
      domains: [...new Set(concepts.map((c) => c.domainId))].sort(),
    },
    null,
    2,
  ),
);
