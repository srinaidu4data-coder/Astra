/**
 * MEGA teaching pack: atomic concepts + ultra-granular missions that teach while you act.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const content = join(root, "content");

function w(rel, obj) {
  const p = join(content, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

const src = (title, url = "https://help.sap.com/docs/btp") => [
  { title, url, confidence: "medium" },
];

/** @type {import('../packages/shared/src/teaching.ts').ConceptCard[]} */
const CONCEPTS = [];

function concept(c) {
  CONCEPTS.push({
    level: "basic",
    formalPoints: [],
    commonMistakes: [],
    howToRecognize: [],
    howToApply: [],
    relatedIds: [],
    glossary: [],
    sources: src("SAP BTP documentation hub"),
    tags: [],
    ...c,
  });
}

// ——— Foundation / Landscape ———
concept({
  id: "c-global-account",
  title: "Global Account",
  domainId: "operations",
  summary: "The commercial and administrative root of your SAP BTP estate.",
  explain:
    "A global account is the top-level container tied to your commercial relationship with SAP. Under it you create directories (optional) and subaccounts. Entitlements (what you may use) are assigned downward from the global account. You do not deploy apps directly into a global account — you deploy into environments inside subaccounts.",
  analogy:
    "Think of a global account as the company lease for an office campus. Floors and rooms (subaccounts/spaces) are where teams actually put desks (apps).",
  whyItMatters:
    "Misplacing resources at the wrong level causes entitlement chaos, unclear ownership, and security sprawl.",
  formalPoints: [
    "Commercial root of the BTP landscape",
    "Holds directories and subaccounts",
    "Entitlements flow down from here",
  ],
  commonMistakes: [
    "Treating global account as a runtime environment",
    "Assuming all regions/services are automatically available everywhere",
  ],
  howToRecognize: ["Billing/commercial boundary", "Root node in cockpit hierarchy"],
  howToApply: ["Map who owns the global account", "Plan subaccount strategy before first deploy"],
  glossary: [
    { term: "Entitlement", definition: "Right to use a service/plan up to a quota." },
    { term: "Subaccount", definition: "Isolated slice for projects/stages/regions under a global account." },
  ],
  tags: ["landscape", "foundation"],
});

concept({
  id: "c-subaccount",
  title: "Subaccount",
  domainId: "operations",
  summary: "Isolated project/stage/region boundary for services and environments.",
  explain:
    "Subaccounts isolate users, entitlements, subscriptions, and environments (Cloud Foundry, Kyma, ABAP, etc.). Teams often create subaccounts per landscape stage (dev/test/prod) and/or region. Destinations, role collections, and many service instances live at subaccount scope.",
  analogy: "A locked floor of the campus — different badge access, different fire rules, different budgets.",
  whyItMatters: "Wrong subaccount boundaries create cross-environment accidents and weak blast-radius control.",
  formalPoints: [
    "Belongs to a global account (optionally under a directory)",
    "Region-scoped availability of services",
    "Hosts environments and many security configs",
  ],
  commonMistakes: [
    "One giant subaccount for all stages",
    "Confusing subaccount with CF space",
  ],
  relatedIds: ["c-global-account", "c-cf-space"],
  tags: ["landscape"],
});

concept({
  id: "c-cf-space",
  title: "Cloud Foundry Org & Space",
  domainId: "operations",
  summary: "Runtime grouping for apps and service instances inside CF environment.",
  explain:
    "When a Cloud Foundry environment is enabled on a subaccount, you get orgs and spaces. Spaces hold apps, routes, and service instances. Spaces are not the same as subaccounts — subaccounts are BTP isolation; spaces are CF runtime isolation.",
  analogy: "Subaccount = building floor; CF space = a specific lab room on that floor.",
  whyItMatters: "Deploying to the wrong space breaks routes, bindings, and least-privilege ops.",
  formalPoints: ["CF environment under subaccount", "Apps bind to service instances in spaces"],
  commonMistakes: ["Saying 'space' when you mean subaccount"],
  relatedIds: ["c-subaccount"],
  tags: ["cf", "runtime"],
});

concept({
  id: "c-destination",
  title: "Destination",
  domainId: "integration",
  summary: "Named connection config: URL + authentication + additional properties.",
  explain:
    "Destinations store how one component reaches another: base URL, proxy type, authentication method (NoAuth, Basic, OAuth2 variants, PrincipalPropagation, etc.), and extra properties. UI5 apps and Integration Suite often call backends through destinations so secrets and URLs are not hard-coded.",
  analogy: "A saved VPN profile: where to go + how to prove who you are — not the application itself.",
  whyItMatters:
    "Most 'app is down' UI failures are destination/auth misconfig, not missing buttons in the UI.",
  formalPoints: [
    "Subaccount-level named connection",
    "Separates connectivity from app code",
    "Auth method must match target expectations",
  ],
  commonMistakes: [
    "Assuming destination only stores a URL",
    "Assuming token endpoint 200 means backend will accept the token",
  ],
  glossary: [
    {
      term: "OAuth2UserTokenExchange",
      definition: "User token exchanged for a token acceptable to the target resource (simplified teaching model).",
    },
  ],
  tags: ["connectivity", "security"],
});

concept({
  id: "c-xsuaa-roles",
  title: "XSUAA-style Roles, Scopes & Role Collections",
  domainId: "security",
  summary: "Authorization building blocks: scopes grant abilities; role collections assign them to users.",
  explain:
    "In the classic BTP application security model (often associated with XSUAA), applications declare scopes (permissions like Order.Read). Role templates group scopes. Administrators create role collections and assign them to users/groups. A valid login (authentication) can still fail authorization (403) if scopes are missing. Token claims carry audience and scopes the resource checks.",
  analogy:
    "Badge gets you in the building (authn). Room keys on the badge (scopes) decide which doors open (authz).",
  whyItMatters: "401 vs 403 diagnosis depends on understanding authn vs authz and token claims.",
  formalPoints: [
    "Authentication ≠ authorization",
    "Scopes are fine-grained permissions",
    "Role collections assign bundles of roles/scopes to people",
  ],
  commonMistakes: [
    "Treating every 401 as wrong password",
    "Granting Admin to 'make it work'",
  ],
  glossary: [
    { term: "Scope", definition: "A named permission a token may include." },
    { term: "Audience (aud)", definition: "Intended recipient of the token; resource rejects wrong audience." },
    { term: "Role collection", definition: "Admin-facing bundle assigned to users/groups." },
  ],
  tags: ["security", "identity"],
});

concept({
  id: "c-jwt-audience",
  title: "JWT Audience (aud) Mismatch",
  domainId: "security",
  level: "advanced",
  summary: "Resource rejects a cryptographically valid token meant for someone else.",
  explain:
    "OAuth access tokens often include an audience claim listing which API/resource should accept them. If a destination or client is configured so the token is minted for audience A, but CAP/API validates audience B, the call fails (often 401) even though login succeeded and the token endpoint returned HTTP 200. Fix alignment of client/audience configuration — do not disable JWT validation.",
  analogy:
    "A valid concert ticket printed for Stadium A will be refused at Stadium B's gate — the ticket isn't fake; it's for the wrong venue.",
  whyItMatters: "This is one of the most common multi-hop auth failures in UI → destination → API chains.",
  formalPoints: [
    "Token can be valid yet unacceptable",
    "Audience must match resource identity",
    "Token endpoint success ≠ resource acceptance",
  ],
  commonMistakes: [
    "Blaming HANA/UI binding first",
    "Disabling auth to unblock demos",
  ],
  howToRecognize: [
    "UI 401 after login works",
    "Logs mention audience / aud / JWT validation",
    "Destination auth looks 'green' but API rejects",
  ],
  howToApply: [
    "Compare destination audience/client to API accepted audiences",
    "Trace one request UI → destination → API",
    "Add CI check for audience alignment",
  ],
  relatedIds: ["c-destination", "c-xsuaa-roles"],
  tags: ["security", "debugging"],
});

concept({
  id: "c-cap-odata",
  title: "CAP Service & OData Projection",
  domainId: "cap",
  summary: "CDS models domain entities; services expose projections as OData APIs.",
  explain:
    "SAP Cloud Application Programming Model uses CDS to define entities, associations, and services. A service projection chooses what external consumers see. CAP can serve OData V4, handle persistence (e.g., HANA), and integrate auth. UI5 Fiori apps commonly consume CAP OData services.",
  analogy: "CDS is the warehouse inventory model; the service is the storefront window showing selected shelves.",
  whyItMatters: "Clean projections prevent leaking internal fields and clarify API contracts.",
  formalPoints: [
    "Domain model vs service projection",
    "OData as the common UI contract",
    "Bindings connect runtime to DB and auth services",
  ],
  commonMistakes: [
    "Exposing whole domain model without projection discipline",
    "Assuming CAP removes the need for authorization design",
  ],
  relatedIds: ["c-ui5-odata", "c-hana-hdi"],
  tags: ["cap", "api"],
});

concept({
  id: "c-ui5-odata",
  title: "UI5 OData Binding via Destination",
  domainId: "ui5-fiori",
  summary: "UI5 models bind controls to OData paths; connectivity often goes through a destination.",
  explain:
    "SAPUI5 applications use models (JSON, OData V2/V4, etc.). An OData model is configured with a service URL — frequently a relative path resolved through a destination on BTP. Binding paths connect controls to entity sets and properties. Failures may be binding paths, metadata mismatch, network, CSRF, or auth — evidence decides.",
  analogy: "The UI is a dashboard glass; OData is the wiring; destination is the fuse box.",
  whyItMatters: "UI blank screens are rarely 'React-style state bugs' — check network and auth first in enterprise Fiori.",
  formalPoints: [
    "Model + binding path + entity set",
    "Destination mediates runtime connectivity",
    "Distinguish UI bug vs backend vs auth",
  ],
  commonMistakes: ["Always blaming the XML view first", "Ignoring browser network 401/403"],
  relatedIds: ["c-destination", "c-cap-odata"],
  tags: ["ui5"],
});

concept({
  id: "c-hana-hdi",
  title: "HANA HDI Containers (concept)",
  domainId: "hana-cloud",
  summary: "Isolated DB development deployments with controlled privileges.",
  explain:
    "HDI (HANA Deployment Infrastructure) containers package design-time DB artifacts and deploy them into isolated runtime schemas with managed privileges. CAP projects often bind to HANA HDI for persistence. Teaching simulation shows health and bindings — not a full SQL engine.",
  analogy: "A sealed lab kit: schema objects arrive together with rules about who may touch them.",
  whyItMatters: "Privilege and container isolation errors look like app bugs if you only stare at UI.",
  formalPoints: ["Design-time vs runtime artifacts", "Schema isolation", "Least-privilege DB access"],
  commonMistakes: ["Granting broad DB admin to app users"],
  tags: ["hana", "data"],
});

concept({
  id: "c-cap-vs-rap",
  title: "CAP vs RAP Decision",
  domainId: "architecture",
  level: "advanced",
  summary: "Choose side-by-side CAP vs on-stack RAP using constraints, not slogans.",
  explain:
    "RAP (ABAP RESTful Application Programming Model) excels for clean-core transactional extensions close to ABAP business objects. CAP excels for cloud-native side-by-side services, multi-target polyglot landscapes, and event-friendly APIs. Real decisions weigh data residency of core objects, team skills, upgrade impact, latency, UX channel, and integration style.",
  analogy: "Renovate the kitchen in-place (RAP) vs build a catering annex (CAP) — both feed guests; plumbing differs.",
  whyItMatters: "Wrong default creates upgrade pain or unnecessary dual stacks.",
  formalPoints: [
    "On-stack vs side-by-side",
    "Clean-core alignment",
    "Team skill & ops ownership matter",
  ],
  commonMistakes: [
    "CAP always / RAP always dogma",
    "Ignoring identity propagation differences",
  ],
  tags: ["architecture"],
});

