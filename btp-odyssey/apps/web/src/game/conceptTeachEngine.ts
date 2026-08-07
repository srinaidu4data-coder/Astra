/**
 * Pedagogical concept animations — graphics that *explain*, not decorate.
 * Maps every concept id/title to a labeled scene + lesson beats.
 */

export type TeachSceneId =
  | "jwt_chain"
  | "authn_authz"
  | "tenant_wall"
  | "destination"
  | "principal_prop"
  | "least_privilege"
  | "threat_model"
  | "zero_trust"
  | "oauth_oidc"
  | "secrets"
  | "cap_service"
  | "rap_bo"
  | "clean_core"
  | "cap_vs_rap"
  | "odata_expand"
  | "odata_meta"
  | "idempotency"
  | "retry_backoff"
  | "dlq"
  | "event_mesh"
  | "saga"
  | "iflow"
  | "mapping"
  | "adapter"
  | "data_product"
  | "lineage"
  | "lakehouse"
  | "semantic"
  | "spaces"
  | "hana_hdi"
  | "calc_view"
  | "vector"
  | "slo"
  | "observability"
  | "rto_rpo"
  | "finops"
  | "accounts"
  | "cf_space"
  | "mta"
  | "binding"
  | "ai_hallucination"
  | "ai_rag"
  | "ai_agent"
  | "ai_prompt"
  | "ai_cost"
  | "ai_eval"
  | "bpa_workflow"
  | "bpa_rules"
  | "fiori_elements"
  | "workzone"
  | "draft"
  | "schema_evolution"
  | "csrf"
  | "shared_resp"
  | "residency"
  | "supply_chain"
  | "accessibility"
  | "generic_teach";

export interface TeachLesson {
  scene: TeachSceneId;
  /** One-line card caption: what the graphic teaches */
  lesson: string;
  /** Cycling explanation beats (detail view) */
  beats: string[];
}

type ConceptLike = {
  id: string;
  title: string;
  domainId?: string;
  summary?: string;
  tags?: string[];
};

function L(scene: TeachSceneId, lesson: string, beats: string[]): TeachLesson {
  return { scene, lesson, beats };
}

