/**
 * Generates full R1–R6 curriculum content pack (deterministic, reviewable JSON).
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

const source = (product, url, title, confidence = "medium") => ({
  productOrService: product,
  sourceUrl: url,
  sourceTitle: title,
  retrievalDate: "2026-08-07",
  confidence,
  deprecationStatus: "current",
  contentOwner: "curriculum",
});

const btp = source("SAP BTP", "https://help.sap.com/docs/btp", "SAP BTP documentation hub");
const cap = source("SAP CAP", "https://cap.cloud.sap/", "SAP CAP documentation");
const ui5 = source("SAPUI5", "https://ui5.sap.com/", "SAPUI5 documentation");
const hana = source("SAP HANA Cloud", "https://help.sap.com/docs/HANA_CLOUD", "SAP HANA Cloud docs");
const isuite = source(
  "SAP Integration Suite",
  "https://help.sap.com/docs/integration-suite",
  "SAP Integration Suite docs",
);

const domains = [
  ["ui5-fiori", "SAPUI5 and SAP Fiori", "Experience City", ["SAPUI5", "SAP Fiori", "Fiori elements"], ["SAPUI5/Fiori Developer"]],
  ["cap", "SAP Cloud Application Programming Model", "Cloud Application Foundry", ["SAP CAP"], ["CAP Developer"]],
  ["rap-abap", "RAP and ABAP Cloud", "Clean Core Citadel", ["ABAP RESTful Application Programming Model", "ABAP Cloud"], ["RAP/ABAP Cloud Developer"]],
  ["integration", "Integration Suite", "Integration Transit Network", ["SAP Integration Suite", "SAP Cloud Integration"], ["Integration Developer"]],
  ["events", "Event-Driven Architecture", "Event Constellation", ["SAP Event Mesh / event services"], ["Event-Driven Architect"]],
  ["bpa", "Build Process Automation", "Automation Works", ["SAP Build Process Automation"], ["Process Automation Specialist"]],
  ["workzone", "Build Work Zone", "Digital Workplace Plaza", ["SAP Build Work Zone"], ["Work Zone Experience Specialist"]],
  ["hana-cloud", "SAP HANA Cloud", "Data Core", ["SAP HANA Cloud"], ["HANA Cloud Developer"]],
  ["datasphere", "SAP Datasphere", "Semantic Fabric", ["SAP Datasphere"], ["Data Engineer"]],
  ["bdc", "Business Data Cloud Ecosystem", "Data Galaxy", ["SAP Business Data Cloud", "SAP Databricks", "SAP Analytics Cloud"], ["Data Engineer", "Analytics Specialist"]],
  ["sac", "SAP Analytics Cloud", "Decision Observatory", ["SAP Analytics Cloud"], ["Analytics Specialist"]],
  ["security", "BTP Security and Identity", "Trust Fortress", ["SAP Cloud Identity Services", "XSUAA concepts"], ["Security Architect"]],
  ["operations", "BTP Administration and Operations", "Mission Control", ["SAP BTP"], ["BTP Administrator", "Platform/Site Reliability Engineer"]],
  ["incident", "Debugging and Incident Response", "Incident Foundry", ["Cross-domain"], ["Technical Support and Incident Specialist"]],
  ["architecture", "Solution and Enterprise Architecture", "Architecture Arena", ["Cross-domain"], ["Solution Architect", "Enterprise Architect"]],
  ["ai", "Responsible AI on BTP", "Cognitive Laboratory", ["AI topics on BTP"], ["Solution Architect"]],
];

for (const [id, title, district, products, specs] of domains) {
  w(`domains/${id}.json`, {
    id,
    title,
    districtName: district,
    summary: `${title} learning district in the Odyssey universe.`,
    sapProducts: products,
    specializations: specs,
    confidence: id === "bdc" || id === "ai" ? "low" : "medium",
    notes:
      id === "bdc"
        ? "Business Data Cloud relationships require expert verification; not treated as a simple rename."
        : undefined,
    sources: [btp],
  });
}

const competencies = [
  // Foundation
  ["found-landscape", "operations", "basic", [], "Explain BTP landscape structure"],
  ["found-appdev", "cap", "basic", ["found-landscape"], "Application development fundamentals on BTP"],
  ["found-integration", "integration", "basic", ["found-landscape"], "Integration fundamentals"],
  ["found-data", "hana-cloud", "basic", ["found-landscape"], "Data fundamentals on BTP"],
  ["found-identity", "security", "basic", ["found-landscape"], "Identity and trust fundamentals"],
  ["found-ops", "operations", "basic", ["found-landscape"], "Operations and observability fundamentals"],
  ["found-architecture", "architecture", "basic", ["found-landscape"], "Architecture trade-off fundamentals"],
  ["found-responsible-ai", "ai", "basic", ["found-landscape"], "Responsible AI limitations and oversight"],
  ["found-debug", "incident", "basic", ["found-landscape"], "Debugging fundamentals with evidence"],
  // UI5
  ["ui5-mvc", "ui5-fiori", "basic", ["found-appdev"], "UI5 MVC, views, controllers, routing"],
  ["ui5-odata-bind", "ui5-fiori", "basic", ["ui5-mvc", "cap-odata-basics"], "Connect UI5 to OData via destination"],
  ["ui5-a11y", "ui5-fiori", "advanced", ["ui5-mvc"], "Fiori accessibility and responsive behavior"],
  ["ui5-perf", "ui5-fiori", "advanced", ["ui5-odata-bind"], "UI performance diagnosis"],
  // CAP
  ["cap-odata-basics", "cap", "basic", ["found-appdev"], "Design a basic CAP OData service"],
  ["cap-auth", "cap", "advanced", ["cap-odata-basics", "found-identity"], "CAP authentication and authorization"],
  ["cap-events", "cap", "advanced", ["cap-odata-basics", "found-integration"], "CAP messaging and events"],
  ["cap-multitenant", "cap", "expert", ["cap-auth"], "Multitenancy isolation concepts"],
  // RAP
  ["rap-managed", "rap-abap", "basic", ["found-appdev"], "RAP managed scenario basics"],
  ["rap-vs-cap", "rap-abap", "advanced", ["rap-managed", "cap-odata-basics"], "CAP vs RAP decision laboratory"],
  ["rap-clean-core", "rap-abap", "advanced", ["rap-managed"], "Clean-core extension strategies"],
  // Integration & events
  ["int-iflow", "integration", "basic", ["found-integration"], "Design integration flows with error handling"],
  ["int-api-mgmt", "integration", "advanced", ["int-iflow"], "API management and governance concepts"],
  ["int-hybrid", "integration", "advanced", ["int-iflow", "found-identity"], "Hybrid connectivity and principal propagation concepts"],
  ["evt-mesh", "events", "basic", ["found-integration"], "Topics, subscriptions, idempotency"],
  ["evt-saga", "events", "expert", ["evt-mesh"], "Saga and compensating transactions"],
  // BPA / Work Zone
  ["bpa-workflow", "bpa", "basic", ["found-appdev"], "Workflow, decisions, human-in-the-loop"],
  ["wz-sites", "workzone", "basic", ["found-appdev", "found-identity"], "Work Zone sites, roles, content federation concepts"],
  // Data
  ["hana-hdi", "hana-cloud", "basic", ["found-data"], "HDI containers and privileges concepts"],
  ["hana-perf", "hana-cloud", "advanced", ["hana-hdi"], "Query plan and expensive statement diagnosis"],
  ["ds-semantic", "datasphere", "basic", ["found-data"], "Semantic modeling and federation concepts"],
  ["bdc-products", "bdc", "basic", ["found-data"], "Data products and governance concepts"],
  ["sac-stories", "sac", "basic", ["found-data"], "Analytical stories and planning concepts"],
  // Security & ops
  ["sec-jwt-audience", "security", "advanced", ["ui5-odata-bind", "found-identity"], "Diagnose JWT audience mismatches"],
  ["sec-threat-model", "security", "advanced", ["found-identity"], "Threat model a multi-service landscape"],
  ["sec-tenant", "security", "expert", ["sec-threat-model", "cap-multitenant"], "Tenant isolation review"],
  ["ops-entitlements", "operations", "basic", ["found-ops"], "Entitlements, quotas, service plans"],
  ["ops-incident-basics", "incident", "basic", ["found-debug", "found-ops"], "Incident triage and post-incident review"],
  ["ops-finops", "operations", "advanced", ["ops-entitlements"], "FinOps cost awareness on BTP"],
  ["ops-sre", "operations", "advanced", ["ops-incident-basics"], "SLOs, alerts, resilience patterns"],
  // Architecture
  ["arch-side-by-side", "architecture", "basic", ["found-architecture"], "Propose a side-by-side BTP design"],
  ["arch-board", "architecture", "advanced", ["arch-side-by-side"], "Defend design before architecture board"],
  ["arch-reverse", "architecture", "expert", ["arch-board", "ops-incident-basics"], "Reverse-engineer inherited landscape"],
  ["arch-regulated", "architecture", "expert", ["arch-board", "sec-tenant"], "Regulated multi-jurisdiction expansion"],
];

for (const [id, domainId, level, prereq, title] of competencies) {
  w(`competencies/${id}.json`, {
    id,
    title,
    domainId,
    description: `${title}. Evidence is demonstration-based in simulation, not XP.`,
    level,
    prerequisites: prereq,
    misconceptions: [
      "Multiple-choice alone proves mastery",
      "Simulation behaves identically to every live landscape",
    ],
    practiceFormats: ["explanation", "configuration", "debugging", "architecture_construction"],
    evidenceRequirements: [`Demonstrate ${title} in a mission or assessment`],
    transferTasks: [`Apply ${title} in a structurally different scenario`],
    retentionChecks: [`Revisit ${title} after spaced interval`],
    sources: [domainId === "cap" ? cap : domainId === "ui5-fiori" ? ui5 : domainId === "hana-cloud" ? hana : domainId === "integration" ? isuite : btp],
    reviewStatus: "in_review",
    version: "0.2.0",
  });
}

const fidelity = (extra = {}) => ({
  tier: "tier2_behavioral",
  behaviorsRepresented: [
    "Landscape hierarchy and dependencies",
    "Configuration fields and health",
    "Logs, metrics, traces for failures",
    "Identity/destination concepts",
  ],
  behaviorsSimplified: [
    "No real JWT cryptography",
    "No live SAP runtime",
    "Illustrative costs",
  ],
  behaviorsOmitted: ["Real CF/Kyma deploy", "Cloud Connector crypto", "Live entitlements billing"],
  differencesFromReal: [
    "Defects injected as configuration and synthetic telemetry",
    "Service plans and pricing fictionalized for learning",
  ],
  lastVerificationDate: "2026-08-07",
  knownLimitations: [
    "Not a substitute for official SAP certification or a real BTP trial",
    "Verify production decisions against official SAP documentation",
  ],
  sourceVersions: ["curriculum-0.2.0"],
  ...extra,
});

function steps(list) {
  return list.map((s, i) => ({
    id: s.id || `step-${i + 1}`,
    title: s.title,
    kind: s.kind,
    prompt: s.prompt,
    tools: s.tools || ["editor"],
    successCriteria: s.successCriteria || ["Learner produces a reasoned response"],
    hints: s.hints || [],
  }));
}

const loopBase = (context) =>
  steps([
    {
      id: "step-situation",
      title: "Business situation",
      kind: "business_situation",
      prompt: context.situation,
      tools: ["briefing"],
    },
    {
      id: "step-stakeholders",
      title: "Stakeholder interview",
      kind: "stakeholder_interview",
      prompt: context.stakeholders,
      tools: ["dialogue"],
    },
    {
      id: "step-requirements",
      title: "Requirements separation",
      kind: "requirements",
      prompt:
        "Separate functional requirements, non-functional requirements, constraints, assumptions, and missing evidence.",
    },
    {
      id: "step-landscape",
      title: "Inspect landscape",
      kind: "landscape_inspect",
      prompt: "Inspect the simulated landscape: health, dependencies, ownership, cost, security posture.",
      tools: ["landscape"],
    },
    {
      id: "step-architecture",
      title: "Architecture hypothesis",
      kind: "architecture_hypothesis",
      prompt: context.architecture,
    },
    {
      id: "step-options",
      title: "Compare options",
      kind: "option_compare",
      prompt:
        "Compare at least two options on security, cost, resilience, complexity, and operational ownership. Document rejected alternatives.",
    },
    {
      id: "step-implement",
      title: "Configure / implement (simulated)",
      kind: "configure",
      prompt: context.implement,
      tools: ["config_editor"],
    },
    {
      id: "step-test-expected",
      title: "Test expected behavior",
      kind: "test_expected",
      prompt: "Describe happy-path verification steps.",
      tools: ["test_runner"],
    },
    {
      id: "step-test-failure",
      title: "Test failure behavior",
      kind: "test_failure",
      prompt: context.failure,
      tools: ["observability"],
    },
    {
      id: "step-observe",
      title: "Observe evidence",
      kind: "observe",
      prompt: "Inspect logs, metrics, and traces. Separate primary evidence from distractors.",
      tools: ["logs", "metrics", "traces"],
    },
    {
      id: "step-diagnose",
      title: "Diagnose root cause",
      kind: "diagnose",
      prompt: "State root-cause hypothesis with evidence. Process quality is scored, not only the final phrase.",
      tools: ["diagnosis"],
      hints: context.hints || [],
    },
    {
      id: "step-mitigate",
      title: "Mitigate business impact",
      kind: "mitigate",
      prompt: "Propose short-term mitigation and stakeholder communication before permanent fix.",
      tools: ["comms"],
    },
    {
      id: "step-resolve",
      title: "Resolve defect",
      kind: "resolve",
      prompt: context.resolve,
      tools: ["config_editor", "landscape"],
    },
    {
      id: "step-defense",
      title: "Architecture defense",
      kind: "architecture_defense",
      prompt:
        "Defend service selection, rejected alternatives, identity, resilience, monitoring, cost, rollback. Simulated board only.",
      tools: ["mentor_board"],
    },
    {
      id: "step-prd",
      title: "Production-readiness review",
      kind: "production_readiness",
      prompt: "Alerts, owners, runbook notes, fidelity disclosure for stakeholders, backup/restore notes.",
      tools: ["checklist"],
    },
    {
      id: "step-reflection",
      title: "Reflection",
      kind: "reflection",
      prompt:
        "What assumption failed? Which evidence corrected you? Prevention control? Transfer scenario? Consider a break if session is long.",
      tools: ["journal"],
    },
  ]);

const missions = [
  {
    id: "r1-northwind-order-insights",
    title: "Northwind Order Insights — Startup Vertical",
    campaignId: "campaign-a-startup-to-enterprise",
    summary:
      "Side-by-side UI5 + CAP + HANA + identity + integration + events. Diagnose destination JWT audience mismatch.",
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
    incidentId: "inc-audience-mismatch",
    landscapeId: "startup-northwind",
    estimatedMinutes: 90,
    context: {
      situation:
        "Northwind Distribution wants EU sales analysts to explore order KPIs in a Fiori-style app. ERP remains system of record. Side-by-side on BTP, OAuth access, near-real-time sync, analytics events. Budget constrained.",
      stakeholders:
        "Interview sales ops, security officer, and integration owner. Flag proposed solutions presented as requirements.",
      architecture:
        "Propose UI5 → destination → CAP OData → HANA; XSUAA scopes; ERP iflow; OrderCreated events. Reject at least one weaker alternative.",
      implement: "Confirm bindings, role collections for read-only analysts, destination auth mode, event schema name.",
      failure: "Analysts report the app broken with authorization errors. Observe without premature root cause.",
      resolve: "Fix destination audience to order-service!t1 without disabling authentication. Re-check health.",
      hints: [
        "Which hop fails first in UI → destination → CAP?",
        "Token endpoint 200 does not imply resource acceptance.",
        "Compare destination audience to CAP accepted audiences.",
      ],
    },
    defect: {
      id: "defect-audience",
      description: "Destination audience wrong-audience-legacy",
      symptoms: ["UI 401", "JWT audience validation failed"],
      rootCause: "Destination audience not updated after client id rename",
      distractors: ["HANA healthy", "iflow success"],
    },
  },
  {
    id: "r2-cap-rap-extension-lab",
    title: "Clean-Core Extension Lab — CAP vs RAP",
    campaignId: "campaign-b-clean-core",
    summary: "Modernize a fictional order discount extension. Choose CAP side-by-side vs RAP on-stack with evidence.",
    domainIds: ["rap-abap", "cap", "architecture", "security"],
    competencyIds: ["rap-managed", "rap-vs-cap", "rap-clean-core", "arch-side-by-side", "found-identity"],
    targetLevel: "advanced",
    incidentId: "inc-scope-missing",
    landscapeId: "clean-core-enterprise",
    estimatedMinutes: 100,
    context: {
      situation:
        "Contoso Retail needs a discount approval extension. Clean-core principles required. Some team members insist everything must be RAP; others want only CAP microservices.",
      stakeholders: "Interview clean-core architect, ABAP lead, and BTP platform owner.",
      architecture:
        "Compare RAP managed on-stack vs CAP side-by-side for the discount UX and API. Document clean-core alignment and upgrade impact.",
      implement: "Select pattern, define auth scopes, and note transport/lifecycle implications (simulated).",
      failure: "After deploy, 403 on discount action for business users.",
      resolve: "Grant missing scope/role collection mapping without over-privileging admins.",
      hints: ["403 often means authenticated but unauthorized", "Check role collection to scope mapping", "Avoid granting Admin for convenience"],
    },
    defect: {
      id: "defect-scope",
      description: "Missing Discount.Approve scope on business role collection",
      symptoms: ["HTTP 403", "action hidden/failed"],
      rootCause: "Role collection missing required scope after redesign",
      distractors: ["UI binding looks fine", "HANA CPU normal"],
    },
  },
  {
    id: "r3-integration-crisis",
    title: "Global Integration Crisis — Duplicate Orders",
    campaignId: "campaign-c-integration-crisis",
    summary: "Stabilize API sprawl: expired cert symptoms, duplicate messages, undocumented mapping, partner timeouts.",
    domainIds: ["integration", "events", "security", "operations", "incident"],
    competencyIds: ["int-iflow", "evt-mesh", "ops-incident-basics", "int-hybrid", "found-identity"],
    targetLevel: "advanced",
    incidentId: "inc-duplicate-events",
    landscapeId: "integration-sprawl",
    estimatedMinutes: 110,
    context: {
      situation:
        "Global order intake shows duplicate customer orders and intermittent partner failures during peak.",
      stakeholders: "Interview integration lead, partner manager, and SRE.",
      architecture:
        "Design idempotent intake with clear ownership, DLQ, retries, and event contracts. Reject fire-and-forget without keys.",
      implement: "Configure idempotency key, retry policy, and dead-letter handling in simulation.",
      failure: "Duplicates observed; some messages poison the consumer.",
      resolve: "Enable idempotency on orderId and route poison messages to DLQ; rotate expired cert metadata.",
      hints: ["Check correlation and idempotency keys", "Retries without idempotency amplify duplicates", "Certificate expiry appears in TLS logs"],
    },
    defect: {
      id: "defect-dup",
      description: "Missing idempotency key and expired partner cert",
      symptoms: ["duplicate orders", "TLS handshake warnings"],
      rootCause: "Retry without idempotency plus expired certificate on partner destination",
      distractors: ["UI theme change last week"],
    },
  },
  {
    id: "r4-data-galaxy",
    title: "Intelligent Data Enterprise — KPI Conflict",
    campaignId: "campaign-d-data-enterprise",
    summary: "Governed data products across HANA, Datasphere concepts, and analytics; resolve contradictory KPI definitions.",
    domainIds: ["hana-cloud", "datasphere", "bdc", "sac", "architecture"],
    competencyIds: ["hana-hdi", "ds-semantic", "bdc-products", "sac-stories", "found-data"],
    targetLevel: "advanced",
    incidentId: "inc-metric-conflict",
    landscapeId: "data-galaxy",
    estimatedMinutes: 100,
    context: {
      situation:
        "Finance and sales dashboards disagree on 'Net Revenue'. Leadership wants governed data products and lineage.",
      stakeholders: "Interview finance controller, analytics lead, and data steward.",
      architecture:
        "Propose semantic ownership, data product contracts, and lineage. Avoid uncontrolled spreadsheet extracts.",
      implement: "Define data product contract fields and owner; note quality checks.",
      failure: "Contradictory metrics after pipeline refresh; stale replication suspected by some.",
      resolve: "Align semantic definition and fix stale replication schedule flag in simulation.",
      hints: ["Check lineage and definition owners", "Stale replication vs semantic mismatch are different failures", "Document metric formula"],
    },
    defect: {
      id: "defect-metric",
      description: "Semantic mismatch plus stale replica flag",
      symptoms: ["KPI mismatch", "lineage gap"],
      rootCause: "Two definitions of Net Revenue and delayed replica refresh",
      distractors: ["SAC theme colors changed"],
    },
  },
  {
    id: "r5-security-siege",
    title: "Security Siege — Multi-Tenant Hardening",
    campaignId: "campaign-e-security-siege",
    summary: "Threat-model and harden a multi-tenant fictional platform without sacrificing accessibility or continuity.",
    domainIds: ["security", "operations", "cap", "architecture"],
    competencyIds: ["sec-threat-model", "sec-tenant", "cap-multitenant", "ops-sre", "arch-board"],
    targetLevel: "expert",
    incidentId: "inc-tenant-leak-attempt",
    landscapeId: "saas-multitenant",
    estimatedMinutes: 120,
    context: {
      situation:
        "A SaaS CAP app on BTP serves multiple customers. Audit finds excessive privileges and weak tenant checks on one API.",
      stakeholders: "Interview security architect, customer success, and product owner.",
      architecture: "Threat model trust boundaries, tenant isolation, secret rotation, audit logging.",
      implement: "Reduce role privileges and enforce tenant predicate on queries (simulated flags).",
      failure: "Cross-tenant access attempt appears in audit logs.",
      resolve: "Enable tenant isolation guard and revoke overbroad role; verify audit trail.",
      hints: ["Look for missing tenant predicates", "Excessive privilege on support role", "Audit gaps hide lateral movement"],
    },
    defect: {
      id: "defect-tenant",
      description: "Missing tenant isolation guard on admin API",
      symptoms: ["cross-tenant audit warning", "overbroad role"],
      rootCause: "Admin API omitted tenant check; support role too broad",
      distractors: ["WAF noise from scanners"],
    },
  },
  {
    id: "r6-inherited-landscape",
    title: "Inherited Landscape — Reverse Engineering",
    campaignId: "campaign-f-inherited",
    summary: "Undocumented enterprise landscape: discover components, risks, modernization increments.",
    domainIds: ["architecture", "integration", "security", "operations", "incident"],
    competencyIds: ["arch-reverse", "int-iflow", "ops-incident-basics", "sec-threat-model"],
    targetLevel: "expert",
    incidentId: "inc-hidden-coupling",
    landscapeId: "inherited-messy",
    estimatedMinutes: 120,
    context: {
      situation:
        "You inherit a landscape with incomplete docs, duplicate APIs, unknown ownership, and fragile manual jobs.",
      stakeholders: "Interview reluctant SMEs and an executive sponsor who wants a plan in 30 days.",
      architecture: "Reconstruct architecture, trust boundaries, and phased modernization without big-bang rewrite.",
      implement: "Document inventory and propose first reliability fix.",
      failure: "Nightly batch fails intermittently due to hidden coupling.",
      resolve: "Identify hidden dependency and add monitoring + ownership; propose incremental decoupling.",
      hints: ["Trace dependency edges not just names", "Manual jobs often hide coupling", "Unknown ownership is a risk"],
    },
    defect: {
      id: "defect-coupling",
      description: "Hidden file drop coupling between batch and iflow",
      symptoms: ["intermittent nightly failure", "no owner"],
      rootCause: "Undocumented shared folder contract and race condition",
      distractors: ["VPN banner change"],
    },
  },
  {
    id: "r6-regulated-expansion",
    title: "Regulated Expansion — Multi-Region",
    campaignId: "campaign-g-regulated",
    summary: "Expand to multiple jurisdictions managing identity, privacy, residency, audit, resilience, cost.",
    domainIds: ["architecture", "security", "operations", "hana-cloud"],
    competencyIds: ["arch-regulated", "sec-tenant", "ops-finops", "found-identity"],
    targetLevel: "expert",
    incidentId: "inc-residency-violation",
    landscapeId: "regulated-global",
    estimatedMinutes: 110,
    context: {
      situation:
        "Expand Order Insights to a second region with data residency and retention constraints.",
      stakeholders: "Interview privacy counsel (simulated), platform owner, and regional sales.",
      architecture: "Design residency-aware topology, identity trust, audit, and cost controls.",
      implement: "Place data stores correctly; configure retention flags (simulated).",
      failure: "Audit finds personal data replicated to wrong region.",
      resolve: "Disable non-compliant replica and document residency control.",
      hints: ["Check data flow overlays", "Residency is about data location not only UI language", "Retention schedule matters"],
    },
    defect: {
      id: "defect-residency",
      description: "PII replica enabled in non-approved region",
      symptoms: ["audit finding", "replica flag true"],
      rootCause: "Replication job enabled for analytics without residency review",
      distractors: ["CDN cache in edge locations for static assets only"],
    },
  },
  {
    id: "r-grand-enterprise",
    title: "Grand Enterprise Capstone",
    campaignId: "campaign-grand",
    summary:
      "Cross-domain evolving enterprise: ambiguous requirements, budget, politics, incidents, board, audit.",
    domainIds: [
      "ui5-fiori",
      "cap",
      "integration",
      "events",
      "security",
      "operations",
      "architecture",
      "incident",
      "hana-cloud",
    ],
    competencyIds: [
      "arch-board",
      "sec-jwt-audience",
      "int-iflow",
      "ops-sre",
      "ops-finops",
      "arch-side-by-side",
    ],
    targetLevel: "expert",
    incidentId: "inc-compound-outage",
    landscapeId: "grand-enterprise",
    estimatedMinutes: 150,
    context: {
      situation:
        "Acme Holdings acquired two companies. Budgets tight, board meeting Friday, customer escalation on order outages, audit findings open.",
      stakeholders:
        "Interview conflicting directors; separate politics from requirements; note budget and availability targets.",
      architecture:
        "Propose phased target architecture reconciling CAP/UI5 estate, integration governance, and security debt.",
      implement: "Prioritize first remediation wave with owners and cost notes.",
      failure: "Compound outage: auth failures plus integration backlog plus noisy alerts.",
      resolve: "Restore auth configuration, drain backlog with idempotent reprocessing, silence false alerts with correct SLOs.",
      hints: ["Triage business impact first", "Compound incidents need evidence partitioning", "Do not disable security to restore service"],
    },
    defect: {
      id: "defect-compound",
      description: "Audience mismatch + integration backlog + alert noise",
      symptoms: ["401", "queue depth", "page storms"],
      rootCause: "Uncoordinated change window across identity and integration",
      distractors: ["Office Wi-Fi complaints"],
    },
  },
];

for (const m of missions) {
  w(`missions/${m.id}.json`, {
    id: m.id,
    title: m.title,
    summary: m.summary,
    campaignId: m.campaignId,
    domainIds: m.domainIds,
    competencyIds: m.competencyIds,
    targetLevel: m.targetLevel,
    fidelity: fidelity(),
    estimatedMinutes: m.estimatedMinutes,
    naturalStoppingPoints: [
      "After architecture hypothesis",
      "After landscape inspection",
      "After diagnosis",
      "After architecture defense",
    ],
    steps: loopBase(m.context),
    injectedDefects: [m.defect],
    assessmentRubric: [
      { dimension: "architecture", criteria: "Design quality and rejected alternatives", weight: 0.25 },
      { dimension: "debugging", criteria: "Evidence-aligned root cause", weight: 0.3 },
      { dimension: "operations", criteria: "Remediation without disabling security", weight: 0.25 },
      { dimension: "communication", criteria: "Reflection quality", weight: 0.1 },
      { dimension: "conceptual", criteria: "Requirements separation", weight: 0.1 },
    ],
    sources: [btp],
    version: "0.2.0",
    reviewStatus: "in_review",
    // engine extensions (ignored by strict schema extras? Zod strips unknown by default in safeParse - actually zod object strips unknown keys by default)
    meta: {
      incidentId: m.incidentId,
      landscapeId: m.landscapeId,
    },
  });
}

// Campaign index
w("campaigns/index.json", {
  version: "0.2.0",
  campaigns: [
    {
      id: "campaign-a-startup-to-enterprise",
      title: "Startup to Enterprise",
      missionIds: ["r1-northwind-order-insights"],
    },
    {
      id: "campaign-b-clean-core",
      title: "Clean-Core Transformation",
      missionIds: ["r2-cap-rap-extension-lab"],
    },
    {
      id: "campaign-c-integration-crisis",
      title: "Global Integration Crisis",
      missionIds: ["r3-integration-crisis"],
    },
    {
      id: "campaign-d-data-enterprise",
      title: "Intelligent Data Enterprise",
      missionIds: ["r4-data-galaxy"],
    },
    {
      id: "campaign-e-security-siege",
      title: "Security Siege",
      missionIds: ["r5-security-siege"],
    },
    {
      id: "campaign-f-inherited",
      title: "Inherited Landscape",
      missionIds: ["r6-inherited-landscape"],
    },
    {
      id: "campaign-g-regulated",
      title: "Regulated Expansion",
      missionIds: ["r6-regulated-expansion"],
    },
    {
      id: "campaign-grand",
      title: "Grand Enterprise",
      missionIds: ["r-grand-enterprise"],
    },
  ],
});

// Specializations
w("specializations/index.json", {
  version: "0.2.0",
  specializations: [
    {
      id: "spec-ui5",
      title: "SAPUI5/Fiori Developer",
      competencyIds: ["ui5-mvc", "ui5-odata-bind", "ui5-a11y", "ui5-perf", "found-appdev"],
    },
    {
      id: "spec-cap",
      title: "CAP Developer",
      competencyIds: ["cap-odata-basics", "cap-auth", "cap-events", "cap-multitenant", "found-appdev"],
    },
    {
      id: "spec-rap",
      title: "RAP/ABAP Cloud Developer",
      competencyIds: ["rap-managed", "rap-vs-cap", "rap-clean-core"],
    },
    {
      id: "spec-int",
      title: "Integration Developer",
      competencyIds: ["int-iflow", "int-api-mgmt", "int-hybrid", "evt-mesh"],
    },
    {
      id: "spec-event",
      title: "Event-Driven Architect",
      competencyIds: ["evt-mesh", "evt-saga", "cap-events"],
    },
    {
      id: "spec-bpa",
      title: "Process Automation Specialist",
      competencyIds: ["bpa-workflow", "found-appdev"],
    },
    {
      id: "spec-wz",
      title: "Work Zone Experience Specialist",
      competencyIds: ["wz-sites", "ui5-mvc", "found-identity"],
    },
    {
      id: "spec-hana",
      title: "HANA Cloud Developer",
      competencyIds: ["hana-hdi", "hana-perf", "found-data"],
    },
    {
      id: "spec-data",
      title: "Data Engineer",
      competencyIds: ["ds-semantic", "bdc-products", "hana-hdi", "found-data"],
    },
    {
      id: "spec-analytics",
      title: "Analytics Specialist",
      competencyIds: ["sac-stories", "ds-semantic", "found-data"],
    },
    {
      id: "spec-admin",
      title: "BTP Administrator",
      competencyIds: ["ops-entitlements", "found-ops", "found-landscape", "ops-finops"],
    },
    {
      id: "spec-sec",
      title: "Security Architect",
      competencyIds: ["sec-threat-model", "sec-jwt-audience", "sec-tenant", "found-identity"],
    },
    {
      id: "spec-sa",
      title: "Solution Architect",
      competencyIds: ["arch-side-by-side", "arch-board", "rap-vs-cap", "found-architecture"],
    },
    {
      id: "spec-ea",
      title: "Enterprise Architect",
      competencyIds: ["arch-board", "arch-regulated", "arch-reverse", "ops-finops"],
    },
    {
      id: "spec-sre",
      title: "Platform/SRE",
      competencyIds: ["ops-sre", "ops-incident-basics", "ops-finops", "found-ops"],
    },
    {
      id: "spec-support",
      title: "Technical Support and Incident Specialist",
      competencyIds: ["ops-incident-basics", "found-debug", "sec-jwt-audience", "int-iflow"],
    },
  ],
});

console.log("Curriculum generated:", {
  domains: domains.length,
  competencies: competencies.length,
  missions: missions.length,
});