concept({
  id: "c-idempotency",
  title: "Idempotency in Integration",
  domainId: "integration",
  level: "advanced",
  summary: "Repeating the same request does not create duplicate business effects.",
  explain:
    "Networks retry. Partners resend. Without idempotency keys (e.g., orderId), retries create duplicate orders. Design receivers to detect duplicates, use natural business keys, and route poison messages to DLQ. Retries without idempotency amplify outages.",
  analogy: "Pressing 'pay' twice should not charge twice — the cashier checks the receipt number.",
  whyItMatters: "Duplicate business documents destroy trust faster than downtime.",
  formalPoints: ["At-least-once delivery needs idempotent consumers", "DLQ for poison messages"],
  commonMistakes: ["Infinite immediate retries", "No correlation IDs"],
  tags: ["integration", "events"],
});

concept({
  id: "c-events-mesh",
  title: "Events vs Commands",
  domainId: "events",
  summary: "Events state facts that happened; commands request work to be done.",
  explain:
    "An OrderCreated event announces a fact. A CreateOrder command asks a system to perform work. Event-driven designs decouple producers/consumers via brokers (e.g., Event Mesh-style topics). You still need schemas, versioning, authorization, and operational tooling.",
  analogy: "A fire alarm (event) vs an order to evacuate zone B (command).",
  whyItMatters: "Mixing commands into 'events' creates hidden coupling and unclear ownership.",
  formalPoints: ["Past-tense facts vs imperatives", "Pub/sub decoupling", "Schema evolution"],
  tags: ["events"],
});

concept({
  id: "c-observability",
  title: "Logs, Metrics, Traces",
  domainId: "incident",
  summary: "Three pillars of evidence for distributed failures.",
  explain:
    "Logs are discrete events with context. Metrics are numeric time series (rates, latency, counts). Traces show a request's path across services with spans. Effective incident response correlates all three instead of guessing from a single UI symptom.",
  analogy: "CCTV (logs) + speedometer (metrics) + GPS breadcrumb (trace) for one car trip.",
  whyItMatters: "Distributed systems hide causality; evidence beats intuition.",
  formalPoints: ["Symptom ≠ root cause", "Correlation IDs matter", "Distractors exist"],
  commonMistakes: ["Restart first, think later", "Ignoring healthy distractors that waste time"],
  tags: ["sre", "debug"],
});

concept({
  id: "c-functional-nfr",
  title: "Functional vs Non-Functional Requirements",
  domainId: "architecture",
  summary: "What the system does vs how well/safe/fast/operable it must be.",
  explain:
    "Functional requirements describe capabilities (view orders, approve discount). Non-functional requirements (NFRs) constrain quality: security, privacy, latency, availability, cost, accessibility, auditability. Stakeholders often propose solutions ('use Kafka') as if they were requirements — separate ends from means.",
  analogy: "Functional: 'cross the river'. NFR: 'in under 5 minutes, safely, under $10'.",
  whyItMatters: "Architecture fails when NFRs are discovered in production incidents.",
  formalPoints: ["Separate solution ideas from needs", "NFRs drive service choice"],
  tags: ["requirements"],
});

concept({
  id: "c-clean-core",
  title: "Clean Core Principles",
  domainId: "rap-abap",
  level: "advanced",
  summary: "Keep ERP core upgradeable; extend via released APIs and side-by-side patterns.",
  explain:
    "Clean core encourages avoiding modifications that block upgrades. Prefer released APIs, key-user extensibility, RAP on-stack where appropriate, and side-by-side BTP apps for differentiating logic. Document upgrade impact explicitly in design defenses.",
  analogy: "Don't weld custom parts onto the car engine block if a roof rack accessory will do.",
  whyItMatters: "Unclean cores turn every upgrade into a multi-month crisis.",
  tags: ["architecture", "rap"],
});

concept({
  id: "c-tenant-isolation",
  title: "Tenant Isolation",
  domainId: "security",
  level: "expert",
  summary: "Hard boundaries so one customer cannot read/write another's data.",
  explain:
    "Multi-tenant SaaS must enforce tenant context on every query and admin API. Shared schemas need discriminators plus mandatory filters; better designs add defense in depth. Overbroad support roles and missing guards create cross-tenant incidents — treat as Sev-1 security.",
  analogy: "Hotel master keys should not open every safe; staff tools need scoped access and audit.",
  whyItMatters: "Cross-tenant leakage ends companies.",
  formalPoints: ["Authn insufficient", "Tenant predicate mandatory", "Least privilege for support"],
  tags: ["security", "saas"],
});

concept({
  id: "c-data-product",
  title: "Data Product & Semantic Ownership",
  domainId: "bdc",
  level: "advanced",
  summary: "A governed, owned, reusable data asset with a clear contract.",
  explain:
    "A data product has an owner, contract (fields/SLAs), quality rules, and consumers. When Finance and Sales each invent 'Net Revenue', dashboards conflict. Semantic ownership and lineage beat spreadsheet extracts.",
  analogy: "A product SKU with a spec sheet — not a mystery box of columns.",
  whyItMatters: "Contradictory KPIs destroy executive trust.",
  tags: ["data", "governance"],
});

concept({
  id: "c-residency",
  title: "Data Residency",
  domainId: "security",
  level: "expert",
  summary: "Rules about where personal/regulated data may be stored and processed.",
  explain:
    "Residency is not language localization. Replicating EU PII to a US analytics store without approval can violate policy/law. Designs need data-flow diagrams, region-aware storage, and pipeline gates.",
  analogy: "You can't move vault contents to another country because the chart looks prettier there.",
  whyItMatters: "Audit findings can freeze expansion.",
  tags: ["privacy", "architecture"],
});

concept({
  id: "c-principal-propagation",
  title: "Principal Propagation (concept)",
  domainId: "security",
  level: "advanced",
  summary: "Forward the end-user identity across hops instead of a technical user everywhere.",
  explain:
    "Principal propagation passes the authenticated user identity to downstream systems so authorizations remain user-centric. Technical users are simpler but destroy accountability and over-privilege systems. Hybrid landscapes with Cloud Connector often involve propagation patterns (details simplified in this sim).",
  analogy: "Showing your own ID at each door vs sending a courier with a master skeleton key.",
  whyItMatters: "Audit trails and least privilege depend on who actually acted.",
  tags: ["security", "hybrid"],
});

concept({
  id: "c-scope-403",
  title: "HTTP 403 Missing Scope",
  domainId: "security",
  level: "advanced",
  summary: "Authenticated but not authorized for the action.",
  explain:
    "403 typically means the platform knows who you are but your token lacks required scopes/roles for the action. Fix role collections — do not confuse with 401 (not authenticated / token rejected).",
  analogy: "You're in the building but your badge lacks the server-room flag.",
  whyItMatters: "Wrong fix path wastes hours (password resets won't help).",
  relatedIds: ["c-xsuaa-roles", "c-jwt-audience"],
  tags: ["security", "debugging"],
});

// Expand many more domain micro-concepts programmatically
const MICRO = [
  ["c-entitlement", "operations", "Entitlements & Quotas", "Entitlements grant service plans; quotas cap usage. Exhausted quotas look like 'service broken'."],
  ["c-service-plan", "operations", "Service Plans", "Plans are commercial/technical tiers of a service (memory, HA, features)."],
  ["c-binding", "cap", "Service Binding", "Binding injects credentials/URL of a service instance into an application runtime."],
  ["c-mta", "cap", "Multi-Target Application (concept)", "Packaging model to deploy multiple modules (UI, service, DB) coherently (simplified)."],
  ["c-fiori-elements", "ui5-fiori", "Fiori Elements (concept)", "Metadata-driven UI generation for consistent CRUD patterns; still needs solid OData annotations."],
  ["c-draft", "rap-abap", "Draft Documents", "Temporary editable state before activation; improves UX for long transactional edits."],
  ["c-behavior-def", "rap-abap", "Behavior Definition", "Declares what operations a RAP BO supports (create, update, actions, validations)."],
  ["c-iflow", "integration", "Integration Flow", "Graph of processing steps: adapters, mappings, routers, exception subprocesses."],
  ["c-adapter", "integration", "Adapters", "Protocol endpoints (HTTPS, SFTP, IDoc, etc.) connecting flows to systems."],
  ["c-api-mgmt", "integration", "API Management concepts", "Expose, secure, throttle, and version APIs with policies and products."],
  ["c-dlq", "events", "Dead-Letter Queue", "Holding area for messages that repeatedly fail processing."],
  ["c-schema-evolution", "events", "Schema Evolution", "Compatible changes to event payloads; version topics/contracts carefully."],
  ["c-workflow", "bpa", "Workflow vs Rules", "Workflow orchestrates human/system steps; business rules decide outcomes."],
  ["c-workzone", "workzone", "Work Zone Sites", "Digital workplace assembling apps, cards, and federated content for roles."],
  ["c-calc-view", "hana-cloud", "Calculation Views (concept)", "Modeled analytical views in HANA for reusable semantics (simplified teaching)."],
  ["c-lineage", "datasphere", "Data Lineage", "Trace where a metric came from across pipelines and models."],
  ["c-sac-story", "sac", "Analytics Stories", "Interactive analytic narratives consuming governed models — garbage in, executive chaos out."],
  ["c-threat-model", "security", "Threat Modeling Basics", "Enumerate assets, trust boundaries, adversaries, and mitigations before coding."],
  ["c-finops", "operations", "FinOps Awareness", "Make cost a first-class design constraint with owners and budgets."],
  ["c-slo", "operations", "SLOs & Alerting", "Service level objectives drive alerts; alert on symptoms that matter, not noise."],
  ["c-change-mgmt", "operations", "Change Coordination", "Uncoordinated identity+integration changes cause compound outages."],
  ["c-rto-rpo", "operations", "RTO/RPO Concepts", "Recovery time and data loss objectives shape backup/HA design."],
  ["c-accessibility", "ui5-fiori", "Fiori Accessibility", "Keyboard, contrast, labels — accessibility is a requirement, not polish."],
  ["c-csrf", "ui5-fiori", "CSRF Protection (concept)", "Tokens protect state-changing requests; failures often appear as mysterious 403s."],
  ["c-odata-metadata", "cap", "OData Metadata", "Service describes entity sets/types; client/UI must match versions."],
  ["c-retry-backoff", "integration", "Retry with Backoff", "Exponential backoff reduces stampedes; pair with idempotency."],
  ["c-saga", "events", "Saga Pattern", "Long transactions via steps + compensations instead of a single distributed DB lock."],
  ["c-shared-responsibility", "security", "Shared Responsibility", "SAP secures platform layers; you secure apps, identities, data, configs."],
  ["c-least-privilege", "security", "Least Privilege", "Grant minimum rights for the job; expand only with review."],
  ["c-audit-log", "security", "Audit Logging", "Immutable-enough records of security-relevant actions for investigations."],
];

for (const [id, domainId, title, explain] of MICRO) {
  concept({
    id,
    title,
    domainId,
    summary: explain,
    explain: `${explain} In Odyssey simulations this is modeled at Tier 1–2 fidelity with explicit labels — verify production details in official SAP documentation.`,
    analogy: `Practical memory hook: associate "${title}" with a concrete failure mode you have seen or will simulate in a mission.`,
    whyItMatters: `If you cannot explain ${title} in one minute, you will mis-diagnose related incidents.`,
    formalPoints: [explain],
    commonMistakes: [`Memorizing the name of ${title} without a failure example`],
    howToApply: [`Use ${title} explicitly in an architecture defense sentence`],
    tags: ["micro"],
  });
}

// Write concepts
for (const c of CONCEPTS) {
  w(`concepts/${c.id}.json`, c);
}

// Glossary aggregate
w("glossary/index.json", {
  version: "1.0.0",
  terms: CONCEPTS.flatMap((c) =>
    (c.glossary || []).map((g) => ({
      ...g,
      conceptId: c.id,
      domainId: c.domainId,
    })),
  ).concat([
    { term: "401 Unauthorized", definition: "Authentication failed or token rejected (simplified teaching).", conceptId: "c-jwt-audience", domainId: "security" },
    { term: "403 Forbidden", definition: "Authenticated but not authorized.", conceptId: "c-scope-403", domainId: "security" },
    { term: "OData", definition: "OASIS REST protocol commonly used by SAP UIs and CAP services.", conceptId: "c-cap-odata", domainId: "cap" },
    { term: "CDS", definition: "Core Data Services — declarative data/service modeling language used by CAP/RAP ecosystems.", conceptId: "c-cap-odata", domainId: "cap" },
  ]),
});