/** Exact id → lesson (high-fidelity teach map) */
const BY_ID: Record<string, TeachLesson> = {
  "btp-what": L(
    "accounts",
    "BTP = platform beside systems of record",
    [
      "Not a replacement ERP",
      "Build · integrate · automate · data · AI",
      "S/4 stays system of record",
      "Then learn structure & security",
    ],
  ),
  "btp-platform-structure": L(
    "accounts",
    "Global account → subaccounts → services",
    [
      "Global = commercial root",
      "Subaccount = isolation room",
      "Separate dev/test/prod",
      "Entitlements gate tools",
    ],
  ),
  "btp-services-map": L(
    "cap_vs_rap",
    "Map capability → category → service",
    [
      "App dev · integration · data · AI",
      "Identity cuts across all",
      "Fewer services, clear owners",
      "Don’t pick tools by fashion",
    ],
  ),
  "btp-security-admin": L(
    "authn_authz",
    "Admin duties + identity + least privilege",
    [
      "Split prod admins",
      "Authn ≠ authz",
      "Destinations are security config",
      "Never Admin.All for speed",
    ],
  ),
  "sec-jwt-claims": L(
    "jwt_chain",
    "JWT claims decide accept/reject after login",
    [
      "1 · User authenticates at IdP",
      "2 · Token carries aud, scopes, exp",
      "3 · API validates claims — not just ‘has token’",
      "Wrong aud → 401 even when login succeeded",
    ],
  ),
  "c-jwt-audience": L(
    "jwt_chain",
    "Audience must match the API that accepts the token",
    [
      "Token endpoint 200 ≠ resource accepts JWT",
      "Destination often mints/exchanges for wrong aud",
      "Fix: align audience to CAP/API client id",
      "Never ‘fix’ by disabling auth",
    ],
  ),
  "sec-authn-authz": L(
    "authn_authz",
    "Authn = who you are · Authz = what you may do",
    [
      "Authn: prove identity (login / token)",
      "Authz: scopes/roles on the action",
      "UI hide ≠ server authorize",
      "403 often means identity ok, permission missing",
    ],
  ),
  "c-scope-403": L(
    "least_privilege",
    "403 = authenticated but not authorized",
    [
      "Identity passed · scope/role failed",
      "Map action → required scope",
      "Prefer fine scopes over Admin.All",
      "Log actor + denied scope for IR",
    ],
  ),
  "sec-tenant-isolation": L(
    "tenant_wall",
    "Hard wall: every query filtered by tenant",
    [
      "Tenant A must never see Tenant B rows",
      "UI menus are not walls",
      "Predicate on every data path",
      "Test with B token against A ids",
    ],
  ),
  "c-tenant-isolation": L(
    "tenant_wall",
    "Isolation is a server filter, not a UI choice",
    [
      "Shared API needs tenant context",
      "Missing wall = data breach class",
      "Negative tests prove isolation",
      "DB RLS helps — app still must set tenant",
    ],
  ),
  "sec-destinations": L(
    "destination",
    "Destination = hop that wires auth to the API",
    [
      "UI → Destination → service",
      "Holds URL, auth type, audience",
      "Misconfig → 401 cascade",
      "Treat as security-critical config",
    ],
  ),
  "c-destination": L(
    "destination",
    "Destinations encode how identity reaches the API",
    [
      "Rename client → re-check destination",
      "Propagation vs technical user trade-off",
      "Never share god technical users",
      "Validate with real user journey",
    ],
  ),
  "sec-principal-prop": L(
    "principal_prop",
    "Principal propagation keeps the human as actor",
    [
      "User token → downstream call",
      "Audit: who did the approve?",
      "Tech user loses accountability",
      "Design scopes at each hop",
    ],
  ),
  "c-principal-propagation": L(
    "principal_prop",
    "Propagate user identity, don’t swap a god user",
    ["Identity flows with the call", "Each hop validates scopes", "Audit trail of actor", "Hybrid landscapes need explicit design"],
  ),
  "principal-hybrid": L(
    "principal_prop",
    "Hybrid: on-stack + side-by-side identity design",
    ["Cloud + on-prem hops", "Cloud Connector path", "Same principal rules apply", "Document trust boundaries"],
  ),
  "c-least-privilege": L(
    "least_privilege",
    "Grant only scopes required for the action",
    ["Map action → scope", "Reject Admin.All shortcuts", "Review role collections", "Time-box break-glass"],
  ),
  "sec-xsuaa-roles": L(
    "least_privilege",
    "XSUAA roles/scopes bind users to actions",
    ["Role collection → scopes", "App declares xs-security", "Assign carefully per env", "Test 403 paths"],
  ),
  "c-xsuaa-roles": L(
    "least_privilege",
    "Roles are packages of scopes — design them small",
    ["Avoid mega-roles", "Separate read vs write", "Env parity matters", "Document who gets what"],
  ),
  "sec-oauth-oidc": L(
    "oauth_oidc",
    "OAuth/OIDC: tokens for apps, identity for people",
    ["Auth code / client credentials differ", "OIDC adds id_token identity", "Validate issuer + signature", "Don’t treat opaque tokens as claims"],
  ),
  "sec-ias-ips": L(
    "oauth_oidc",
    "IAS/IPS: identity source and provisioning",
    ["Who authenticates?", "How groups map to roles", "Lifecycle: joiners/leavers", "Sync lag is a risk"],
  ),
  "sec-threat-model": L(
    "threat_model",
    "Name assets, actors, entry points, mitigations",
    ["What are we protecting?", "Who attacks?", "Where can they enter?", "Mitigation per threat"],
  ),
  "c-threat-model": L(
    "threat_model",
    "Threat model before architecture freeze",
    ["STRIDE-style thinking", "Abuse cases for APIs", "Data classification", "Residual risk accepted explicitly"],
  ),
  "sec-zero-trust": L(
    "zero_trust",
    "Never trust network location — verify every call",
    ["Authn every request", "Authz every action", "Least privilege + continuous validation", "Lateral movement is assumed"],
  ),
  "sec-secrets": L(
    "secrets",
    "Secrets live in vaults, not repos or prompts",
    ["Rotate credentials", "No secrets in JWT custom claims abuse", "Scope access to secret stores", "Leak = incident"],
  ),
  "sec-shared-resp": L(
    "shared_resp",
    "Cloud shared responsibility: know your slice",
    ["Provider secures platform", "You secure apps, data, identity config", "Misconfig is usually customer side", "Document ownership"],
  ),
  "c-shared-responsibility": L(
    "shared_resp",
    "Clarify who owns which control",
    ["Network vs app vs data", "Incident contacts", "Config drift ownership", "Audit evidence paths"],
  ),
  "sec-supply-chain": L(
    "supply_chain",
    "Dependencies can be attack surface",
    ["Pin versions", "Scan libraries", "Verify build provenance", "Least install in prod images"],
  ),
  "sec-incident-ir": L(
    "observability",
    "Incident response needs signals + runbooks",
    ["Detect → contain → eradicate → recover", "Preserve evidence", "Comms plan", "Post-incident learning"],
  ),
  "c-residency": L(
    "residency",
    "Data residency: where data may live and process",
    ["Region constraints", "Backups count", "Support access paths", "CDN is not residency control"],
  ),
  "cap-what": L(
    "cap_service",
    "CAP: model services, persist, expose OData/REST",
    ["CDS model", "Service layer", "Handlers for custom logic", "Side-by-side on BTP"],
  ),
  "cap-services": L(
    "cap_service",
    "CAP services expose entities and actions",
    ["Bound/unbound actions", "Auth annotations", "Events optional", "Keep handlers thin"],
  ),
  "cap-cds-entities": L(
    "cap_service",
    "CDS entities are the domain model",
    ["Associations vs compositions", "Aspects for reuse", "Projections for APIs", "Don’t leak raw tables"],
  ),
  "cap-auth": L(
    "least_privilege",
    "CAP auth annotations enforce who can read/write",
    ["@restrict / roles", "Server-side always", "Test negative cases", "Tenant awareness"],
  ),
  "cap-multitenant": L(
    "tenant_wall",
    "Multi-tenant CAP: isolate by tenant context",
    ["Subscriber tenancy", "Tenant-aware persistence", "Onboarding/offboarding", "No cross-tenant joins"],
  ),
  "cap-events": L(
    "event_mesh",
    "CAP can emit/consume events for async projection",
    ["SoR emits", "Consumers idempotent", "Schema evolution", "Avoid dual-write"],
  ),
  "cap-persistence": L(
    "hana_hdi",
    "Persistence: HDI/containers, migrations, privileges",
    ["Schema ownership", "Deploy order", "Least DB privilege", "Perf: indexes & projections"],
  ),
  "cap-resilience": L(
    "retry_backoff",
    "Resilience: timeouts, retries, bulkheads",
    ["Idempotent retries", "Backoff + jitter", "Circuit thoughts", "Fail soft with UX"],
  ),
  "cap-extensibility": L(
    "clean_core",
    "Extend CAP cleanly — versioned APIs, not hacks",
    ["Stable contracts", "Feature toggles", "Side-by-side modules", "Document upgrade impact"],
  ),
  "cap-actions": L(
    "cap_service",
    "Actions/functions for commands beyond CRUD",
    ["Bound to entity vs unbound", "Auth on action", "Side effects explicit", "Return meaningful errors"],
  ),
  "c-cap-odata": L(
    "odata_meta",
    "CAP exposes OData with metadata contracts",
    ["$metadata is the contract", "Clients generate from it", "Breaking changes hurt", "Version deliberately"],
  ),
  "rap-what": L(
    "rap_bo",
    "RAP: ABAP RESTful model for transactional BOs",
    ["Behavior definition", "Draft optional", "EML for logic", "Clean-core friendly"],
  ),
  "rap-cds-bo": L(
    "rap_bo",
    "CDS + behavior define the business object",
    ["Root/child composition", "Determinations/validations", "Actions", "Authorization"],
  ),
  "rap-managed": L(
    "rap_bo",
    "Managed RAP: framework handles much CRUD",
    ["Less boilerplate", "Controlled extensibility", "Know framework limits", "Perf still your job"],
  ),
  "rap-unmanaged": L(
    "rap_bo",
    "Unmanaged: you own more persistence behavior",
    ["Explicit control", "More responsibility", "Use when needed", "Test thoroughly"],
  ),
  "rap-draft": L(
    "draft",
    "Draft: edit without committing until activate",
    ["Exclusive locks", "Discard/activate", "UX for long forms", "Don’t confuse with save"],
  ),
  "c-draft": L(
    "draft",
    "Draft enables multi-step edit safely",
    ["State until activate", "Concurrency", "Cleanup discarded drafts", "Audit final only"],
  ),
  "rap-determinations": L(
    "rap_bo",
    "Determinations/validations encode business rules",
    ["On modify / on save", "Keep pure where possible", "Fail with clear messages", "Avoid side-effect soup"],
  ),
  "rap-eml": L(
    "rap_bo",
    "EML: modify BOs in ABAP with RAP semantics",
    ["MODIFY ENTITIES", "Commit boundaries", "Authorization still applies", "Prefer released APIs"],
  ),
  "rap-extensibility": L(
    "clean_core",
    "Extend RAP via released extension points",
    ["No core mods", "Released APIs", "Upgrade safety", "Document extensions"],
  ),
  "rap-fiori-elements": L(
    "fiori_elements",
    "Fiori elements consume RAP/OData annotations",
    ["List/object pages", "Annotations drive UI", "Consistent UX", "Custom only when needed"],
  ),
  "c-fiori-elements": L(
    "fiori_elements",
    "Annotations → UI floorplans with less code",
    ["Metadata driven", "Faster delivery", "Know floorplan limits", "Accessibility built-in goals"],
  ),
  "rap-clean-core": L(
    "clean_core",
    "Clean core: no modifying SAP standard code",
    ["Released APIs only", "Side-by-side when needed", "Upgrade-safe", "Reject core hacks"],
  ),
  "c-clean-core": L(
    "clean_core",
    "Protect the king (S/4) — extend, don’t mutilate",
    ["Core stays pristine", "Extensions versioned", "Test upgrade path", "Architecture review gate"],
  ),
  "rap-vs-cap": L(
    "cap_vs_rap",
    "RAP near core BO · CAP for side-by-side velocity",
    ["Transactional gravity → RAP", "UX/API fan-out → CAP", "Hybrid when funded", "Team skills matter"],
  ),
  "c-cap-vs-rap": L(
    "cap_vs_rap",
    "Choose by constraint, not fashion",
    ["BO fidelity vs flexibility", "Ops cost of dual runtime", "Clean-core both ways", "Write the trade-off down"],
  ),
  "rap-performance": L(
    "odata_expand",
    "RAP/OData perf: bound $expand and projections",
    ["Avoid deep expands", "$select fields", "Paging", "Measure p95/p99"],
  ),
  "odata-query-perf": L(
    "odata_expand",
    "Unbounded $expand is a p99 black hole",
    ["Depth multiplies payload", "Project fields", "Page results", "Cache carefully"],
  ),
  "odata-v4-basics": L(
    "odata_meta",
    "OData V4: resource model + query options",
    ["Entities/sets", "$filter/$select/$expand", "Metadata contract", "Idempotent GET"],
  ),
  "odata-v2-vs-v4": L(
    "odata_meta",
    "V2 vs V4: prefer V4 for new contracts",
    ["Batch/differences", "Type system", "Tooling", "Migration plan"],
  ),
  "c-odata-metadata": L(
    "odata_meta",
    "$metadata is the public contract",
    ["Clients bind to it", "Breaking = major version", "Deprecate carefully", "Document extensions"],
  ),
  "c-ui5-odata": L(
    "odata_meta",
    "UI5 binds to OData models carefully",
    ["Batch groups", "Busy indicators", "Error handling", "Don’t N+1 from UI"],
  ),
  "cpi-idempotency": L(
    "idempotency",
    "Retries happen — make processing idempotent",
    ["Idempotency key", "At-least-once delivery", "Dedupe side effects", "Partners will retry"],
  ),
  "c-idempotency": L(
    "idempotency",
    "Same message twice → same business result once",
    ["Store processed keys", "Natural keys help", "Outbox patterns", "Test duplicate delivery"],
  ),
  "c-retry-backoff": L(
    "retry_backoff",
    "Retry with backoff + jitter; don’t stampede",
    ["Exponential backoff", "Jitter", "Max attempts", "Then DLQ"],
  ),
  "evt-dlq": L(
    "dlq",
    "DLQ holds poison messages with owners",
    ["Alert on depth", "Replay runbook", "Named owner", "No black holes"],
  ),
  "c-dlq": L(
    "dlq",
    "Dead-letter is an ops product, not a trash bin",
    ["Classify failures", "Fix → replay", "SLO on lag", "Security of payload"],
  ),
  "evt-mesh-concepts": L(
    "event_mesh",
    "Event mesh: SoR emits, many project",
    ["Async decouple", "Schema registry thinking", "Consumers independent", "Avoid dual-write"],
  ),
  "c-events-mesh": L(
    "event_mesh",
    "Events carry facts; consumers build views",
    ["Ordering caveats", "At-least-once", "Idempotent handlers", "Observability per consumer"],
  ),
  "evt-vs-cmd": L(
    "event_mesh",
    "Events = facts · Commands = intent",
    ["Don’t mix styles blindly", "Command has one handler ideally", "Event has many", "Naming discipline"],
  ),
  "evt-saga": L(
    "saga",
    "Saga: multi-step consistency with compensations",
    ["Happy path steps", "Compensating actions", "Timeouts", "Visibility of state"],
  ),
  "c-saga": L(
    "saga",
    "Long business transactions without 2PC theater",
    ["Orchestration vs choreography", "Idempotent steps", "Human approvals as steps", "Failure UX"],
  ),
  "evt-schema": L(
    "schema_evolution",
    "Evolve event schemas without breaking consumers",
    ["Additive changes safer", "Version strategy", "Compatibility tests", "Deprecation window"],
  ),
  "c-schema-evolution": L(
    "schema_evolution",
    "APIs/events: expand/contract carefully",
    ["Additive fields", "Dual-read/write windows", "Consumer matrix", "Kill switches"],
  ),
  "cpi-iflow": L(
    "iflow",
    "iFlow: steps, adapters, error paths",
    ["Happy path", "Exception subprocess", "Logging", "Idempotency at edge"],
  ),
  "c-iflow": L(
    "iflow",
    "Design iFlows as operable products",
    ["Naming", "Error handling", "Secrets", "Version transport"],
  ),
  "cpi-adapters": L(
    "adapter",
    "Adapters connect protocols and systems",
    ["Auth modes", "Timeouts", "Payload sizes", "Retry semantics"],
  ),
  "c-adapter": L(
    "adapter",
    "Adapter choice is a reliability decision",
    ["Protocol fit", "Security", "Ops visibility", "Failure modes"],
  ),
  "cpi-mapping": L(
    "mapping",
    "Mapping transforms contracts between systems",
    ["Canonical model?", "Null handling", "Versioning", "Test vectors"],
  ),
  "cpi-exception": L(
    "dlq",
    "Exception subprocess: classify, log, route",
    ["Transient vs poison", "Alerting", "Replay", "Customer impact"],
  ),
  "is-what": L(
    "iflow",
    "Integration Suite: manage flows, APIs, events",
    ["Governance", "Environments", "Observability", "TPM for B2B"],
  ),
  "is-governance": L(
    "accounts",
    "Govern who can ship which integrations",
    ["Roles", "Transport", "Review gates", "Secret ownership"],
  ),
  "is-observability": L(
    "observability",
    "See message path end-to-end",
    ["Correlation ids", "MPLs/logs", "SLOs", "Alert routing"],
  ),
  "is-tpm": L(
    "adapter",
    "TPM: B2B partner management patterns",
    ["Partner onboarding", "Certificates", "Agreements", "Ops runbooks"],
  ),
  "api-mgmt": L(
    "destination",
    "API management: facade, policy, productize APIs",
    ["Rate limits", "Auth policies", "Versioning", "Developer portal"],
  ),
  "c-api-mgmt": L(
    "destination",
    "Don’t expose raw backends without policy",
    ["Threat model APIs", "Quotas", "Analytics", "Deprecation"],
  ),
  "bdc-what": L(
    "data_product",
    "BDC: data products with ownership & contracts",
    ["Product not dump", "Quality metrics", "Consumers", "Governance"],
  ),
  "bdc-data-product": L(
    "data_product",
    "Data product = interface + SLA + owner",
    ["Discoverable", "Trusted", "Versioned", "Secure"],
  ),
  "c-data-product": L(
    "data_product",
    "Reject ‘give them all tables’",
    ["Define grain", "Freshness", "Access control", "Docs"],
  ),
  "bdc-governance": L(
    "lineage",
    "Govern quality, access, lifecycle of products",
    ["Stewards", "Policies", "Audits", "Deprecation"],
  ),
  "bdc-lakehouse": L(
    "lakehouse",
    "Lakehouse: flexible storage + governed products",
    ["Bronze/silver/gold thinking", "Not all raw is product", "Compute vs storage", "Cost visibility"],
  ),
  "ds-what": L(
    "spaces",
    "Datasphere: spaces, models, sharing",
    ["Space isolation", "Semantic models", "Federation", "Consumers"],
  ),
  "ds-spaces": L(
    "spaces",
    "Spaces separate ownership and data domains",
    ["Access boundaries", "Sharing contracts", "Cost centers", "Lifecycle"],
  ),
  "ds-semantic": L(
    "semantic",
    "Semantic layer: business meaning over tables",
    ["Metrics definitions", "Consistent grain", "Avoid report chaos", "Govern changes"],
  ),
  "ds-lineage": L(
    "lineage",
    "Lineage: where did this number come from?",
    ["Upstream sources", "Transforms", "Impact analysis", "Trust"],
  ),
  "c-lineage": L(
    "lineage",
    "No lineage → no trust in decisions",
    ["Capture at build time", "Expose to consumers", "Breakage alerts", "Ownership"],
  ),
  "ds-federation": L(
    "lakehouse",
    "Federation: query without always copying",
    ["Latency trade-offs", "Security path", "Pushdown", "Cost"],
  ),
  "hana-what": L(
    "hana_hdi",
    "HANA Cloud: in-memory DB platform capabilities",
    ["OLTP/OLAP", "Security", "HA options", "Dev containers"],
  ),
  "hana-hdi": L(
    "hana_hdi",
    "HDI containers isolate DB artifacts",
    ["Deploy design-time", "Privileges", "Bindings", "No shared chaos schemas"],
  ),
  "c-hana-hdi": L(
    "hana_hdi",
    "HDI makes DB deploys repeatable",
    ["Versioned artifacts", "Least privilege", "Env promotion", "Secrets separate"],
  ),
  "hana-calc": L(
    "calc_view",
    "Calculation views: modeled analytics logic",
    ["Push compute to DB", "Avoid UI spaghetti metrics", "Govern definitions", "Perf plan"],
  ),
  "c-calc-view": L(
    "calc_view",
    "Calc views encode reusable analytical logic",
    ["Star/snowflake care", "Join explosion risk", "Authorization", "Test outputs"],
  ),
  "hana-sql": L(
    "calc_view",
    "SQL performance is a product requirement",
    ["Explain plans", "Indexes", "Avoid SELECT *", "Parameter sniffing awareness"],
  ),
  "hana-perf": L(
    "odata_expand",
    "DB perf: measure, bound, cache thoughtfully",
    ["Hot paths", "Partitioning thoughts", "Workload classes", "Observe first"],
  ),
  "hana-privileges": L(
    "least_privilege",
    "DB privileges: least access to objects",
    ["No public grants", "Role design", "Auditing", "Break-glass"],
  ),
  "hana-ha": L(
    "rto_rpo",
    "HA/DR: know RTO/RPO before design",
    ["Failover path", "Data loss tolerance", "Test restores", "Runbooks"],
  ),
  "hana-vector": L(
    "vector",
    "Vectors enable similarity search for RAG etc.",
    ["Embedding quality", "Grounding still required", "PII risk", "Latency/cost"],
  ),
  "c-slo": L(
    "slo",
    "SLO = promise; error budget = room to fail",
    ["User journey metrics", "Burn alerts", "Not vanity CPU", "Tie to decisions"],
  ),
  "ops-sre": L(
    "slo",
    "SRE: reliability as engineering",
    ["SLIs/SLOs", "Toil reduction", "Blameless learning", "Capacity"],
  ),
  "ops-observability": L(
    "observability",
    "Logs + metrics + traces with correlation",
    ["Three pillars", "Cardinality control", "Dashboards for journeys", "On-call usable"],
  ),
  "c-observability": L(
    "observability",
    "If you can’t see it, you can’t operate it",
    ["Correlation ids", "Structured logs", "RED/USE methods", "Privacy in logs"],
  ),
  "c-rto-rpo": L(
    "rto_rpo",
    "RTO = time to recover · RPO = data you may lose",
    ["Business sets numbers", "Design to numbers", "Test failover", "Comms plan"],
  ),
  "ops-finops": L(
    "finops",
    "FinOps: unit economics of cloud runtimes",
    ["Showback/chargeback", "Idle waste", "Right-size", "Budgets with owners"],
  ),
  "c-finops": L(
    "finops",
    "Architecture choices have monthly bills",
    ["Dual runtime cost", "Data egress", "Observability cost", "Trade-off explicitly"],
  ),
  "ops-accounts": L(
    "accounts",
    "Global account → directories → subaccounts",
    ["Env separation", "Entitlements", "Access model", "Landing zone"],
  ),
  "c-global-account": L(
    "accounts",
    "Global account is the commercial root",
    ["Directories structure", "Quota", "Admin roles", "Audit"],
  ),
  "c-subaccount": L(
    "accounts",
    "Subaccount isolates apps and services",
    ["Dev/test/prod", "Members", "Entitlements", "Destinations"],
  ),
  "ops-entitlements": L(
    "accounts",
    "Entitlements/quota gate what you can run",
    ["Plan availability", "Region", "Request process", "Don’t shadow IT"],
  ),
  "c-entitlement": L(
    "accounts",
    "Service plans are product choices",
    ["Fit for workload", "Cost tier", "SLA", "Exit plan"],
  ),
  "c-service-plan": L(
    "accounts",
    "Pick plans by NFR, not default checkbox",
    ["Throughput", "HA", "Support level", "Review yearly"],
  ),
  "ops-cf": L(
    "cf_space",
    "Cloud Foundry org/space for app runtimes",
    ["Spaces as stages", "Roles", "Routes", "Services binding"],
  ),
  "c-cf-space": L(
    "cf_space",
    "Space isolation for teams/stages",
    ["Who can push", "Shared services care", "Egress", "Secrets"],
  ),
  "c-mta": L(
    "mta",
    "MTA deploys multi-module apps together",
    ["Descriptors", "Dependencies", "Extensions per env", "Transport"],
  ),
  "c-binding": L(
    "binding",
    "Service binding injects credentials/config",
    ["No hardcode URLs/secrets", "Rotate with rebind", "Least privilege service keys", "Audit"],
  ),
  "cloud-connector": L(
    "principal_prop",
    "Cloud Connector bridges cloud ↔ on-prem safely",
    ["Allow lists", "Principal propagation options", "Ops ownership", "Don’t expose everything"],
  ),
  "ai-hallucination": L(
    "ai_hallucination",
    "LLMs maximize likelihood, not truth",
    ["Ground with sources", "Cite", "Block uncited actions", "Human in loop for risk"],
  ),
  "ai-rag": L(
    "ai_rag",
    "RAG: retrieve approved knowledge, then generate",
    ["Chunking quality", "Access control on corpus", "Stale docs", "Evaluate answers"],
  ),
  "ai-agent-risks": L(
    "ai_agent",
    "Agents + tools = actuators — constrain hard",
    ["Scope tools", "Confirm high risk", "No secret-in-prompt", "Audit tool calls"],
  ),
  "ai-prompt": L(
    "ai_prompt",
    "Prompts are code: version, test, secure",
    ["Injection risks", "Templates", "Eval sets", "Least data in context"],
  ),
  "ai-cost-latency": L(
    "ai_cost",
    "Model choice is latency × cost × quality",
    ["Route by task", "Cache", "Token budgets", "SLOs for UX"],
  ),
  "ai-eval": L(
    "ai_eval",
    "Eval offline + online before scale",
    ["Golden sets", "Regression", "Human ratings", "Safety cases"],
  ),
  "ai-responsible": L(
    "ai_eval",
    "Responsible AI: fairness, privacy, transparency",
    ["Data minimization", "User disclosure", "Appeal paths", "Monitor drift"],
  ),
  "ai-joule-concepts": L(
    "ai_rag",
    "Joule-style assistants need grounding & policy",
    ["Enterprise knowledge", "Authz", "Action confirmation", "Observability"],
  ),
  "bpa-what": L(
    "bpa_workflow",
    "Build Process Automation: workflows + forms + rules",
    ["Approvals", "Integrations", "Governance", "Not always a full app"],
  ),
  "bpa-workflow": L(
    "bpa_workflow",
    "Workflows model human + system steps",
    ["SLAs", "Escalations", "Audit", "Versioning"],
  ),
  "c-workflow": L(
    "bpa_workflow",
    "Workflow state is a business asset",
    ["Idempotent callbacks", "Visibility", "Failure UX", "Owners"],
  ),
  "bpa-forms": L(
    "bpa_workflow",
    "Forms capture structured human input",
    ["Validation", "Accessibility", "Authz on submit", "PII handling"],
  ),
  "bpa-rules": L(
    "bpa_rules",
    "Rules engines externalize decision logic",
    ["Version rules", "Test tables", "Audit decisions", "Avoid hidden logic"],
  ),
  "bpa-api": L(
    "cap_service",
    "BPA APIs need auth and rate control",
    ["Scopes", "Idempotency", "Observability", "Contracts"],
  ),
  "bpa-governance": L(
    "accounts",
    "Citizen automation still needs governance",
    ["Who can publish", "Data access", "Review", "Kill switches"],
  ),
  "bpa-scale": L(
    "slo",
    "Scale workflows: concurrency, quotas, design",
    ["Hot paths", "Fan-out limits", "Backpressure", "Cost"],
  ),
  "wz-what": L(
    "workzone",
    "Work Zone: entry experience & content",
    ["Roles", "Federation", "Perf budgets", "Governance"],
  ),
  "wz-roles": L(
    "least_privilege",
    "Work Zone roles control what people see/do",
    ["Map to job functions", "Review regularly", "Least content exposure", "Test personas"],
  ),
  "wz-federation": L(
    "workzone",
    "Federate content/apps carefully",
    ["Trust", "Latency", "Auth", "Fallback UX"],
  ),
  "wz-perf": L(
    "odata_expand",
    "Work Zone perf is UX SLO",
    ["Bundle size thinking", "Lazy load", "CDN", "Measure real users"],
  ),
  "c-workzone": L(
    "workzone",
    "Portal is not optional security surface",
    ["Auth integration", "Content gov", "Monitoring", "Accessibility"],
  ),
  "c-csrf": L(
    "csrf",
    "CSRF: browser tricks user into unwanted action",
    ["Tokens on state-changing calls", "SameSite thoughts", "Never GET for writes", "Framework defaults"],
  ),
  "c-audit-log": L(
    "observability",
    "Audit: who did what, when, on which resource",
    ["Immutable where needed", "Actor identity", "Retention", "Access to audits"],
  ),
  "c-change-mgmt": L(
    "mta",
    "Change management protects production",
    ["Environments", "Approvals", "Rollback", "Evidence"],
  ),
  "c-functional-nfr": L(
    "slo",
    "NFRs are requirements, not afterthoughts",
    ["Perf, security, ops", "Test them", "Budget trade-offs", "Accept residual risk"],
  ),
  "c-accessibility": L(
    "accessibility",
    "Accessibility is product quality + law risk",
    ["Keyboard", "Contrast", "Labels", "Test with tools + people"],
  ),
  "c-behavior-def": L(
    "rap_bo",
    "Behavior definition: RAP operations & rules",
    ["CRUD + actions", "Draft", "Auth", "Validations"],
  ),
  "sac-what": L(
    "semantic",
    "SAC: stories, planning, analytics consumption",
    ["Live vs import", "Security", "Models", "Govern metrics"],
  ),
  "sac-stories": L(
    "semantic",
    "Stories communicate decisions — not just charts",
    ["Audience", "Grain", "Filters", "Export risks"],
  ),
  "c-sac-story": L(
    "semantic",
    "Story design is information design",
    ["Avoid chart junk", "Consistent definitions", "Mobile", "Access control"],
  ),
  "sac-live-vs-import": L(
    "lakehouse",
    "Live = current · Import = snapshot trade-off",
    ["Latency", "Load", "Offline needs", "Security path"],
  ),
  "sac-planning": L(
    "semantic",
    "Planning cycles need write-back governance",
    ["Versions", "Locks", "Audit", "Process owners"],
  ),
  "sac-security": L(
    "least_privilege",
    "SAC security: model + folder + row constraints",
    ["Least data", "Role design", "Export control", "Test personas"],
  ),
};