// ——— Helpers for mega steps ———
let stepCounter = 0;
function sid(prefix) {
  stepCounter += 1;
  return `${prefix}-${String(stepCounter).padStart(3, "0")}`;
}

function teachStep({
  title,
  conceptIds,
  headline,
  explain,
  analogy,
  why,
  points = [],
  mistakes = [],
  worked,
  reveals = [],
  diagram,
  phase,
  prompt,
  check,
  kind = "concept_teach",
  hints = [],
  seconds = 90,
}) {
  return {
    id: sid("s"),
    title,
    kind,
    phase,
    estimatedSeconds: seconds,
    prompt:
      prompt ||
      "Read the teaching panel carefully. When you understand it, continue. You will be checked.",
    tools: ["teach", "glossary"],
    successCriteria: ["Learner engages with concept before proceeding"],
    hints,
    conceptIds,
    teach: {
      headline,
      explain,
      analogy,
      whyItMatters: why,
      formalPoints: points,
      commonMistakes: mistakes,
      workedExample: worked,
      revealLevels: reveals,
      miniDiagram: diagram,
    },
    check,
  };
}

function mc(question, options, explanation, passScore = 1) {
  return {
    type: "mc",
    question,
    options: options.map((o, i) => ({
      id: `o${i + 1}`,
      text: o.text,
      correct: !!o.correct,
      feedback: o.feedback,
    })),
    acceptKeywords: [],
    explanation,
    passScore,
  };
}

function short(question, keywords, explanation, passScore = 0.6) {
  return {
    type: "short",
    question,
    options: [],
    acceptKeywords: keywords,
    explanation,
    passScore,
  };
}

function fidelity() {
  return {
    tier: "tier2_behavioral",
    behaviorsRepresented: [
      "Landscape hierarchy",
      "Auth configuration fields",
      "Synthetic logs/metrics/traces",
      "Health and dependency graphs",
    ],
    behaviorsSimplified: ["No real JWT crypto", "No live SAP runtime", "Illustrative costs"],
    behaviorsOmitted: ["Real CF push", "Cloud Connector crypto"],
    differencesFromReal: ["Injected defects via config + telemetry"],
    lastVerificationDate: "2026-08-07",
    knownLimitations: ["Not official SAP certification material", "Verify live details in SAP docs"],
    sourceVersions: ["mega-teach-1.0.0"],
  };
}

function buildMissionShell(meta, steps) {
  return {
    id: meta.id,
    title: meta.title,
    summary: meta.summary,
    campaignId: meta.campaignId,
    domainIds: meta.domainIds,
    competencyIds: meta.competencyIds,
    targetLevel: meta.targetLevel,
    fidelity: fidelity(),
    estimatedMinutes: meta.estimatedMinutes,
    naturalStoppingPoints: meta.stops,
    steps,
    injectedDefects: [meta.defect],
    assessmentRubric: [
      { dimension: "conceptual", criteria: "Concept checks + requirements language", weight: 0.2 },
      { dimension: "architecture", criteria: "Design quality", weight: 0.2 },
      { dimension: "debugging", criteria: "Evidence-aligned diagnosis", weight: 0.25 },
      { dimension: "operations", criteria: "Secure remediation", weight: 0.2 },
      { dimension: "communication", criteria: "Reflection", weight: 0.15 },
    ],
    sources: [
      {
        productOrService: "SAP BTP",
        sourceUrl: "https://help.sap.com/docs/btp",
        sourceTitle: "SAP BTP documentation hub",
        retrievalDate: "2026-08-07",
        confidence: "medium",
        deprecationStatus: "current",
        contentOwner: "curriculum",
      },
    ],
    version: "2.0.0",
    reviewStatus: "in_review",
    meta: { incidentId: meta.incidentId, landscapeId: meta.landscapeId },
  };
}

function phaseTeachBlock(phase, items) {
  return items.map((it) => teachStep({ ...it, phase }));
}

// Shared granular arc factory customized per mission incident theme
function granularArc(cfg) {
  stepCounter = 0;
  const steps = [];

  // PHASE 0 — Orient
  steps.push(
    ...phaseTeachBlock("0 · Orient", [
      {
        title: "How Odyssey teaches",
        conceptIds: ["c-observability"],
        headline: "Learn → Check → Do → Evidence",
        explain:
          "Every micro-step teaches a concept, checks understanding, then asks you to apply it on a simulated landscape. Mastery is evidence, not XP. Simulation fidelity is Tier 2 — labeled, not live SAP.",
        analogy: "Flight simulator: procedures are real; the aircraft is synthetic.",
        why: "Skipping teaching panels creates cargo-cult clicking.",
        points: [
          "Read teach panel before answering checks",
          "Use progressive reveals when stuck",
          "Never disable security to 'pass'",
        ],
        mistakes: ["Rushing to fix without reading symptoms"],
        kind: "concept_teach",
        check: mc(
          "What is the correct learning order in Odyssey?",
          [
            {
              text: "Learn concept → check understanding → apply on simulation → capture evidence",
              correct: true,
              feedback: "Correct — teaching precedes acting.",
            },
            {
              text: "Click fix until green, ignore panels",
              correct: false,
              feedback: "That creates cargo-cult engineers.",
            },
            {
              text: "Only multiple choice forever",
              correct: false,
              feedback: "Checks help, but application and diagnosis are required.",
            },
          ],
          "Odyssey is deliberate practice with evidence, not a slot machine.",
        ),
      },
      {
        title: "Fidelity honesty",
        conceptIds: ["c-shared-responsibility"],
        headline: "What this simulator is (and is not)",
        explain:
          "Tier 2 behavioral simulation models major inputs/outputs/failures with simplifications. It does not mint real JWTs, run OpenUI5, or bill real BTP. Always verify production decisions against official SAP documentation.",
        why: "Confusing sim with prod creates dangerous overconfidence.",
        points: ["Fidelity banner is mandatory reading", "Not SAP certification"],
        kind: "concept_teach",
        check: mc(
          "A Tier 2 simulation means…",
          [
            {
              text: "Major behaviors modeled with documented simplifications",
              correct: true,
              feedback: "Yes.",
            },
            {
              text: "Bitwise identical to production SAP",
              correct: false,
              feedback: "That would be misleading; we never claim that.",
            },
            {
              text: "Official SAP exam questions",
              correct: false,
              feedback: "This product is independent and not certification.",
            },
          ],
          "Honesty about fidelity is part of professional ethics.",
        ),
      },
    ]),
  );

  // PHASE 1 — Business & requirements (granular)
  steps.push(
    ...phaseTeachBlock("1 · Business & requirements", [
      {
        title: "Business situation intake",
        conceptIds: ["c-functional-nfr"],
        headline: "Start from business pain, not technology fashion",
        explain: cfg.situationTeach,
        analogy: cfg.situationAnalogy,
        why: "Solutioneering early locks teams into the wrong platform choices.",
        points: cfg.situationPoints,
        kind: "business_situation",
        prompt: cfg.situationPrompt,
        check: short(
          "In one or two sentences, restate the business goal and one hard constraint.",
          cfg.situationKeywords,
          "Restating prevents solving the wrong problem.",
        ),
        seconds: 120,
      },
      {
        title: "Functional vs NFR",
        conceptIds: ["c-functional-nfr"],
        headline: "Separate WHAT from HOW WELL",
        explain:
          "Functional requirements are capabilities. Non-functional requirements constrain quality: security, privacy, latency, cost, accessibility, audit. Stakeholders often hand you solutions disguised as requirements.",
        analogy: "Need: cross the river. Solution idea: buy a hovercraft. Keep them separate.",
        why: "NFRs drive architecture more than feature lists.",
        points: ["Flag solution-shaped 'requirements'", "Write NFRs testably when possible"],
        mistakes: ["Accepting 'use CAP' as a requirement without the underlying need"],
        kind: "concept_check",
        check: mc(
          "Which is primarily an NFR?",
          [
            {
              text: "Approvers must authorize discounts over 10%",
              correct: false,
              feedback: "That is functional behavior.",
            },
            {
              text: "P95 API latency under 400ms for EU users",
              correct: true,
              feedback: "Latency is a classic NFR.",
            },
            {
              text: "Show order list page",
              correct: false,
              feedback: "Functional capability.",
            },
          ],
          "NFRs constrain the design space.",
        ),
      },
      {
        title: "Stakeholder statements → needs",
        conceptIds: ["c-functional-nfr"],
        headline: "Interview for constraints and evidence",
        explain: cfg.stakeholderTeach,
        why: "Unspoken constraints kill projects late.",
        kind: "stakeholder_interview",
        prompt: cfg.stakeholderPrompt,
        check: short(
          "Name one functional need and one NFR you heard (or inferred) and one item still missing evidence.",
          ["functional", "nfr", "missing"].concat(cfg.stakeholderKeywords || []),
          "Professionals track unknowns explicitly.",
          0.5,
        ),
        seconds: 150,
      },
      {
        title: "Write requirements cleanly",
        conceptIds: ["c-functional-nfr"],
        headline: "Requirements artifact",
        explain:
          "Produce four lists: Functional, Non-functional, Constraints, Assumptions/Open questions. This artifact feeds architecture and test design.",
        kind: "requirements",
        prompt:
          "Write F / NFR / Constraints / Assumptions for this mission. Use the words functional and non-functional explicitly.",
        check: short(
          "Paste a compact requirements list using the headers Functional and Non-functional.",
          ["functional", "non-functional"],
          "Explicit headers prove you separated concerns.",
          0.5,
        ),
        seconds: 180,
      },
    ]),
  );

  // PHASE 2 — Landscape literacy
  steps.push(
    ...phaseTeachBlock("2 · Landscape literacy", [
      {
        title: "Global account → subaccount",
        conceptIds: ["c-global-account", "c-subaccount"],
        headline: "Hierarchy before heroics",
        explain:
          "Global account is commercial root. Subaccounts isolate projects/stages/regions. You deploy into environments under subaccounts, not into the global account itself.",
        diagram: "Global Account → Directory? → Subaccount → Environment (CF/Kyma/ABAP) → Apps/Services",
        kind: "concept_teach",
        check: mc(
          "Where do you typically deploy a CAP app?",
          [
            {
              text: "Into an environment under a subaccount",
              correct: true,
              feedback: "Correct.",
            },
            {
              text: "Directly into the global account root with no subaccount",
              correct: false,
              feedback: "Global account is not the app runtime container.",
            },
            {
              text: "Only inside SAP GUI",
              correct: false,
              feedback: "Not for CAP side-by-side cloud apps.",
            },
          ],
          "Hierarchy literacy prevents entitlement and isolation mistakes.",
        ),
      },
      {
        title: "CF space ≠ subaccount",
        conceptIds: ["c-cf-space"],
        headline: "Two different isolation axes",
        explain:
          "Subaccounts are BTP boundaries. CF spaces are runtime groupings inside a CF environment. Using the words interchangeably confuses ops and security reviews.",
        kind: "compare_terms",
        check: mc(
          "A Cloud Foundry space is…",
          [
            {
              text: "A runtime grouping for apps/service instances inside CF",
              correct: true,
              feedback: "Yes.",
            },
            {
              text: "The commercial root account",
              correct: false,
              feedback: "That is global account.",
            },
            {
              text: "Always identical to a subaccount",
              correct: false,
              feedback: "Different layers.",
            },
          ],
          "Precise vocabulary is an operational safety tool.",
        ),
      },
      {
        title: "Inspect the simulated landscape",
        conceptIds: ["c-observability"],
        headline: "Inventory before inference",
        explain:
          "Open the fleet/graph. Note health, owners, dependencies, costs, security posture. Mark degraded nodes. Do not invent root cause yet.",
        kind: "landscape_inspect",
        prompt:
          "List degraded resources and one dependency edge that looks suspicious. Mentions health states.",
        check: short(
          "Name at least one degraded component you see.",
          cfg.degradedKeywords,
          "Observation precedes explanation.",
          0.34,
        ),
        seconds: 120,
      },
      {
        title: "Map components to concerns",
        conceptIds: cfg.coreConceptIds,
        headline: "Who owns which risk?",
        explain: cfg.mapTeach,
        kind: "map_components",
        prompt: cfg.mapPrompt,
        check: short(
          "Map UI / API / identity / data / integration (as applicable) to component names from the landscape.",
          cfg.mapKeywords,
          "Mapping builds a mental model for incident response.",
          0.4,
        ),
        seconds: 150,
      },
    ]),
  );

  // PHASE 3 — Architecture teaching specific
  steps.push(
    ...phaseTeachBlock("3 · Architecture", [
      {
        title: "Core pattern teaching",
        conceptIds: cfg.archConceptIds,
        headline: cfg.archHeadline,
        explain: cfg.archExplain,
        analogy: cfg.archAnalogy,
        why: cfg.archWhy,
        points: cfg.archPoints,
        mistakes: cfg.archMistakes,
        worked: cfg.archWorked,
        reveals: cfg.archReveals,
        kind: "guided_example",
        check: mc(cfg.archMc.q, cfg.archMc.options, cfg.archMc.explanation),
        seconds: 150,
      },
      {
        title: "Draft architecture hypothesis",
        conceptIds: cfg.archConceptIds,
        headline: "Multiple options, explicit rejects",
        explain:
          "Write a hypothesis including major components, trust boundaries, and at least one rejected alternative with rationale. Architecture without rejected alternatives is marketing.",
        kind: "architecture_hypothesis",
        prompt: cfg.archPrompt,
        check: short(
          "Describe your design and one rejected alternative.",
          cfg.archKeywords,
          "Rejected alternatives prove thinking.",
          0.35,
        ),
        seconds: 200,
      },
      {
        title: "Trade-off matrix",
        conceptIds: ["c-finops", "c-least-privilege"],
        headline: "Score options on security, cost, resilience, complexity, ownership",
        explain:
          "Cheap designs that skip observability shift cost into incidents. Over-secure designs that block business need iteration. Make trade-offs explicit.",
        kind: "option_compare",
        prompt:
          "Compare at least two options across security, cost, resilience, complexity, operational ownership. Pick one.",
        check: short(
          "Write two options and which you pick with one security and one cost note.",
          ["security", "cost"],
          "Trade-off language is architect literacy.",
          0.5,
        ),
        seconds: 160,
      },
      {
        title: "Identity design checkpoint",
        conceptIds: ["c-xsuaa-roles", "c-destination"],
        headline: "Authn/authz is part of the architecture diagram",
        explain:
          "List actors, role collections/scopes, and how the UI reaches the API (destination auth). Missing identity design becomes 401/403 production theater.",
        kind: "security_review",
        prompt: "List actors and required permissions/scopes at a high level for this scenario.",
        check: short(
          "Name at least one actor and one permission/scope idea.",
          ["scope", "role", "read", "approve", "analyst", "user", "admin"].concat(
            cfg.identityKeywords || [],
          ),
          "Identity belongs in v1 design, not as a patch.",
          0.25,
        ),
      },
    ]),
  );

  // PHASE 4 — Configure / happy path
  steps.push(
    ...phaseTeachBlock("4 · Build & verify", [
      {
        title: "Bindings & destinations (concept)",
        conceptIds: ["c-binding", "c-destination"],
        headline: "Configuration is code's twin",
        explain:
          "Service bindings inject credentials into runtimes. Destinations externalize connectivity. Most 'code bugs' in first deploys are binding/destination mistakes.",
        kind: "concept_teach",
        check: mc(
          "A destination primarily stores…",
          [
            {
              text: "Connection URL + authentication configuration for callers",
              correct: true,
              feedback: "Correct.",
            },
            {
              text: "Only CSS themes for Fiori",
              correct: false,
              feedback: "No.",
            },
            {
              text: "HANA column store compression settings only",
              correct: false,
              feedback: "Wrong layer.",
            },
          ],
          "Connectivity config is a first-class artifact.",
        ),
      },
      {
        title: "Configure the solution (sim)",
        conceptIds: cfg.coreConceptIds,
        headline: "Apply configuration deliberately",
        explain: cfg.configureTeach,
        kind: "configure",
        prompt: cfg.configurePrompt,
        check: short(
          "List the key bindings/config checks you would verify.",
          cfg.configureKeywords,
          "Checklists beat memory.",
          0.3,
        ),
        seconds: 140,
      },
      {
        title: "Happy-path test design",
        conceptIds: ["c-observability"],
        headline: "Define expected behavior before chaos",
        explain:
          "Write the user journey that must work: actor, auth, data seen, side effects. Without expected behavior, you cannot recognize failure modes.",
        kind: "test_expected",
        prompt: "Describe the happy-path test in 3–5 steps.",
        check: short(
          "Outline happy path including login/access and successful data/action.",
          ["login", "order", "approve", "view", "success", "analyst", "user"],
          "Tests encode expected behavior.",
          0.2,
        ),
      },
    ]),
  );

  // PHASE 5 — Failure science (very granular)
  steps.push(
    ...phaseTeachBlock("5 · Failure science", [
      {
        title: "Symptoms vs root cause",
        conceptIds: ["c-observability"],
        headline: "Symptoms are not causes",
        explain:
          "A blank UI is a symptom. 401 is a symptom class. Audience mismatch may be a root cause. Incident skill is moving down the causal chain with evidence.",
        kind: "concept_teach",
        check: mc(
          "Best next step after users report 'app broken'?",
          [
            {
              text: "Gather symptoms + telemetry before naming root cause",
              correct: true,
              feedback: "Yes — evidence first.",
            },
            {
              text: "Immediately rewrite the UI in another framework",
              correct: false,
              feedback: "Catastrophic overreaction.",
            },
            {
              text: "Disable authentication globally",
              correct: false,
              feedback: "Unsafe and unprofessional.",
            },
          ],
          "Triage discipline prevents self-inflicted outages.",
        ),
      },
      {
        title: "Failure appears",
        conceptIds: cfg.incidentConceptIds,
        headline: cfg.failureHeadline,
        explain: cfg.failureTeach,
        kind: "test_failure",
        prompt: cfg.failurePrompt,
        check: short(
          "List the user-visible symptom and one technical symptom.",
          cfg.failureKeywords,
          "Capture both business and technical views.",
          0.3,
        ),
      },
      {
        title: "401 vs 403 clinic",
        conceptIds: ["c-jwt-audience", "c-scope-403"],
        headline: "Authn failure vs authz failure",
        explain:
          "401: not authenticated or token rejected (including audience mismatch). 403: authenticated but missing permission/scope. Mixing them sends you to the wrong runbook.",
        kind: "concept_check",
        check: mc(
          "Missing Discount.Approve scope typically surfaces as…",
          [
            { text: "403 Forbidden", correct: true, feedback: "Authorization failure." },
            { text: "DNS NXDOMAIN", correct: false, feedback: "Networking, not authz." },
            { text: "CSS 404", correct: false, feedback: "Unrelated." },
          ],
          "Status codes are diagnostic gold.",
        ),
      },
      {
        title: "Gather evidence — logs",
        conceptIds: ["c-observability"],
        headline: "Read error logs before theorizing",
        explain:
          "Filter errors/warnings. Note resource IDs and messages. Separate primary evidence from distractors (healthy components).",
        kind: "evidence_gather",
        prompt: "Quote or paraphrase the most important error log line you see.",
        tools: ["logs"],
        check: short(
          "What does the strongest error log suggest?",
          cfg.evidenceKeywords,
          "Logs anchor hypotheses.",
          0.25,
        ),
        seconds: 120,
      },
      {
        title: "Gather evidence — metrics & traces",
        conceptIds: ["c-observability"],
        headline: "Correlate pillars",
        explain:
          "Metrics show magnitude (failure rates). Traces show path. A good hypothesis explains all three pillars without ignoring contradicting evidence.",
        kind: "observe",
        prompt: "Note one metric and one trace span that support your emerging theory.",
        tools: ["metrics", "traces"],
        check: short(
          "Mention a metric or trace observation.",
          ["metric", "trace", "span", "rate", "401", "403", "latency", "count", "failure"],
          "Multi-signal reasoning.",
          0.2,
        ),
      },
      {
        title: "Form hypothesis",
        conceptIds: cfg.incidentConceptIds,
        headline: "Falsifiable statement",
        explain:
          "Write a hypothesis that could be wrong. Include the component and mechanism. Avoid vague 'network issue'.",
        kind: "hypothesis_form",
        prompt: "Write: If <mechanism> in <component>, then we should see <evidence>.",
        check: short(
          "State hypothesis with component + mechanism.",
          cfg.hypothesisKeywords,
          "Falsifiable hypotheses can be tested.",
          0.3,
        ),
        seconds: 140,
      },
      {
        title: "Eliminate distractors",
        conceptIds: ["c-observability"],
        headline: "Healthy nodes can still waste your time",
        explain: cfg.distractorTeach,
        kind: "concept_check",
        check: mc(
          "A recently successful integration flow means…",
          [
            {
              text: "It may be a distractor if the failing path is UI→destination→API",
              correct: true,
              feedback: "Correct — scope the failing chain.",
            },
            {
              text: "It always proves the UI auth is fine",
              correct: false,
              feedback: "Different path.",
            },
            {
              text: "You should delete HANA next",
              correct: false,
              feedback: "Destructive and baseless.",
            },
          ],
          "Scope the failing dependency chain.",
        ),
      },
      {
        title: "Root-cause diagnosis",
        conceptIds: cfg.incidentConceptIds,
        headline: "Commit to a cause with evidence",
        explain: cfg.diagnoseTeach,
        kind: "diagnose",
        prompt: cfg.diagnosePrompt,
        hints: cfg.diagnoseHints,
        tools: ["diagnosis", "logs", "traces"],
        check: short(
          "State root cause using precise terms from this mission.",
          cfg.diagnoseKeywords,
          "Precision enables correct remediation.",
          0.35,
        ),
        seconds: 180,
      },
    ]),
  );

  // PHASE 6 — Mitigate / fix / verify
  steps.push(
    ...phaseTeachBlock("6 · Mitigate & remediate", [
      {
        title: "Mitigate business impact",
        conceptIds: ["c-change-mgmt"],
        headline: "Stop the bleeding before perfect surgery",
        explain:
          "Communicate status, freeze related risky changes, offer workarounds if any, protect data. Mitigation ≠ root-cause fix, but it buys safety.",
        kind: "mitigate",
        prompt: "Write a 3-line status update to business stakeholders + one mitigation action.",
        check: short(
          "Include communication or workaround language.",
          ["communicat", "workaround", "freeze", "status", "impact", "customer", "user"],
          "Communication is part of ops excellence.",
          0.25,
        ),
      },
      {
        title: "Least privilege remediation rule",
        conceptIds: ["c-least-privilege"],
        headline: "Never 'fix' security by removing it",
        explain:
          "Disabling JWT validation, granting Admin.All, or opening anonymous access are not remediations — they are new incidents. Fix the misaligned config with minimum rights.",
        kind: "security_review",
        check: mc(
          "Acceptable remediation for audience mismatch?",
          [
            {
              text: "Align destination audience with API accepted audience",
              correct: true,
              feedback: "Correct.",
            },
            {
              text: "Disable authentication on the API",
              correct: false,
              feedback: "Creates a worse incident.",
            },
            {
              text: "Email passwords in Slack",
              correct: false,
              feedback: "Never.",
            },
          ],
          "Secure remediation only.",
        ),
      },
      {
        title: "Apply secure fix in simulation",
        conceptIds: cfg.incidentConceptIds,
        headline: "Change the causal config",
        explain: cfg.fixTeach,
        kind: "resolve",
        prompt: cfg.fixPrompt,
        tools: ["config_editor", "landscape"],
        check: short(
          "Describe the fix you applied (or will apply) without disabling auth.",
          cfg.fixKeywords,
          "Name the config change.",
          0.3,
        ),
        seconds: 120,
      },
      {
        title: "Verify recovery",
        conceptIds: ["c-observability"],
        headline: "Prove health restored",
        explain:
          "Re-check resource health, re-read logs, confirm user journey. Declare victory only with evidence.",
        kind: "test_expected",
        prompt: "What evidence shows the incident is mitigated/fixed?",
        check: short(
          "Mention health, log, or user journey verification.",
          ["health", "healthy", "log", "success", "200", "user", "journey", "metric"],
          "Verification closes the loop.",
          0.25,
        ),
      },
    ]),
  );

  // PHASE 7 — Defense, PRR, transfer, reflection
  steps.push(
    ...phaseTeachBlock("7 · Defend & transfer", [
      {
        title: "Architecture board defense",
        conceptIds: cfg.archConceptIds,
        headline: "Adversarial questions are a gift",
        explain:
          "Boards attack weak assumptions: CAP vs RAP, identity propagation, retries, residency, cost, rollback, monitoring, ownership. Answer with verified vs assumed.",
        kind: "architecture_defense",
        prompt: cfg.defensePrompt,
        check: short(
          "Defend identity + one operational concern (monitoring/rollback/cost).",
          ["identity", "monitor", "rollback", "cost", "security", "resilience"],
          "Defense trains clarity.",
          0.3,
        ),
        seconds: 180,
      },
      {
        title: "Production readiness",
        conceptIds: ["c-slo", "c-finops"],
        headline: "Alerts, owners, runbooks, fidelity disclosure",
        explain:
          "Name alert signals, on-call owner, runbook link (conceptual), backup note, and tell stakeholders what is simulated vs real if demoing.",
        kind: "production_readiness",
        prompt: "List alert + owner + one runbook step + fidelity note.",
        check: short(
          "Include alert and owner.",
          ["alert", "owner"],
          "Operability is part of done.",
          0.5,
        ),
      },
      {
        title: "Prevention control",
        conceptIds: cfg.incidentConceptIds,
        headline: "Make recurrence expensive to ignore",
        explain: cfg.preventionTeach,
        kind: "concept_check",
        check: short(
          "Propose one prevention control (CI check, alert, review gate).",
          ["ci", "alert", "test", "review", "monitor", "gate", "checklist", "policy"],
          "Prevention is senior behavior.",
          0.25,
        ),
      },
      {
        title: "Transfer scenario",
        conceptIds: cfg.incidentConceptIds,
        headline: "Same structure, different skin",
        explain: cfg.transferTeach,
        kind: "transfer",
        prompt: cfg.transferPrompt,
        check: short(
          "Explain how today's mechanism transfers to the new scenario.",
          cfg.transferKeywords,
          "Transfer proves learning, not memorization.",
          0.25,
        ),
        seconds: 160,
      },
      {
        title: "Spaced recall",
        conceptIds: cfg.coreConceptIds,
        headline: "Force retrieval",
        explain:
          "Without notes, restate the three most important concepts from this mission and the root cause class.",
        kind: "spaced_practice",
        prompt: "List 3 concepts + the root cause class in your own words.",
        check: short(
          "Three concepts + cause class.",
          cfg.recallKeywords,
          "Retrieval strengthens memory.",
          0.25,
        ),
      },
      {
        title: "Reflection journal",
        conceptIds: ["c-observability"],
        headline: "Metacognition",
        explain:
          "What assumption failed? Which evidence corrected you? What will you do differently? Consider a break — Odyssey never punishes rest.",
        kind: "reflection",
        prompt:
          "Write reflection covering assumption, evidence, prevention, transfer. Use those words.",
        check: short(
          "Reflection with assumption/evidence/prevent/transfer ideas.",
          ["assumption", "evidence", "prevent", "transfer"],
          "Reflection consolidates learning.",
          0.5,
        ),
        seconds: 200,
      },
    ]),
  );

  return steps;
}