/** Ordered keyword rules (first match wins) — covers remaining ids */
const RULES: { re: RegExp; lesson: TeachLesson }[] = [
  { re: /btp-what|what is sap btp|business technology platform/, lesson: BY_ID["btp-what"]! },
  { re: /btp-platform|global account|subaccount|landing zone/, lesson: BY_ID["btp-platform-structure"]! },
  { re: /btp-services|services map/, lesson: BY_ID["btp-services-map"]! },
  { re: /btp-security-admin|security & admin/, lesson: BY_ID["btp-security-admin"]! },
  { re: /jwt|audience|claim|token/, lesson: BY_ID["sec-jwt-claims"]! },
  { re: /authn|authz|oauth|oidc|ias|ips/, lesson: BY_ID["sec-authn-authz"]! },
  { re: /tenant|multitenant|isolation/, lesson: BY_ID["sec-tenant-isolation"]! },
  { re: /destination/, lesson: BY_ID["sec-destinations"]! },
  { re: /principal|propagat|cloud.?connector/, lesson: BY_ID["sec-principal-prop"]! },
  { re: /least.?priv|scope|xsuaa|role|403/, lesson: BY_ID["c-least-privilege"]! },
  { re: /threat|zero.?trust|csrf|secret|supply/, lesson: BY_ID["sec-threat-model"]! },
  { re: /clean.?core/, lesson: BY_ID["c-clean-core"]! },
  { re: /rap.?vs.?cap|cap.?vs.?rap/, lesson: BY_ID["rap-vs-cap"]! },
  { re: /\brap\b|behavior|eml|draft/, lesson: BY_ID["rap-what"]! },
  { re: /\bcap\b|cds/, lesson: BY_ID["cap-what"]! },
  { re: /odata|expand|query.?perf|metadata/, lesson: BY_ID["odata-query-perf"]! },
  { re: /idempot/, lesson: BY_ID["cpi-idempotency"]! },
  { re: /retry|backoff/, lesson: BY_ID["c-retry-backoff"]! },
  { re: /dlq|dead.?letter|exception/, lesson: BY_ID["evt-dlq"]! },
  { re: /event|mesh|async/, lesson: BY_ID["evt-mesh-concepts"]! },
  { re: /saga/, lesson: BY_ID["evt-saga"]! },
  { re: /iflow|cpi|integration.?suite|\bis\b|tpm/, lesson: BY_ID["cpi-iflow"]! },
  { re: /adapter|mapping/, lesson: BY_ID["cpi-adapters"]! },
  { re: /data.?product|bdc|lakehouse/, lesson: BY_ID["bdc-data-product"]! },
  { re: /lineage/, lesson: BY_ID["ds-lineage"]! },
  { re: /semantic|datasphere|ds-|sac|story|planning/, lesson: BY_ID["ds-semantic"]! },
  { re: /space|federation/, lesson: BY_ID["ds-spaces"]! },
  { re: /hana|hdi|calc|vector|sql/, lesson: BY_ID["hana-hdi"]! },
  { re: /slo|sre|observ|audit.?log|incident/, lesson: BY_ID["c-slo"]! },
  { re: /rto|rpo|ha\b/, lesson: BY_ID["c-rto-rpo"]! },
  { re: /finops|cost|latency| entile|entitlement|plan/, lesson: BY_ID["ops-finops"]! },
  { re: /account|subaccount|global|entitlement|cf|space|mta|binding/, lesson: BY_ID["ops-accounts"]! },
  { re: /hallucin|rag|agent|prompt|joule|ai-|responsible|eval/, lesson: BY_ID["ai-hallucination"]! },
  { re: /bpa|workflow|rules|forms/, lesson: BY_ID["bpa-what"]! },
  { re: /fiori|workzone|wz-/, lesson: BY_ID["rap-fiori-elements"]! },
  { re: /schema|evolution/, lesson: BY_ID["c-schema-evolution"]! },
  { re: /residency/, lesson: BY_ID["c-residency"]! },
  { re: /accessib/, lesson: BY_ID["c-accessibility"]! },
  { re: /api.?mgmt|management/, lesson: BY_ID["api-mgmt"]! },
  { re: /shared.?resp/, lesson: BY_ID["sec-shared-resp"]! },
  { re: /change.?mgmt|nfr/, lesson: BY_ID["c-change-mgmt"]! },
];