// ——— Mission configs ———
const missions = [];

missions.push(
  buildMissionShell(
    {
      id: "r1-northwind-order-insights",
      title: "Northwind Order Insights — Mega Teaching Vertical",
      summary:
        "Granular teaching journey: landscape, CAP/UI5/destination identity, then diagnose JWT audience mismatch with full evidence discipline.",
      campaignId: "campaign-a-startup-to-enterprise",
      domainIds: ["ui5-fiori", "cap", "hana-cloud", "security", "integration", "events", "operations", "architecture"],
      competencyIds: [
        "found-landscape",
        "cap-odata-basics",
        "ui5-odata-bind",
        "sec-jwt-audience",
        "arch-side-by-side",
        "ops-incident-basics",
      ],
      targetLevel: "basic",
      estimatedMinutes: 180,
      stops: ["After requirements", "After architecture", "After evidence gather", "After fix"],
      defect: {
        id: "defect-audience",
        description: "Destination audience wrong-audience-legacy",
        symptoms: ["UI 401", "JWT audience validation failed"],
        rootCause: "Destination audience not updated after client id rename",
        distractors: ["HANA healthy", "iflow success"],
      },
      incidentId: "inc-audience-mismatch",
      landscapeId: "startup-northwind",
    },
    granularArc({
      situationTeach:
        "Northwind wants EU sales analysts to explore order KPIs in a Fiori-style app. ERP remains system of record. Side-by-side BTP extension preferred. OAuth access, near-real-time sync, analytics events, constrained budget.",
      situationAnalogy: "Build a glass dashboard on top of the warehouse ledger — don't rewrite the warehouse.",
      situationPoints: [
        "Side-by-side on BTP",
        "ERP system of record",
        "EU analysts / residency sensitivity",
      ],
      situationPrompt:
        "Read the business brief in the teach panel. Restate goal + constraints in your own words.",
      situationKeywords: ["analyst", "order", "eu", "side", "erp", "kpi", "budget"],
      stakeholderTeach:
        "Sales ops wants 'real-time' (undefined). Security wants OAuth and least privilege. Integration wants reuse of existing ERP channels. Force definitions: how many seconds is real-time? which data classification?",
      stakeholderPrompt:
        "Write what each persona wants and flag one solution-shaped request.",
      stakeholderKeywords: ["security", "oauth", "real"],
      degradedKeywords: ["degraded", "ui", "destination", "order", "cap", "401"],
      coreConceptIds: ["c-cap-odata", "c-ui5-odata", "c-destination", "c-xsuaa-roles"],
      mapTeach:
        "Typical chain: UI5 app → destination → CAP OData API → HANA; identity via XSUAA-style scopes; iflow sync from ERP; events for analytics projection.",
      mapPrompt: "Map each hop in the chain to a landscape resource name.",
      mapKeywords: ["ui", "destination", "cap", "hana", "xsuaa", "iflow", "event"],
      archConceptIds: ["c-cap-odata", "c-ui5-odata", "c-cap-vs-rap"],
      archHeadline: "Side-by-side analytics UX with CAP",
      archExplain:
        "For a new analytics UX beside ERP, CAP + UI5 on BTP is a common side-by-side pattern. RAP may be better for deep transactional core extensions. Here, KPI exploration and OData V4 to a side-by-side model fit CAP teaching path — still document why not pure batch Excel dumps or ungoverned scripts.",
      archAnalogy: "Annex building for analytics, warehouse stays system of record.",
      archWhy: "Pattern choice drives identity, ops, and upgrade paths.",
      archPoints: ["UI5 for Fiori UX", "CAP OData API", "HANA persistence sim", "Events optional fan-out"],
      archMistakes: ["Hard-coding backend URLs in UI", "Skipping role design"],
      archWorked: {
        setup: "Analyst needs Orders list + KPI cards.",
        steps: [
          "Model Order entities in CAP CDS",
          "Expose service projection OData V4",
          "Bind CAP to HANA + auth service",
          "UI5 OData model via destination",
          "Role: Order.Read / Analytics.View",
        ],
        takeaway: "End-to-end identity-aware read path before fancy visuals.",
      },
      archReveals: [
        {
          title: "Deeper: destination auth",
          body: "UI never stores client secrets if destination handles OAuth flows appropriately.",
        },
        {
          title: "Expert nuance",
          body: "Audience and client IDs must stay aligned when auth applications are renamed.",
        },
      ],
      archMc: {
        q: "Why prefer destination-mediated calls from UI5?",
        options: [
          {
            text: "Centralize URL/auth config and avoid hard-coded secrets in UI",
            correct: true,
            feedback: "Correct.",
          },
          {
            text: "Destinations make SQL faster inside HANA",
            correct: false,
            feedback: "Wrong layer.",
          },
          {
            text: "They replace the need for authorization",
            correct: false,
            feedback: "Authz still required.",
          },
        ],
        explanation: "Destinations are connectivity+auth config, not business authz complete solution.",
      },
      archPrompt:
        "Propose UI5→destination→CAP→HANA plus identity and one rejected alternative (e.g., only nightly CSV).",
      archKeywords: ["ui5", "cap", "destination", "hana", "reject", "oauth", "xsuaa", "event"],
      identityKeywords: ["order.read", "analyst", "scope"],
      configureTeach:
        "Verify CAP bound to auth + HANA; destination auth mode; audience field; event topic name; analyst role only has read scopes.",
      configurePrompt: "List configuration checks you will perform before go-live.",
      configureKeywords: ["bind", "destination", "audience", "role", "scope", "hana"],
      failureHeadline: "Analysts report Order Insights broken",
      failureTeach:
        "Users can log into the landscape but Orders fail to load. Treat as a distributed failure until proven otherwise.",
      failurePrompt: "Describe user-visible failure and where you will look first.",
      failureKeywords: ["401", "load", "order", "fail", "blank", "error", "auth"],
      incidentConceptIds: ["c-jwt-audience", "c-destination", "c-ui5-odata"],
      evidenceKeywords: ["401", "audience", "jwt", "token", "destination"],
      hypothesisKeywords: ["audience", "destination", "jwt", "token"],
      distractorTeach:
        "HANA healthy and iflow success are distractors if the failing path is UI→destination→CAP auth validation.",
      diagnoseTeach:
        "Root cause class: JWT audience mismatch. Destination still mints/presents tokens for wrong-audience-legacy while CAP accepts order-service!t1.",
      diagnosePrompt:
        "State root cause with evidence terms: destination, audience/JWT, CAP rejection.",
      diagnoseHints: [
        "Token endpoint 200 ≠ API accepts token",
        "Compare destination audience to CAP accepted audiences",
        "Trace one request across hops",
      ],
      diagnoseKeywords: ["audience", "destination", "jwt", "token", "aud"],
      fixTeach:
        "Set destination audience to order-service!t1 (simulation). Re-check health. Do not disable JWT validation.",
      fixPrompt: "Describe the secure config change. Use the Apply secure fix control when ready.",
      fixKeywords: ["audience", "destination", "order-service", "fix"],
      defensePrompt:
        "Defend CAP side-by-side choice, identity, monitoring for auth_failure_count, and rollback of destination config.",
      preventionTeach:
        "Add CI validation that destination audience matches xs-security/app identity; alert on auth_failure_count; change checklist for client renames.",
      transferTeach:
        "Tomorrow the symptom might be missing scope (403). Same method: classify status code, inspect claims/roles, fix mapping — don't rebuild UI.",
      transferPrompt: "How would your method change for a 403 missing scope incident?",
      transferKeywords: ["403", "scope", "role", "authoriz"],
      recallKeywords: ["destination", "audience", "cap", "odata", "subaccount", "401"],
    }),
  ),
);

// Generate remaining missions with theme-specific arcs (still highly granular)
const themes = [
  {
    id: "r2-cap-rap-extension-lab",
    title: "Clean-Core Extension Lab — CAP vs RAP Mega",
    summary: "Deep CAP vs RAP teaching with 403 missing-scope incident and clean-core defense.",
    campaignId: "campaign-b-clean-core",
    domainIds: ["rap-abap", "cap", "architecture", "security"],
    competencyIds: ["rap-managed", "rap-vs-cap", "rap-clean-core", "arch-side-by-side", "found-identity"],
    targetLevel: "advanced",
    estimatedMinutes: 190,
    incidentId: "inc-scope-missing",
    landscapeId: "clean-core-enterprise",
    defect: {
      id: "defect-scope",
      description: "Missing Discount.Approve on Approver role collection",
      symptoms: ["403 on approve"],
      rootCause: "Role collection missing scope",
      distractors: ["UI bindings OK"],
    },
    cfg: {
      situationTeach:
        "Contoso needs discount approval extension. Clean-core required. Politics: ABAP team vs BTP team.",
      situationAnalogy: "Don't weld discounts into the engine if an annex workflow works.",
      situationPoints: ["Clean-core", "Approval action", "Least privilege"],
      situationPrompt: "Restate goal and clean-core constraint.",
      situationKeywords: ["discount", "clean", "approv", "core"],
      stakeholderTeach: "ABAP lead pushes RAP-only. Platform owner wants CAP. Security wants scoped approve.",
      stakeholderPrompt: "Capture conflicting solution proposals vs true needs.",
      stakeholderKeywords: ["rap", "cap", "scope"],
      degradedKeywords: ["degraded", "discount", "403", "cap"],
      coreConceptIds: ["c-cap-vs-rap", "c-clean-core", "c-scope-403"],
      mapTeach: "UI → destination → CAP action API; optional RAP BO on-stack for core objects.",
      mapPrompt: "Name RAP component vs CAP component in landscape.",
      mapKeywords: ["rap", "cap", "destination", "xsuaa"],
      archConceptIds: ["c-cap-vs-rap", "c-clean-core", "c-draft"],
      archHeadline: "Decision laboratory: CAP vs RAP",
      archExplain:
        "Use RAP when extending ABAP business objects transactionally on-stack with clean released APIs. Use CAP for side-by-side differentiating services and UX orchestration. Hybrid is allowed if boundaries are clean.",
      archAnalogy: "In-kitchen prep (RAP) vs food truck (CAP).",
      archWhy: "Dogma creates either upgrade risk or unnecessary dual maintenance.",
      archPoints: ["On-stack vs side-by-side", "Upgrade impact", "Team skills"],
      archMistakes: ["CAP always", "RAP always"],
      archWorked: {
        setup: "Discount approval with audit.",
        steps: [
          "Identify system of record fields",
          "Choose RAP if tight BO coupling",
          "Choose CAP if orchestration/UX side-by-side",
          "Design scopes Discount.Read/Approve",
        ],
        takeaway: "Write the decision criteria, not the slogan.",
      },
      archReveals: [
        { title: "Nuance", body: "Some landscapes use both with event integration between them." },
      ],
      archMc: {
        q: "Clean-core friendly approach?",
        options: [
          {
            text: "Prefer released APIs / extensions over core modifications",
            correct: true,
            feedback: "Yes.",
          },
          {
            text: "Modify SAP standard code freely for speed",
            correct: false,
            feedback: "Creates upgrade debt.",
          },
          { text: "Store PII in browser localStorage only", correct: false, feedback: "No." },
        ],
        explanation: "Clean-core protects upgradeability.",
      },
      archPrompt: "Pick CAP, RAP, or hybrid with rationale and rejected alternative.",
      archKeywords: ["cap", "rap", "clean", "reject", "scope"],
      configureTeach: "Ensure Approver role collection includes Discount.Approve; UI calls action via destination.",
      configurePrompt: "List role/scope checks.",
      configureKeywords: ["scope", "role", "approve", "destination"],
      failureHeadline: "403 on approveDiscount",
      failureTeach: "Users authenticate but cannot approve — classic authorization gap.",
      failurePrompt: "Separate authn success from authz failure.",
      failureKeywords: ["403", "approv", "forbidden", "author"],
      incidentConceptIds: ["c-scope-403", "c-xsuaa-roles"],
      evidenceKeywords: ["403", "scope", "approve", "role"],
      hypothesisKeywords: ["scope", "role", "403"],
      distractorTeach: "UI binding OK is a distractor; authorization is server-side.",
      diagnoseTeach: "Approver role collection missing Discount.Approve scope.",
      diagnosePrompt: "State missing scope / role collection mapping as root cause.",
      diagnoseHints: ["403 not 401", "Check role collection scopes"],
      diagnoseKeywords: ["scope", "role", "approve", "403"],
      fixTeach: "Add Discount.Approve to Approver collection; keep BusinessUser read-only.",
      fixPrompt: "Describe least-privilege role fix.",
      fixKeywords: ["scope", "approve", "role", "approver"],
      defensePrompt: "Defend CAP/RAP choice and least-privilege role model.",
      preventionTeach: "Automate role-scope matrix tests in CI.",
      transferTeach: "Audience mismatch is 401-class; missing scope is 403-class — same identity design discipline.",
      transferPrompt: "Contrast 401 audience vs 403 scope using status codes.",
      transferKeywords: ["401", "403", "audience", "scope"],
      recallKeywords: ["rap", "cap", "clean", "scope", "403"],
    },
  },
  {
    id: "r3-integration-crisis",
    title: "Global Integration Crisis — Mega",
    summary: "Idempotency, retries, certs, DLQ — taught step-by-step then applied to duplicate orders.",
    campaignId: "campaign-c-integration-crisis",
    domainIds: ["integration", "events", "security", "operations", "incident"],
    competencyIds: ["int-iflow", "evt-mesh", "ops-incident-basics", "int-hybrid", "found-identity"],
    targetLevel: "advanced",
    estimatedMinutes: 200,
    incidentId: "inc-duplicate-events",
    landscapeId: "integration-sprawl",
    defect: {
      id: "defect-dup",
      description: "No idempotency + expired cert",
      symptoms: ["duplicates", "TLS warnings"],
      rootCause: "Retries without idempotency + expired cert",
      distractors: ["UI theme change"],
    },
    cfg: {
      situationTeach: "Global order intake shows duplicates and partner TLS issues at peak.",
      situationAnalogy: "Double-stamped passports at a chaotic border.",
      situationPoints: ["Duplicates hurt finance", "Partner trust"],
      situationPrompt: "Restate business risk of duplicates.",
      situationKeywords: ["duplic", "order", "partner", "trust"],
      stakeholderTeach: "SRE wants backoff; partner manager wants uptime; security wants cert hygiene.",
      stakeholderPrompt: "List conflicting pressures.",
      stakeholderKeywords: ["retry", "cert", "uptime"],
      degradedKeywords: ["degraded", "iflow", "cert", "topic"],
      coreConceptIds: ["c-idempotency", "c-retry-backoff", "c-dlq"],
      mapTeach: "Partner → destination/iflow → events → order API.",
      mapPrompt: "Identify duplicate-prone hop.",
      mapKeywords: ["iflow", "destination", "event", "order"],
      archConceptIds: ["c-idempotency", "c-events-mesh", "c-retry-backoff"],
      archHeadline: "Idempotent intake design",
      archExplain:
        "At-least-once delivery requires idempotent consumers. Use business keys, DLQ, exponential backoff, cert monitoring.",
      archAnalogy: "Receipt numbers prevent double charge.",
      archWhy: "Retries without idempotency multiply pain.",
      archPoints: ["Idempotency key", "DLQ", "Backoff", "Cert expiry alerts"],
      archMistakes: ["Immediate infinite retry"],
      archWorked: {
        setup: "Partner resends Order 99.",
        steps: ["Detect key orderId", "Ignore duplicate", "Metric duplicate_rate", "Alert cert expiry"],
        takeaway: "Duplicates are design bugs, not bad luck.",
      },
      archReveals: [{ title: "Nuance", body: "Exactly-once is often a myth across systems; idempotency is practical." }],
      archMc: {
        q: "Best pair with retries?",
        options: [
          { text: "Idempotency keys + backoff", correct: true, feedback: "Yes." },
          { text: "Disable logging", correct: false, feedback: "No." },
          { text: "Random drop of 50% messages", correct: false, feedback: "No." },
        ],
        explanation: "Retries need idempotency.",
      },
      archPrompt: "Design idempotent intake with DLQ and cert monitoring.",
      archKeywords: ["idempoten", "dlq", "retry", "cert"],
      configureTeach: "Set idempotencyKey=orderId, exponential retry, enable DLQ, rotate cert metadata.",
      configurePrompt: "List config fields to set.",
      configureKeywords: ["idempoten", "retry", "dlq", "cert"],
      failureHeadline: "Duplicate orders + TLS warnings",
      failureTeach: "Two coupled defects often co-occur after messy change windows.",
      failurePrompt: "Name both symptom classes.",
      failureKeywords: ["duplic", "tls", "cert"],
      incidentConceptIds: ["c-idempotency", "c-dlq"],
      evidenceKeywords: ["duplic", "idempoten", "cert", "tls", "dlq"],
      hypothesisKeywords: ["idempoten", "cert", "retry"],
      distractorTeach: "UI theme changes are almost never order duplication causes.",
      diagnoseTeach: "Missing idempotency plus expired partner certificate.",
      diagnosePrompt: "State both contributing causes.",
      diagnoseHints: ["Retries amplify missing keys", "TLS logs show cert expiry"],
      diagnoseKeywords: ["idempoten", "duplicate", "cert", "tls"],
      fixTeach: "Enable idempotency + DLQ + rotate cert; backoff retries.",
      fixPrompt: "Describe secure integration fix.",
      fixKeywords: ["idempoten", "dlq", "cert", "retry"],
      defensePrompt: "Defend delivery semantics and operational ownership of iflows.",
      preventionTeach: "Contract tests for idempotency; cert expiry alerts; retry policy review.",
      transferTeach: "Same ideas apply to event consumers crashing on poison messages.",
      transferPrompt: "How does DLQ help poison messages?",
      transferKeywords: ["dlq", "poison", "consumer"],
      recallKeywords: ["idempoten", "retry", "dlq", "cert"],
    },
  },
  {
    id: "r4-data-galaxy",
    title: "Data Galaxy KPI Conflict — Mega",
    summary: "Teach semantic ownership, lineage, freshness; fix conflicting Net Revenue definitions.",
    campaignId: "campaign-d-data-enterprise",
    domainIds: ["hana-cloud", "datasphere", "bdc", "sac", "architecture"],
    competencyIds: ["hana-hdi", "ds-semantic", "bdc-products", "sac-stories", "found-data"],
    targetLevel: "advanced",
    estimatedMinutes: 190,
    incidentId: "inc-metric-conflict",
    landscapeId: "data-galaxy",
    defect: {
      id: "defect-metric",
      description: "Semantic mismatch + stale replica",
      symptoms: ["KPI mismatch"],
      rootCause: "Two Net Revenue definitions + stale replica",
      distractors: ["SAC theme"],
    },
    cfg: {
      situationTeach: "Finance and Sales disagree on Net Revenue; leadership wants governed products.",
      situationAnalogy: "Two maps with different north arrows.",
      situationPoints: ["Semantic ownership", "Freshness", "Lineage"],
      situationPrompt: "Restate the trust problem.",
      situationKeywords: ["revenue", "finance", "sales", "kpi"],
      stakeholderTeach: "Finance owns tax-inclusive logic; Sales optimizes for speed; Analytics mixes sources.",
      stakeholderPrompt: "Who should own the metric contract?",
      stakeholderKeywords: ["owner", "finance", "semantic"],
      degradedKeywords: ["degraded", "replica", "semantic", "stale"],
      coreConceptIds: ["c-data-product", "c-lineage", "c-hana-hdi"],
      mapTeach: "HANA → replica pipeline → semantic definitions → SAC story.",
      mapPrompt: "Name pipeline and two semantic nodes.",
      mapKeywords: ["hana", "replica", "semantic", "sac"],
      archConceptIds: ["c-data-product", "c-lineage"],
      archHeadline: "Governed data products",
      archExplain:
        "A data product needs owner, contract, SLA/freshness, quality tests, and lineage. Unofficial extracts create dueling truths.",
      archAnalogy: "SKU with a spec sheet.",
      archWhy: "Executive decisions need one semantic north star.",
      archPoints: ["Owner", "Contract", "Lineage", "Freshness SLO"],
      archMistakes: ["Shadow Excel pipelines"],
      archWorked: {
        setup: "Net Revenue conflict",
        steps: ["Assign finance owner", "Publish formula", "Bind SAC to official product", "Fix freshness"],
        takeaway: "Semantics first, charts second.",
      },
      archReveals: [{ title: "Nuance", body: "Business Data Cloud ecosystem relationships evolve — re-verify officially." }],
      archMc: {
        q: "Best fix for contradictory KPIs?",
        options: [
          { text: "Single owned semantic definition + freshness controls", correct: true, feedback: "Yes." },
          { text: "Add more colors to the chart", correct: false, feedback: "No." },
          { text: "Hide finance dashboard", correct: false, feedback: "Politics ≠ governance." },
        ],
        explanation: "Ownership + contract.",
      },
      archPrompt: "Propose data product contract for Net Revenue.",
      archKeywords: ["owner", "formula", "product", "lineage", "fresh"],
      configureTeach: "Align formulas; refresh replica; point SAC to official product.",
      configurePrompt: "List governance config changes.",
      configureKeywords: ["formula", "replica", "product", "owner"],
      failureHeadline: "Contradictory Net Revenue",
      failureTeach: "Often both semantic drift AND stale data.",
      failurePrompt: "Name both classes of defect.",
      failureKeywords: ["semantic", "stale", "replica", "definition"],
      incidentConceptIds: ["c-data-product", "c-lineage"],
      evidenceKeywords: ["stale", "formula", "tax", "replica"],
      hypothesisKeywords: ["semantic", "stale", "definition"],
      distractorTeach: "Theme color changes do not change tax formulas.",
      diagnoseTeach: "Two definitions (tax treatment) + stale replica flag.",
      diagnosePrompt: "State semantic mismatch and freshness failure.",
      diagnoseHints: ["Compare formulas", "Check lastSuccessHoursAgo"],
      diagnoseKeywords: ["semantic", "formula", "stale", "replica", "revenue"],
      fixTeach: "Align sales semantic to official formula; refresh replica; rebind SAC.",
      fixPrompt: "Describe governance fix.",
      fixKeywords: ["formula", "replica", "official", "product"],
      defensePrompt: "Defend data product ownership model.",
      preventionTeach: "Metric change review board; freshness SLO alerts.",
      transferTeach: "Same ownership model applies to customer count and churn metrics.",
      transferPrompt: "Apply data product thinking to churn.",
      transferKeywords: ["owner", "definition", "product"],
      recallKeywords: ["semantic", "lineage", "fresh", "product"],
    },
  },
  {
    id: "r5-security-siege",
    title: "Security Siege — Mega",
    summary: "Threat model multi-tenant SaaS; fix missing tenant guard and overbroad support role.",
    campaignId: "campaign-e-security-siege",
    domainIds: ["security", "operations", "cap", "architecture"],
    competencyIds: ["sec-threat-model", "sec-tenant", "cap-multitenant", "ops-sre", "arch-board"],
    targetLevel: "expert",
    estimatedMinutes: 200,
    incidentId: "inc-tenant-leak-attempt",
    landscapeId: "saas-multitenant",
    defect: {
      id: "defect-tenant",
      description: "tenantGuard false + Admin.All support",
      symptoms: ["cross-tenant audit"],
      rootCause: "Missing tenant guard; overbroad role",
      distractors: ["WAF noise"],
    },
    cfg: {
      situationTeach: "Multi-tenant CAP SaaS audit finds isolation gaps.",
      situationAnalogy: "Hotel master key opens every safe.",
      situationPoints: ["Tenant isolation", "Least privilege", "Audit"],
      situationPrompt: "Restate security risk.",
      situationKeywords: ["tenant", "isolat", "saas", "audit"],
      stakeholderTeach: "Support wants power tools; security wants least privilege; customers want trust.",
      stakeholderPrompt: "Balance support speed vs isolation.",
      stakeholderKeywords: ["support", "privilege", "tenant"],
      degradedKeywords: ["degraded", "tenant", "critical", "saas"],
      coreConceptIds: ["c-tenant-isolation", "c-threat-model", "c-least-privilege"],
      mapTeach: "App admin API, XSUAA roles, shared DB discriminator.",
      mapPrompt: "Identify trust boundary around admin export.",
      mapKeywords: ["admin", "tenant", "xsuaa", "db"],
      archConceptIds: ["c-tenant-isolation", "c-threat-model"],
      archHeadline: "Threat model the admin plane",
      archExplain:
        "Assets: tenant data. Adversaries: malicious tenant, compromised support. Controls: tenant guards, least privilege, audit, rate limits.",
      archAnalogy: "Castle walls + badges + ledgers.",
      archWhy: "Missing one control ends trust.",
      archPoints: ["Trust boundaries", "Support roles", "Audit"],
      archMistakes: ["Admin.All for convenience"],
      archWorked: {
        setup: "Export API",
        steps: ["Force tenant context", "Scope support roles", "Audit every export"],
        takeaway: "Admin plane is the crown jewel.",
      },
      archReveals: [{ title: "Expert", body: "Break-glass access needs time-boxed elevation + recording." }],
      archMc: {
        q: "Most dangerous default?",
        options: [
          { text: "Support role with Admin.All across tenants", correct: true, feedback: "Yes." },
          { text: "Read-only metrics for SRE", correct: false, feedback: "Usually fine." },
          { text: "Per-tenant encryption keys (concept)", correct: false, feedback: "Often good." },
        ],
        explanation: "Overbroad support is a classic breach path.",
      },
      archPrompt: "Threat model admin export path.",
      archKeywords: ["tenant", "threat", "support", "audit", "guard"],
      configureTeach: "Enable tenantGuard; reduce Support scopes.",
      configurePrompt: "List secure config changes.",
      configureKeywords: ["tenant", "guard", "support", "scope"],
      failureHeadline: "Cross-tenant export attempt audited",
      failureTeach: "Treat as security incident even if attempt failed.",
      failurePrompt: "Classify severity mindset.",
      failureKeywords: ["tenant", "export", "audit", "cross"],
      incidentConceptIds: ["c-tenant-isolation", "c-least-privilege"],
      evidenceKeywords: ["tenant", "guard", "admin", "support"],
      hypothesisKeywords: ["tenant", "guard", "privilege"],
      distractorTeach: "WAF scanner noise is not cross-tenant proof nor excuse.",
      diagnoseTeach: "tenantGuard=false on admin API; Support has Admin.All.",
      diagnosePrompt: "State isolation + privilege root causes.",
      diagnoseHints: ["Read app configuration flags", "Inspect role collections"],
      diagnoseKeywords: ["tenant", "isolation", "privilege", "admin", "guard"],
      fixTeach: "Enable tenant guard; shrink support role.",
      fixPrompt: "Describe dual fix.",
      fixKeywords: ["tenant", "guard", "support", "least"],
      defensePrompt: "Defend isolation architecture to a security board.",
      preventionTeach: "Isolation tests in CI; privilege reviews; break-glass process.",
      transferTeach: "Same isolation thinking applies to log systems that might leak tenant payloads.",
      transferPrompt: "How can logs break tenant isolation?",
      transferKeywords: ["log", "tenant", "pii", "isolat"],
      recallKeywords: ["tenant", "threat", "least", "audit"],
    },
  },
  {
    id: "r6-inherited-landscape",
    title: "Inherited Landscape — Mega",
    summary: "Reverse-engineer undocumented estate; teach discovery method; fix hidden file-drop coupling.",
    campaignId: "campaign-f-inherited",
    domainIds: ["architecture", "integration", "security", "operations", "incident"],
    competencyIds: ["arch-reverse", "int-iflow", "ops-incident-basics", "sec-threat-model"],
    targetLevel: "expert",
    estimatedMinutes: 200,
    incidentId: "inc-hidden-coupling",
    landscapeId: "inherited-messy",
    defect: {
      id: "defect-coupling",
      description: "Hidden folder race",
      symptoms: ["nightly intermittent failure"],
      rootCause: "Undocumented shared folder race; no owner",
      distractors: ["VPN banner"],
    },
    cfg: {
      situationTeach: "You inherit a mess: unknown owners, duplicate APIs, fragile nightly jobs.",
      situationAnalogy: "Archaeology with production SLAs.",
      situationPoints: ["Inventory", "Ownership", "Incremental modernization"],
      situationPrompt: "Restate mission of reverse engineering.",
      situationKeywords: ["inherit", "unknown", "document", "modern"],
      stakeholderTeach: "SMEs are busy/reluctant; sponsor wants 30-day plan.",
      stakeholderPrompt: "Plan discovery interviews.",
      stakeholderKeywords: ["owner", "interview", "plan"],
      degradedKeywords: ["degraded", "nightly", "unknown", "legacy"],
      coreConceptIds: ["c-observability", "c-iflow", "c-change-mgmt"],
      mapTeach: "Nightly job and legacy iflow share a folder contract nobody owns.",
      mapPrompt: "Find shared dependency.",
      mapKeywords: ["folder", "job", "iflow", "nightly"],
      archConceptIds: ["c-observability", "c-iflow"],
      archHeadline: "Discovery before rewrite",
      archExplain:
        "Inventory components, deps, owners, SLAs, risks. Prefer strangler patterns over big-bang rewrites.",
      archAnalogy: "Map the minefield before driving.",
      archWhy: "Rewriting unknowns recreates outages.",
      archPoints: ["Inventory", "Ownership", "Strangler"],
      archMistakes: ["Big-bang rewrite week 1"],
      archWorked: {
        setup: "Nightly fails sometimes",
        steps: ["Find shared folder", "Detect race", "Assign owners", "Add handshake"],
        takeaway: "Hidden coupling is a documentation failure and a design failure.",
      },
      archReveals: [{ title: "Expert", body: "Duplicate APIs often hide different auth assumptions." }],
      archMc: {
        q: "First week priority?",
        options: [
          { text: "Inventory + ownership + critical path reliability", correct: true, feedback: "Yes." },
          { text: "Rewrite everything in a new language", correct: false, feedback: "No." },
          { text: "Delete monitoring to reduce noise", correct: false, feedback: "No." },
        ],
        explanation: "Discovery and stabilize.",
      },
      archPrompt: "Propose 30-day discovery plan.",
      archKeywords: ["inventory", "owner", "depend", "risk"],
      configureTeach: "Assign owners; ready.flag handshake; monitoring.",
      configurePrompt: "List reliability fixes.",
      configureKeywords: ["owner", "handshake", "monitor", "race"],
      failureHeadline: "Intermittent nightly reconciliation failure",
      failureTeach: "Intermittent + unknown owner screams race/coupling.",
      failurePrompt: "Why intermittent suggests race.",
      failureKeywords: ["intermitt", "race", "nightly", "folder"],
      incidentConceptIds: ["c-iflow", "c-observability"],
      evidenceKeywords: ["folder", "race", "owner", "nightly"],
      hypothesisKeywords: ["race", "folder", "coupling"],
      distractorTeach: "VPN banner changes are almost never batch race causes.",
      diagnoseTeach: "Shared folder race between job and iflow; ownership unknown.",
      diagnosePrompt: "State coupling + ownership gap.",
      diagnoseHints: ["Look for same folder paths", "unknown owner tags"],
      diagnoseKeywords: ["coupling", "folder", "race", "owner"],
      fixTeach: "Assign owners; ready flag handshake; monitor lag.",
      fixPrompt: "Describe incremental reliability fix.",
      fixKeywords: ["owner", "handshake", "monitor", "ready"],
      defensePrompt: "Defend incremental modernization vs rewrite.",
      preventionTeach: "Architecture decision records; ownership registry; contract tests.",
      transferTeach: "Same discovery method applies after acquisitions.",
      transferPrompt: "How would you inventory an acquired subaccount estate?",
      transferKeywords: ["inventory", "subaccount", "owner"],
      recallKeywords: ["coupling", "owner", "inventory", "race"],
    },
  },
  {
    id: "r6-regulated-expansion",
    title: "Regulated Expansion — Mega",
    summary: "Teach residency/privacy deeply; disable non-approved PII replica.",
    campaignId: "campaign-g-regulated",
    domainIds: ["architecture", "security", "operations", "hana-cloud"],
    competencyIds: ["arch-regulated", "sec-tenant", "ops-finops", "found-identity"],
    targetLevel: "expert",
    estimatedMinutes: 190,
    incidentId: "inc-residency-violation",
    landscapeId: "regulated-global",
    defect: {
      id: "defect-residency",
      description: "PII US replica unapproved",
      symptoms: ["audit finding"],
      rootCause: "Replica enabled without residency approval",
      distractors: ["CDN static assets"],
    },
    cfg: {
      situationTeach: "Expand Order Insights with residency constraints; audit finds PII in wrong region.",
      situationAnalogy: "Vault contents shipped abroad for prettier charts.",
      situationPoints: ["Residency", "Retention", "Audit"],
      situationPrompt: "Restate residency constraint.",
      situationKeywords: ["residency", "pii", "region", "audit"],
      stakeholderTeach: "Privacy counsel vs analytics convenience.",
      stakeholderPrompt: "Whose constraint wins and why?",
      stakeholderKeywords: ["privacy", "analytics", "approv"],
      degradedKeywords: ["degraded", "replica", "us10", "pii"],
      coreConceptIds: ["c-residency", "c-least-privilege", "c-finops"],
      mapTeach: "EU primary PII DB; unapproved US replica; regional app.",
      mapPrompt: "Identify non-compliant store.",
      mapKeywords: ["eu", "us", "replica", "pii"],
      archConceptIds: ["c-residency", "c-finops"],
      archHeadline: "Residency-aware topology",
      archExplain:
        "Design data flows with region overlays. Analytics may use anonymized aggregates instead of raw PII replicas.",
      archAnalogy: "Keep passports in-country; share statistics, not identity pages.",
      archWhy: "Expansion dies on audit findings.",
      archPoints: ["Data flow diagrams", "Approval gates", "Anonymization"],
      archMistakes: ["Confusing language locale with residency"],
      archWorked: {
        setup: "Want US analytics",
        steps: ["Check classification", "Seek approval", "Prefer aggregates", "Disable raw PII replica"],
        takeaway: "Convenience never outranks lawful basis.",
      },
      archReveals: [{ title: "Nuance", body: "CDN static assets ≠ PII database residency." }],
      archMc: {
        q: "Residency primarily concerns…",
        options: [
          { text: "Where regulated data is stored/processed", correct: true, feedback: "Yes." },
          { text: "UI language pack only", correct: false, feedback: "Localization ≠ residency." },
          { text: "Font selection", correct: false, feedback: "No." },
        ],
        explanation: "Data location/processing.",
      },
      archPrompt: "Propose compliant expansion options.",
      archKeywords: ["residency", "pii", "aggreg", "region", "approv"],
      configureTeach: "Disable unapproved PII replica; document approval path.",
      configurePrompt: "List compliance config actions.",
      configureKeywords: ["disable", "replica", "pii", "approv"],
      failureHeadline: "Audit: PII replica in us10",
      failureTeach: "Audit findings are incidents with legal clocks.",
      failurePrompt: "State the compliance symptom.",
      failureKeywords: ["audit", "pii", "replica", "us"],
      incidentConceptIds: ["c-residency"],
      evidenceKeywords: ["pii", "replica", "approved", "us10"],
      hypothesisKeywords: ["residency", "replica", "pii"],
      distractorTeach: "Edge CDN for static JS is not the PII store.",
      diagnoseTeach: "US replica of PII enabled without approval.",
      diagnosePrompt: "State residency violation cause.",
      diagnoseHints: ["approved:false", "pii:true"],
      diagnoseKeywords: ["residency", "pii", "replica", "region"],
      fixTeach: "Disable non-compliant replica pending approval.",
      fixPrompt: "Describe compliance fix.",
      fixKeywords: ["disable", "replica", "pii", "residency"],
      defensePrompt: "Defend region topology to privacy board.",
      preventionTeach: "Pipeline policy-as-code residency gates.",
      transferTeach: "Retention schedules similarly need automated enforcement.",
      transferPrompt: "How is retention like residency?",
      transferKeywords: ["retention", "policy", "automat", "data"],
      recallKeywords: ["residency", "pii", "replica", "audit"],
    },
  },
  {
    id: "r-grand-enterprise",
    title: "Grand Enterprise Capstone — Mega",
    summary: "Compound outage teaching: triage, partition evidence, auth+integration+alert noise, board-ready narrative.",
    campaignId: "campaign-grand",
    domainIds: ["ui5-fiori", "cap", "integration", "events", "security", "operations", "architecture", "incident", "hana-cloud"],
    competencyIds: ["arch-board", "sec-jwt-audience", "int-iflow", "ops-sre", "ops-finops", "arch-side-by-side"],
    targetLevel: "expert",
    estimatedMinutes: 220,
    incidentId: "inc-compound-outage",
    landscapeId: "grand-enterprise",
    defect: {
      id: "defect-compound",
      description: "Audience + backlog + alert noise",
      symptoms: ["401", "queue depth", "page storms"],
      rootCause: "Uncoordinated change window",
      distractors: ["Office wifi"],
    },
    cfg: {
      situationTeach:
        "Acquisition chaos, board Friday, customer escalations, compound technical failures across identity and integration.",
      situationAnalogy: "Three alarms, one oxygen tank — triage.",
      situationPoints: ["Business impact first", "Partition incidents", "No security disable"],
      situationPrompt: "State top business impact to protect first.",
      situationKeywords: ["customer", "order", "board", "escal"],
      stakeholderTeach: "Politics conflict; keep requirements vs blame separate.",
      stakeholderPrompt: "Write neutral incident goals.",
      stakeholderKeywords: ["impact", "restore", "communicat"],
      degradedKeywords: ["degraded", "401", "backlog", "alert"],
      coreConceptIds: ["c-jwt-audience", "c-idempotency", "c-slo", "c-change-mgmt"],
      mapTeach: "Auth path + integration backlog + noisy pager board.",
      mapPrompt: "Partition three problem areas.",
      mapKeywords: ["audience", "iflow", "alert", "ui", "destination"],
      archConceptIds: ["c-change-mgmt", "c-slo", "c-jwt-audience"],
      archHeadline: "Compound incident command",
      archExplain:
        "Triage by business impact. Partition evidence streams. Restore auth, drain backlog idempotently, fix SLOs to stop noise.",
      archAnalogy: "ER triage + specialists.",
      archWhy: "Unpartitioned incidents thrash teams.",
      archPoints: ["Impact order", "Evidence partitions", "Change freeze"],
      archMistakes: ["Fixing alerts only", "Disabling auth"],
      archWorked: {
        setup: "401 + backlog + pages",
        steps: ["Fix audience", "Idempotent reprocess", "SLO-based alerts"],
        takeaway: "Coordination is a technical control.",
      },
      archReveals: [{ title: "Expert", body: "Incident commander role separates decisive sequencing from deep dives." }],
      archMc: {
        q: "First move in compound outage?",
        options: [
          { text: "Triage business impact and freeze risky related changes", correct: true, feedback: "Yes." },
          { text: "Rewrite all services", correct: false, feedback: "No." },
          { text: "Mute all customers", correct: false, feedback: "No." },
        ],
        explanation: "Triage + freeze.",
      },
      archPrompt: "Write incident command sequence.",
      archKeywords: ["triage", "auth", "backlog", "alert", "freeze"],
      configureTeach: "Audience fix + backlog drain + SLO alerts.",
      configurePrompt: "List three remediation tracks.",
      configureKeywords: ["audience", "backlog", "slo", "alert"],
      failureHeadline: "Compound outage under board pressure",
      failureTeach: "Pressure increases cognitive bias — use checklists.",
      failurePrompt: "Name three symptom classes.",
      failureKeywords: ["401", "backlog", "alert", "page"],
      incidentConceptIds: ["c-jwt-audience", "c-slo", "c-idempotency"],
      evidenceKeywords: ["401", "audience", "queue", "alert", "slo"],
      hypothesisKeywords: ["audience", "backlog", "change"],
      distractorTeach: "Office Wi-Fi complaints rarely explain multi-tenant API 401 spikes.",
      diagnoseTeach: "Uncoordinated changes: audience mismatch + integration backlog + alert noise without SLOs.",
      diagnosePrompt: "State compound root cause narrative.",
      diagnoseHints: ["Partition signals", "Identity vs integration vs observability"],
      diagnoseKeywords: ["audience", "backlog", "alert", "change", "compound"],
      fixTeach: "Fix audience; drain with idempotency; set SLO alerts.",
      fixPrompt: "Describe multi-track remediation.",
      fixKeywords: ["audience", "backlog", "slo", "idempoten"],
      defensePrompt: "Present board narrative: impact, cause, fix, prevention, residual risk.",
      preventionTeach: "Change calendar; integration+identity coupled change reviews; SLO program.",
      transferTeach: "Same IC method for multi-region failovers.",
      transferPrompt: "How does triage apply to region failover?",
      transferKeywords: ["triage", "impact", "failover", "region"],
      recallKeywords: ["triage", "audience", "slo", "backlog"],
    },
  },
];