export function resolveTeachLesson(c: ConceptLike): TeachLesson {
  if (BY_ID[c.id]) return BY_ID[c.id]!;
  const blob = `${c.id} ${c.title} ${c.summary ?? ""} ${(c.tags ?? []).join(" ")} ${c.domainId ?? ""}`.toLowerCase();
  for (const r of RULES) {
    if (r.re.test(blob)) return r.lesson;
  }
  // Domain fallbacks with personalized lesson from title
  const d = (c.domainId ?? "").toLowerCase();
  if (d.includes("sec"))
    return L("threat_model", `Security concept: ${c.title}`, [
      "Identify asset & threat",
      "Control that mitigates it",
      "How to verify the control",
      c.summary || "Apply least privilege",
    ]);
  if (d.includes("ai"))
    return L("ai_hallucination", `AI concept: ${c.title}`, [
      "Models are probabilistic",
      "Ground & constrain actions",
      "Evaluate before scale",
      c.summary || "Human oversight for risk",
    ]);
  if (d.includes("data") || d.includes("hana") || d.includes("bdc"))
    return L("data_product", `Data concept: ${c.title}`, [
      "Define product contract",
      "Quality & ownership",
      "Secure consumers",
      c.summary || "No raw dumps",
    ]);
  if (d.includes("int") || d.includes("cpi") || d.includes("event"))
    return L("event_mesh", `Integration concept: ${c.title}`, [
      "Delivery semantics",
      "Idempotency",
      "Failure/DLQ path",
      c.summary || "Operate the flow",
    ]);
  return L("generic_teach", c.summary || c.title, [
    `Concept: ${c.title}`,
    c.summary || "Open the card for full teach text",
    "Ask: what fails if we ignore this?",
    "Apply on next design decision",
  ]);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function nodeBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  fill: string,
  stroke: string,
  active = false,
) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = active ? 2.2 : 1.4;
  roundedRect(ctx, x - w / 2, y - h / 2, w, h, 8);
  ctx.fill();
  ctx.stroke();
  if (active) {
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = "#e8eef9";
  ctx.font = "600 10px Outfit, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y, w - 8);
}

function arrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  label?: string,
  pulse = 0,
) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  const mx = x1 + (x2 - x1) * (0.15 + pulse * 0.7);
  const my = y1 + (y2 - y1) * (0.15 + pulse * 0.7);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 7 * Math.cos(ang - 0.4), y2 - 7 * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - 7 * Math.cos(ang + 0.4), y2 - 7 * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
  // packet
  ctx.beginPath();
  ctx.arc(mx, my, 3, 0, Math.PI * 2);
  ctx.fill();
  if (label) {
    ctx.font = "500 9px Outfit, system-ui, sans-serif";
    ctx.fillStyle = "#93a4c3";
    ctx.textAlign = "center";
    ctx.fillText(label, (x1 + x2) / 2, (y1 + y2) / 2 - 8);
  }
}

function caption(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundedRect(ctx, 6, h - 22, w - 12, 16, 6);
  ctx.fill();
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "600 9px Outfit, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h - 14, w - 20);
}

/** Draw pedagogical scene that explains the concept */
export function drawTeachScene(
  ctx: CanvasRenderingContext2D,
  scene: TeachSceneId,
  w: number,
  h: number,
  t: number,
  energy: number,
  accent: string,
  accent2: string,
  beatText: string,
) {
  const e = Math.max(0.2, Math.min(1, energy));
  const pulse = (Math.sin(t * 2.2 * e) * 0.5 + 0.5) * e;
  const phase = Math.floor(t * 0.55) % 4;

  // soft stage
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  roundedRect(ctx, 4, 4, w - 8, h - 28, 10);
  ctx.fill();

  switch (scene) {
    case "jwt_chain": {
      const y = h * 0.42;
      nodeBox(ctx, w * 0.14, y, 52, 28, "User", accent2 + "33", accent2, phase === 0);
      nodeBox(ctx, w * 0.38, y, 52, 28, "IdP", accent + "33", accent, phase === 1);
      nodeBox(ctx, w * 0.62, y, 56, 28, "Dest", accent2 + "33", accent2, phase === 2);
      nodeBox(ctx, w * 0.86, y, 52, 28, "API", accent + "33", accent, phase === 3);
      arrow(ctx, w * 0.2, y, w * 0.3, y, accent2, "login", pulse);
      arrow(ctx, w * 0.44, y, w * 0.54, y, accent, "JWT", pulse);
      arrow(ctx, w * 0.68, y, w * 0.78, y, accent2, "aud?", pulse);
      if (phase === 3) {
        ctx.fillStyle = "#fb7185";
        ctx.font = "700 10px Outfit, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(pulse > 0.5 ? "401 if aud wrong" : "200 if aud ok", w * 0.86, y + 28);
      }
      break;
    }
    case "authn_authz": {
      nodeBox(ctx, w * 0.28, h * 0.38, 70, 34, "Authn", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.72, h * 0.38, 70, 34, "Authz", accent2 + "33", accent2, phase >= 2);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Who are you?", w * 0.28, h * 0.55);
      ctx.fillText("What may you do?", w * 0.72, h * 0.55);
      arrow(ctx, w * 0.4, h * 0.38, w * 0.6, h * 0.38, "#64748b", "then", pulse);
      break;
    }
    case "tenant_wall": {
      nodeBox(ctx, w * 0.22, h * 0.4, 58, 32, "Tenant A", accent + "33", accent, true);
      nodeBox(ctx, w * 0.78, h * 0.4, 58, 32, "Tenant B", accent2 + "33", accent2, true);
      // wall
      ctx.fillStyle = phase % 2 === 0 ? "#fb7185" : accent;
      ctx.fillRect(w * 0.48, h * 0.22, 6, h * 0.4);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "700 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("FILTER", w * 0.5, h * 0.2);
      // blocked arrow
      ctx.strokeStyle = "#fb7185";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(w * 0.32, h * 0.4);
      ctx.lineTo(w * 0.46, h * 0.4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fb7185";
      ctx.fillText("✕", w * 0.42, h * 0.4 - 10);
      break;
    }
    case "destination": {
      nodeBox(ctx, w * 0.18, h * 0.42, 48, 28, "UI", accent2 + "33", accent2, phase === 0);
      nodeBox(ctx, w * 0.5, h * 0.42, 64, 32, "Destination", accent + "44", accent, true);
      nodeBox(ctx, w * 0.82, h * 0.42, 48, 28, "API", accent2 + "33", accent2, phase === 3);
      arrow(ctx, w * 0.26, h * 0.42, w * 0.4, h * 0.42, accent2, "", pulse);
      arrow(ctx, w * 0.6, h * 0.42, w * 0.74, h * 0.42, accent, "auth", pulse);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("URL · auth · audience", w * 0.5, h * 0.62);
      break;
    }
    case "principal_prop": {
      nodeBox(ctx, w * 0.15, h * 0.4, 40, 26, "User", accent + "33", accent, true);
      nodeBox(ctx, w * 0.4, h * 0.4, 44, 26, "App", accent2 + "33", accent2, phase >= 1);
      nodeBox(ctx, w * 0.65, h * 0.4, 44, 26, "API", accent + "33", accent, phase >= 2);
      nodeBox(ctx, w * 0.88, h * 0.4, 40, 26, "Core", accent2 + "33", accent2, phase >= 3);
      arrow(ctx, w * 0.2, h * 0.4, w * 0.34, h * 0.4, accent, "id", pulse);
      arrow(ctx, w * 0.46, h * 0.4, w * 0.58, h * 0.4, accent, "id", pulse);
      arrow(ctx, w * 0.71, h * 0.4, w * 0.82, h * 0.4, accent, "id", pulse);
      ctx.fillStyle = "#34d399";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("same principal · audit actor", w / 2, h * 0.62);
      break;
    }
    case "least_privilege": {
      const scopes = ["Read", "Approve", "Admin.All"];
      scopes.forEach((s, i) => {
        const bad = i === 2;
        const x = w * (0.22 + i * 0.28);
        nodeBox(
          ctx,
          x,
          h * 0.4,
          62,
          30,
          s,
          bad ? "#fb718533" : accent + "33",
          bad ? "#fb7185" : accent,
          !bad && phase === i,
        );
        if (bad) {
          ctx.fillStyle = "#fb7185";
          ctx.font = "700 11px Outfit, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("REJECT", x, h * 0.58);
        }
      });
      break;
    }
    case "threat_model": {
      const labels = ["Assets", "Actors", "Entry", "Mitigate"];
      labels.forEach((lb, i) => {
        const x = w * (0.18 + i * 0.22);
        nodeBox(ctx, x, h * 0.4, 54, 28, lb, accent + "33", i === phase ? accent2 : accent, i === phase);
        if (i < 3) arrow(ctx, x + 28, h * 0.4, x + w * 0.22 - 28, h * 0.4, "#64748b", "", pulse);
      });
      break;
    }
    case "zero_trust": {
      nodeBox(ctx, w * 0.5, h * 0.35, 70, 30, "Every call", accent + "33", accent, true);
      for (let i = 0; i < 5; i++) {
        const a = t * 0.8 + (i / 5) * Math.PI * 2;
        const x = w * 0.5 + Math.cos(a) * w * 0.28;
        const y = h * 0.45 + Math.sin(a) * h * 0.18;
        ctx.strokeStyle = accent2;
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.35);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = accent2;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("verify · never assume network", w / 2, h * 0.68);
      break;
    }
    case "oauth_oidc": {
      nodeBox(ctx, w * 0.2, h * 0.4, 50, 28, "Client", accent2 + "33", accent2, phase === 0);
      nodeBox(ctx, w * 0.5, h * 0.4, 56, 28, "IdP", accent + "33", accent, phase === 1);
      nodeBox(ctx, w * 0.8, h * 0.4, 50, 28, "API", accent2 + "33", accent2, phase >= 2);
      arrow(ctx, w * 0.28, h * 0.4, w * 0.42, h * 0.4, accent, "code", pulse);
      arrow(ctx, w * 0.58, h * 0.4, w * 0.72, h * 0.4, accent2, "token", pulse);
      break;
    }
    case "secrets": {
      nodeBox(ctx, w * 0.3, h * 0.4, 64, 32, "Vault", accent + "33", accent, true);
      nodeBox(ctx, w * 0.7, h * 0.28, 58, 26, "App", accent2 + "33", accent2, phase >= 1);
      nodeBox(ctx, w * 0.7, h * 0.55, 58, 26, "Repo ✕", "#fb718533", "#fb7185", false);
      arrow(ctx, w * 0.4, h * 0.4, w * 0.6, h * 0.28, accent, "inject", pulse);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#fb7185";
      ctx.beginPath();
      ctx.moveTo(w * 0.4, h * 0.42);
      ctx.lineTo(w * 0.6, h * 0.55);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "cap_service": {
      nodeBox(ctx, w * 0.22, h * 0.4, 54, 28, "CDS", accent + "33", accent, phase === 0);
      nodeBox(ctx, w * 0.5, h * 0.4, 60, 30, "Service", accent2 + "33", accent2, phase === 1 || phase === 2);
      nodeBox(ctx, w * 0.78, h * 0.4, 54, 28, "OData", accent + "33", accent, phase === 3);
      arrow(ctx, w * 0.3, h * 0.4, w * 0.42, h * 0.4, accent, "model", pulse);
      arrow(ctx, w * 0.58, h * 0.4, w * 0.7, h * 0.4, accent2, "expose", pulse);
      break;
    }
    case "rap_bo": {
      nodeBox(ctx, w * 0.5, h * 0.28, 70, 28, "Root BO", accent + "33", accent, true);
      nodeBox(ctx, w * 0.3, h * 0.55, 54, 24, "Child", accent2 + "33", accent2, phase >= 1);
      nodeBox(ctx, w * 0.7, h * 0.55, 54, 24, "Action", accent2 + "33", accent2, phase >= 2);
      arrow(ctx, w * 0.45, h * 0.34, w * 0.35, h * 0.48, accent, "", pulse);
      arrow(ctx, w * 0.55, h * 0.34, w * 0.65, h * 0.48, accent, "", pulse);
      break;
    }
    case "clean_core": {
      nodeBox(ctx, w * 0.5, h * 0.42, 72, 36, "S/4 Core", accent + "33", accent, true);
      nodeBox(ctx, w * 0.22, h * 0.42, 56, 28, "RAP ✓", "#34d39933", "#34d399", phase % 2 === 0);
      nodeBox(ctx, w * 0.78, h * 0.42, 56, 28, "Mod ✕", "#fb718533", "#fb7185", phase % 2 === 1);
      arrow(ctx, w * 0.32, h * 0.42, w * 0.4, h * 0.42, "#34d399", "extend", pulse);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#fb7185";
      ctx.beginPath();
      ctx.moveTo(w * 0.68, h * 0.42);
      ctx.lineTo(w * 0.6, h * 0.42);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "cap_vs_rap": {
      nodeBox(ctx, w * 0.28, h * 0.4, 70, 34, "RAP", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.72, h * 0.4, 70, 34, "CAP", accent2 + "33", accent2, phase >= 2);
      nodeBox(ctx, w * 0.5, h * 0.68, 64, 22, "S/4", "#64748b55", "#94a3b8", false);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("near BO", w * 0.28, h * 0.58);
      ctx.fillText("side-by-side", w * 0.72, h * 0.58);
      break;
    }
    case "odata_expand": {
      const cx = w * 0.35;
      const cy = h * 0.4;
      nodeBox(ctx, cx, cy, 40, 24, "Root", accent + "33", accent, true);
      const n = 2 + (phase % 3);
      for (let i = 0; i < n; i++) {
        const a = -0.8 + i * 0.8;
        const x = cx + Math.cos(a) * w * 0.28;
        const y = cy + Math.sin(a) * h * 0.22 + 10;
        arrow(ctx, cx + 20, cy, x - 16, y, accent2, "$expand", pulse);
        nodeBox(ctx, x, y, 36, 20, `N${i + 1}`, accent2 + "33", accent2, false);
      }
      ctx.fillStyle = "#fb7185";
      ctx.font = "700 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("payload × depth → p99↑", w * 0.7, h * 0.7);
      break;
    }
    case "odata_meta": {
      nodeBox(ctx, w * 0.35, h * 0.4, 70, 32, "$metadata", accent + "33", accent, true);
      nodeBox(ctx, w * 0.72, h * 0.4, 54, 28, "Client", accent2 + "33", accent2, phase >= 2);
      arrow(ctx, w * 0.48, h * 0.4, w * 0.62, h * 0.4, accent, "contract", pulse);
      break;
    }
    case "idempotency": {
      for (let i = 0; i < 3; i++) {
        const y = h * 0.28 + i * 14;
        arrow(ctx, w * 0.12, y, w * 0.4, h * 0.45, accent2, i === phase ? "retry" : "", pulse);
      }
      nodeBox(ctx, w * 0.55, h * 0.45, 70, 30, "Handler", accent + "33", accent, true);
      nodeBox(ctx, w * 0.85, h * 0.45, 50, 28, "1 result", "#34d39933", "#34d399", true);
      arrow(ctx, w * 0.68, h * 0.45, w * 0.76, h * 0.45, "#34d399", "once", pulse);
      break;
    }
    case "retry_backoff": {
      for (let i = 0; i < 4; i++) {
        const x = w * (0.15 + i * 0.2);
        const bar = 10 + i * 12 + pulse * 6;
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.5 + i * 0.1;
        ctx.fillRect(x - 8, h * 0.65 - bar, 16, bar);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#93a4c3";
        ctx.font = "500 8px Outfit, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`t${i}`, x, h * 0.72);
      }
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("backoff + jitter", w / 2, h * 0.28);
      break;
    }
    case "dlq": {
      nodeBox(ctx, w * 0.25, h * 0.4, 54, 28, "iFlow", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.55, h * 0.4, 50, 28, "API", accent2 + "33", accent2, false);
      nodeBox(ctx, w * 0.8, h * 0.4, 50, 28, "DLQ", "#fb718533", "#fb7185", phase >= 2);
      arrow(ctx, w * 0.34, h * 0.4, w * 0.46, h * 0.4, accent, "ok", pulse);
      arrow(ctx, w * 0.34, h * 0.45, w * 0.72, h * 0.45, "#fb7185", "poison", pulse);
      break;
    }
    case "event_mesh": {
      nodeBox(ctx, w * 0.18, h * 0.4, 48, 28, "SoR", accent + "33", accent, phase === 0);
      nodeBox(ctx, w * 0.45, h * 0.4, 54, 30, "Bus", accent2 + "33", accent2, true);
      nodeBox(ctx, w * 0.75, h * 0.28, 48, 24, "CAP", accent + "33", accent, phase >= 2);
      nodeBox(ctx, w * 0.75, h * 0.55, 48, 24, "BI", accent + "33", accent, phase >= 3);
      arrow(ctx, w * 0.26, h * 0.4, w * 0.38, h * 0.4, accent, "event", pulse);
      arrow(ctx, w * 0.52, h * 0.36, w * 0.66, h * 0.28, accent2, "", pulse);
      arrow(ctx, w * 0.52, h * 0.44, w * 0.66, h * 0.55, accent2, "", pulse);
      break;
    }
    case "saga": {
      for (let i = 0; i < 4; i++) {
        const x = w * (0.15 + i * 0.22);
        nodeBox(ctx, x, h * 0.35, 44, 24, `S${i + 1}`, accent + "33", accent, phase === i);
        if (i < 3) arrow(ctx, x + 22, h * 0.35, x + w * 0.22 - 22, h * 0.35, accent2, "", pulse);
      }
      ctx.strokeStyle = "#fb7185";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(w * 0.8, h * 0.42);
      ctx.lineTo(w * 0.2, h * 0.58);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fb7185";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("compensate on fail", w / 2, h * 0.68);
      break;
    }
    case "iflow": {
      const steps = ["Start", "Map", "Call", "End"];
      steps.forEach((s, i) => {
        const x = w * (0.15 + i * 0.22);
        nodeBox(ctx, x, h * 0.4, 44, 26, s, accent + "33", accent, phase === i);
        if (i < 3) arrow(ctx, x + 22, h * 0.4, x + w * 0.22 - 22, h * 0.4, accent2, "", pulse);
      });
      break;
    }
    case "mapping": {
      nodeBox(ctx, w * 0.22, h * 0.4, 54, 30, "Src", accent2 + "33", accent2, phase < 2);
      nodeBox(ctx, w * 0.5, h * 0.4, 50, 28, "Map", accent + "33", accent, true);
      nodeBox(ctx, w * 0.78, h * 0.4, 54, 30, "Tgt", accent2 + "33", accent2, phase >= 2);
      arrow(ctx, w * 0.3, h * 0.4, w * 0.42, h * 0.4, accent2, "A", pulse);
      arrow(ctx, w * 0.58, h * 0.4, w * 0.7, h * 0.4, accent, "A′", pulse);
      break;
    }
    case "adapter": {
      nodeBox(ctx, w * 0.22, h * 0.4, 50, 28, "Sys A", accent2 + "33", accent2, false);
      nodeBox(ctx, w * 0.5, h * 0.4, 64, 32, "Adapter", accent + "33", accent, true);
      nodeBox(ctx, w * 0.78, h * 0.4, 50, 28, "Sys B", accent2 + "33", accent2, false);
      arrow(ctx, w * 0.3, h * 0.4, w * 0.4, h * 0.4, accent2, "proto", pulse);
      arrow(ctx, w * 0.6, h * 0.4, w * 0.7, h * 0.4, accent, "proto", pulse);
      break;
    }
    case "data_product": {
      nodeBox(ctx, w * 0.2, h * 0.45, 48, 26, "Raw", "#64748b55", "#94a3b8", false);
      nodeBox(ctx, w * 0.45, h * 0.45, 54, 28, "Curate", accent2 + "33", accent2, phase >= 1);
      nodeBox(ctx, w * 0.72, h * 0.45, 64, 32, "Product", accent + "33", accent, true);
      arrow(ctx, w * 0.28, h * 0.45, w * 0.38, h * 0.45, "#94a3b8", "", pulse);
      arrow(ctx, w * 0.54, h * 0.45, w * 0.62, h * 0.45, accent2, "SLA", pulse);
      ctx.fillStyle = "#34d399";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("owner · contract · quality", w * 0.72, h * 0.65);
      break;
    }
    case "lineage": {
      for (let i = 0; i < 4; i++) {
        const x = w * (0.15 + i * 0.22);
        nodeBox(ctx, x, h * 0.4, 40, 24, `T${i}`, accent + "33", accent, phase === i);
        if (i < 3) arrow(ctx, x + 20, h * 0.4, x + w * 0.22 - 20, h * 0.4, accent2, "", pulse);
      }
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("where did this number come from?", w / 2, h * 0.62);
      break;
    }
    case "lakehouse": {
      ["Bronze", "Silver", "Gold"].forEach((lb, i) => {
        nodeBox(
          ctx,
          w * (0.22 + i * 0.28),
          h * 0.42,
          58,
          30,
          lb,
          accent + "33",
          accent,
          phase === i,
        );
      });
      break;
    }
    case "semantic": {
      nodeBox(ctx, w * 0.5, h * 0.32, 80, 28, "Metric: Revenue", accent + "33", accent, true);
      nodeBox(ctx, w * 0.25, h * 0.58, 50, 22, "Table", accent2 + "33", accent2, false);
      nodeBox(ctx, w * 0.5, h * 0.58, 50, 22, "Table", accent2 + "33", accent2, false);
      nodeBox(ctx, w * 0.75, h * 0.58, 50, 22, "Table", accent2 + "33", accent2, false);
      arrow(ctx, w * 0.5, h * 0.4, w * 0.25, h * 0.52, accent, "", pulse);
      arrow(ctx, w * 0.5, h * 0.4, w * 0.5, h * 0.52, accent, "", pulse);
      arrow(ctx, w * 0.5, h * 0.4, w * 0.75, h * 0.52, accent, "", pulse);
      break;
    }
    case "spaces": {
      nodeBox(ctx, w * 0.28, h * 0.4, 70, 40, "Space A", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.72, h * 0.4, 70, 40, "Space B", accent2 + "33", accent2, phase >= 2);
      ctx.strokeStyle = "#94a3b8";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(w * 0.12, h * 0.22, w * 0.32, h * 0.4);
      ctx.strokeRect(w * 0.56, h * 0.22, w * 0.32, h * 0.4);
      ctx.setLineDash([]);
      break;
    }
    case "hana_hdi": {
      nodeBox(ctx, w * 0.5, h * 0.4, 90, 40, "HDI container", accent + "33", accent, true);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("deploy artifacts · privileges · bind", w / 2, h * 0.62);
      break;
    }
    case "calc_view": {
      nodeBox(ctx, w * 0.5, h * 0.3, 70, 26, "Calc view", accent + "33", accent, true);
      nodeBox(ctx, w * 0.25, h * 0.55, 44, 22, "Fact", accent2 + "33", accent2, false);
      nodeBox(ctx, w * 0.5, h * 0.55, 44, 22, "Dim", accent2 + "33", accent2, false);
      nodeBox(ctx, w * 0.75, h * 0.55, 44, 22, "Dim", accent2 + "33", accent2, false);
      arrow(ctx, w * 0.5, h * 0.36, w * 0.25, h * 0.5, accent, "", pulse);
      arrow(ctx, w * 0.5, h * 0.36, w * 0.5, h * 0.5, accent, "", pulse);
      arrow(ctx, w * 0.5, h * 0.36, w * 0.75, h * 0.5, accent, "", pulse);
      break;
    }
    case "vector": {
      for (let i = 0; i < 8; i++) {
        const x = w * 0.2 + i * 10;
        const bar = 8 + Math.abs(Math.sin(t + i)) * 28 * e;
        ctx.fillStyle = accent;
        ctx.fillRect(x, h * 0.55 - bar, 6, bar);
      }
      nodeBox(ctx, w * 0.75, h * 0.4, 60, 28, "Query", accent2 + "33", accent2, true);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("embedding space", w * 0.35, h * 0.7);
      break;
    }
    case "slo": {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w * 0.35, h * 0.42, 28, -Math.PI * 0.8, -Math.PI * 0.8 + pulse * Math.PI * 1.4);
      ctx.stroke();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "700 12px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SLO", w * 0.35, h * 0.42);
      nodeBox(ctx, w * 0.7, h * 0.35, 70, 24, "Error budget", accent2 + "33", accent2, phase >= 2);
      nodeBox(ctx, w * 0.7, h * 0.55, 70, 24, "Burn alert", "#fb718533", "#fb7185", phase >= 3);
      break;
    }
    case "observability": {
      ["Logs", "Metrics", "Traces"].forEach((lb, i) => {
        nodeBox(ctx, w * (0.22 + i * 0.28), h * 0.38, 58, 28, lb, accent + "33", accent, phase === i);
      });
      nodeBox(ctx, w * 0.5, h * 0.62, 80, 22, "correlation id", accent2 + "33", accent2, true);
      break;
    }
    case "rto_rpo": {
      nodeBox(ctx, w * 0.3, h * 0.4, 70, 32, "RTO", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.7, h * 0.4, 70, 32, "RPO", accent2 + "33", accent2, phase >= 2);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("time to recover", w * 0.3, h * 0.58);
      ctx.fillText("data loss window", w * 0.7, h * 0.58);
      break;
    }
    case "finops": {
      for (let i = 0; i < 5; i++) {
        const hgt = 12 + (i + 1) * 8 + (i === phase ? 6 : 0);
        ctx.fillStyle = i === 4 ? "#fb7185" : accent;
        ctx.fillRect(w * 0.15 + i * 28, h * 0.6 - hgt, 18, hgt);
      }
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("cost over time → right-size", w / 2, h * 0.28);
      break;
    }
    case "accounts": {
      nodeBox(ctx, w * 0.5, h * 0.25, 90, 24, "Global account", accent + "33", accent, true);
      nodeBox(ctx, w * 0.3, h * 0.48, 70, 24, "Directory", accent2 + "33", accent2, phase >= 1);
      nodeBox(ctx, w * 0.7, h * 0.48, 70, 24, "Subaccount", accent2 + "33", accent2, phase >= 2);
      arrow(ctx, w * 0.5, h * 0.32, w * 0.3, h * 0.42, accent, "", pulse);
      arrow(ctx, w * 0.5, h * 0.32, w * 0.7, h * 0.42, accent, "", pulse);
      break;
    }
    case "cf_space": {
      nodeBox(ctx, w * 0.5, h * 0.28, 60, 24, "Org", accent + "33", accent, false);
      nodeBox(ctx, w * 0.28, h * 0.52, 54, 26, "Dev", accent2 + "33", accent2, phase === 0);
      nodeBox(ctx, w * 0.5, h * 0.52, 54, 26, "Test", accent2 + "33", accent2, phase === 1);
      nodeBox(ctx, w * 0.72, h * 0.52, 54, 26, "Prod", accent + "33", accent, phase >= 2);
      break;
    }
    case "mta": {
      nodeBox(ctx, w * 0.5, h * 0.3, 70, 26, "MTA", accent + "33", accent, true);
      ["UI", "API", "DB"].forEach((lb, i) => {
        nodeBox(ctx, w * (0.25 + i * 0.25), h * 0.55, 44, 24, lb, accent2 + "33", accent2, phase === i);
        arrow(ctx, w * 0.5, h * 0.38, w * (0.25 + i * 0.25), h * 0.48, accent, "", pulse);
      });
      break;
    }
    case "binding": {
      nodeBox(ctx, w * 0.3, h * 0.4, 54, 28, "App", accent2 + "33", accent2, true);
      nodeBox(ctx, w * 0.7, h * 0.4, 64, 28, "Service", accent + "33", accent, true);
      arrow(ctx, w * 0.4, h * 0.4, w * 0.58, h * 0.4, accent, "bind creds", pulse);
      break;
    }
    case "ai_hallucination": {
      nodeBox(ctx, w * 0.28, h * 0.4, 60, 30, "LLM", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.72, h * 0.4, 70, 30, "Truth?", "#fb718533", "#fb7185", phase >= 2);
      arrow(ctx, w * 0.4, h * 0.4, w * 0.58, h * 0.4, accent2, "likely≠true", pulse);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ground · cite · constrain", w / 2, h * 0.62);
      break;
    }
    case "ai_rag": {
      nodeBox(ctx, w * 0.18, h * 0.4, 48, 26, "Query", accent2 + "33", accent2, phase === 0);
      nodeBox(ctx, w * 0.42, h * 0.4, 54, 28, "Retrieve", accent + "33", accent, phase === 1);
      nodeBox(ctx, w * 0.66, h * 0.4, 48, 26, "LLM", accent2 + "33", accent2, phase === 2);
      nodeBox(ctx, w * 0.88, h * 0.4, 40, 26, "Ans", "#34d39933", "#34d399", phase === 3);
      arrow(ctx, w * 0.24, h * 0.4, w * 0.34, h * 0.4, accent2, "", pulse);
      arrow(ctx, w * 0.5, h * 0.4, w * 0.58, h * 0.4, accent, "docs", pulse);
      arrow(ctx, w * 0.74, h * 0.4, w * 0.82, h * 0.4, accent2, "", pulse);
      break;
    }
    case "ai_agent": {
      nodeBox(ctx, w * 0.25, h * 0.4, 50, 28, "Agent", accent + "33", accent, true);
      nodeBox(ctx, w * 0.55, h * 0.28, 48, 24, "Tool", accent2 + "33", accent2, phase >= 1);
      nodeBox(ctx, w * 0.55, h * 0.52, 48, 24, "Tool", accent2 + "33", accent2, phase >= 2);
      nodeBox(ctx, w * 0.82, h * 0.4, 48, 28, "Policy", "#fbbf2433", "#fbbf24", true);
      arrow(ctx, w * 0.35, h * 0.38, w * 0.48, h * 0.28, accent, "", pulse);
      arrow(ctx, w * 0.35, h * 0.42, w * 0.48, h * 0.52, accent, "", pulse);
      break;
    }
    case "ai_prompt": {
      nodeBox(ctx, w * 0.5, h * 0.4, 100, 36, "Prompt template", accent + "33", accent, true);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("version · test · no secrets", w / 2, h * 0.62);
      break;
    }
    case "ai_cost": {
      ["fast", "mid", "smart"].forEach((lb, i) => {
        nodeBox(
          ctx,
          w * (0.22 + i * 0.28),
          h * 0.4,
          54,
          28,
          lb,
          accent + "33",
          accent,
          phase === i,
        );
      });
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("route by task: latency × $ × quality", w / 2, h * 0.62);
      break;
    }
    case "ai_eval": {
      nodeBox(ctx, w * 0.3, h * 0.4, 64, 28, "Offline", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.7, h * 0.4, 64, 28, "Online", accent2 + "33", accent2, phase >= 2);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("golden set → production metrics", w / 2, h * 0.62);
      break;
    }
    case "bpa_workflow": {
      ["Start", "Form", "Approve", "Done"].forEach((lb, i) => {
        const x = w * (0.14 + i * 0.22);
        nodeBox(ctx, x, h * 0.4, 48, 26, lb, accent + "33", accent, phase === i);
        if (i < 3) arrow(ctx, x + 24, h * 0.4, x + w * 0.22 - 24, h * 0.4, accent2, "", pulse);
      });
      break;
    }
    case "bpa_rules": {
      nodeBox(ctx, w * 0.25, h * 0.4, 54, 28, "Input", accent2 + "33", accent2, phase === 0);
      nodeBox(ctx, w * 0.5, h * 0.4, 54, 30, "Rules", accent + "33", accent, true);
      nodeBox(ctx, w * 0.75, h * 0.4, 54, 28, "Decision", accent2 + "33", accent2, phase >= 2);
      arrow(ctx, w * 0.34, h * 0.4, w * 0.42, h * 0.4, accent2, "", pulse);
      arrow(ctx, w * 0.58, h * 0.4, w * 0.66, h * 0.4, accent, "", pulse);
      break;
    }
    case "fiori_elements": {
      nodeBox(ctx, w * 0.3, h * 0.4, 70, 30, "Annotations", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.7, h * 0.4, 70, 30, "UI floorplan", accent2 + "33", accent2, phase >= 2);
      arrow(ctx, w * 0.42, h * 0.4, w * 0.58, h * 0.4, accent, "generate", pulse);
      break;
    }
    case "workzone": {
      nodeBox(ctx, w * 0.5, h * 0.3, 80, 28, "Work Zone", accent + "33", accent, true);
      ["App", "Content", "Role"].forEach((lb, i) => {
        nodeBox(ctx, w * (0.25 + i * 0.25), h * 0.58, 50, 24, lb, accent2 + "33", accent2, phase === i);
      });
      break;
    }
    case "draft": {
      nodeBox(ctx, w * 0.3, h * 0.4, 60, 30, "Draft", accent2 + "33", accent2, phase < 2);
      nodeBox(ctx, w * 0.7, h * 0.4, 70, 30, "Active", accent + "33", accent, phase >= 2);
      arrow(ctx, w * 0.42, h * 0.4, w * 0.58, h * 0.4, accent, "activate", pulse);
      break;
    }
    case "schema_evolution": {
      nodeBox(ctx, w * 0.28, h * 0.4, 54, 28, "v1", accent2 + "33", accent2, phase < 2);
      nodeBox(ctx, w * 0.72, h * 0.4, 54, 28, "v2+", accent + "33", accent, phase >= 2);
      arrow(ctx, w * 0.4, h * 0.4, w * 0.6, h * 0.4, accent, "additive", pulse);
      break;
    }
    case "csrf": {
      nodeBox(ctx, w * 0.25, h * 0.4, 50, 28, "Browser", accent2 + "33", accent2, true);
      nodeBox(ctx, w * 0.55, h * 0.4, 50, 28, "Attacker", "#fb718533", "#fb7185", phase % 2 === 0);
      nodeBox(ctx, w * 0.82, h * 0.4, 50, 28, "API", accent + "33", accent, true);
      ctx.strokeStyle = "#fb7185";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.4);
      ctx.lineTo(w * 0.75, h * 0.4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#34d399";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("CSRF token on writes", w / 2, h * 0.62);
      break;
    }
    case "shared_resp": {
      nodeBox(ctx, w * 0.3, h * 0.4, 70, 36, "Provider", accent + "33", accent, phase < 2);
      nodeBox(ctx, w * 0.7, h * 0.4, 70, 36, "You", accent2 + "33", accent2, phase >= 2);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 8px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("platform", w * 0.3, h * 0.58);
      ctx.fillText("app · data · identity", w * 0.7, h * 0.58);
      break;
    }
    case "residency": {
      nodeBox(ctx, w * 0.3, h * 0.4, 60, 32, "EU region", accent + "33", accent, true);
      nodeBox(ctx, w * 0.7, h * 0.4, 60, 32, "US ✕?", "#fb718533", "#fb7185", phase >= 2);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("process · store · backup · support", w / 2, h * 0.62);
      break;
    }
    case "supply_chain": {
      nodeBox(ctx, w * 0.2, h * 0.4, 48, 26, "Dep", accent2 + "33", accent2, phase === 0);
      nodeBox(ctx, w * 0.45, h * 0.4, 48, 26, "Build", accent + "33", accent, phase === 1);
      nodeBox(ctx, w * 0.7, h * 0.4, 48, 26, "Scan", accent2 + "33", accent2, phase === 2);
      nodeBox(ctx, w * 0.9, h * 0.4, 40, 26, "Run", "#34d39933", "#34d399", phase === 3);
      break;
    }
    case "accessibility": {
      nodeBox(ctx, w * 0.5, h * 0.4, 100, 36, "Keyboard · contrast · labels", accent + "33", accent, true);
      break;
    }
    default: {
      nodeBox(ctx, w * 0.5, h * 0.4, 90, 34, "Concept", accent + "33", accent, true);
      ctx.fillStyle = "#93a4c3";
      ctx.font = "500 9px Outfit, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("open card for full teach text", w / 2, h * 0.6);
    }
  }

  caption(ctx, w, h, beatText.slice(0, 48));
}