for (const t of themes) {
  missions.push(
    buildMissionShell(
      {
        id: t.id,
        title: t.title,
        summary: t.summary,
        campaignId: t.campaignId,
        domainIds: t.domainIds,
        competencyIds: t.competencyIds,
        targetLevel: t.targetLevel,
        estimatedMinutes: t.estimatedMinutes,
        stops: ["After architecture", "After evidence", "After fix", "After defense"],
        defect: t.defect,
        incidentId: t.incidentId,
        landscapeId: t.landscapeId,
      },
      granularArc(t.cfg),
    ),
  );
}

for (const m of missions) {
  w(`missions/${m.id}.json`, m);
}

// Concept index
w("concepts/index.json", {
  version: "2.0.0",
  count: CONCEPTS.length,
  ids: CONCEPTS.map((c) => c.id),
});

// Learning paths index for UI
w("learning-paths/index.json", {
  version: "2.0.0",
  paths: [
    {
      id: "path-foundations",
      title: "Foundations of BTP Landscapes",
      conceptIds: ["c-global-account", "c-subaccount", "c-cf-space", "c-entitlement", "c-shared-responsibility"],
    },
    {
      id: "path-identity",
      title: "Identity & Authorization Deep Dive",
      conceptIds: ["c-xsuaa-roles", "c-jwt-audience", "c-scope-403", "c-destination", "c-principal-propagation", "c-least-privilege"],
    },
    {
      id: "path-appdev",
      title: "UI5 + CAP Application Path",
      conceptIds: ["c-cap-odata", "c-ui5-odata", "c-binding", "c-hana-hdi", "c-odata-metadata", "c-fiori-elements"],
    },
    {
      id: "path-integration",
      title: "Integration & Events Path",
      conceptIds: ["c-iflow", "c-idempotency", "c-retry-backoff", "c-events-mesh", "c-dlq", "c-saga"],
    },
    {
      id: "path-data",
      title: "Data & Semantics Path",
      conceptIds: ["c-data-product", "c-lineage", "c-hana-hdi", "c-sac-story"],
    },
    {
      id: "path-security-ops",
      title: "Security, Residency & Ops Path",
      conceptIds: ["c-threat-model", "c-tenant-isolation", "c-residency", "c-slo", "c-finops", "c-observability"],
    },
  ],
});

console.log(
  JSON.stringify(
    {
      concepts: CONCEPTS.length,
      missions: missions.length,
      stepsPerMission: missions.map((m) => ({ id: m.id, steps: m.steps.length })),
      totalSteps: missions.reduce((a, m) => a + m.steps.length, 0),
    },
    null,
    2,
  ),
);
