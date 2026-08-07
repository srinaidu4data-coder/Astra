/**
 * Architect-level multi-criteria trade-off evaluation.
 * Scores design reasoning quality — not "right answer only".
 */

export type TradeAxis =
  | "security"
  | "resilience"
  | "cost"
  | "complexity"
  | "time_to_value"
  | "operability"
  | "clean_core"
  | "scalability"
  | "data_governance"
  | "team_fit";

export interface DesignOption {
  id: string;
  title: string;
  summary: string;
  scores: Partial<Record<TradeAxis, number>>; // 0..1 higher = better on that axis
  risks: string[];
  whenToChoose: string[];
  whenToReject: string[];
}

export interface TradeScenario {
  id: string;
  title: string;
  businessContext: string;
  constraints: string[];
  nonNegotiables: string[];
  options: DesignOption[];
  boardChallenges: {
    id: string;
    voice: string;
    question: string;
    strongAnswerKeywords: string[];
    weakPatterns: string[];
    modelAnswer: string;
  }[];
  recommendedPrimary?: string;
  note: string;
}

export interface TradeSubmission {
  selectedOptionId: string;
  rejectedOptionIds: string[];
  weights: Partial<Record<TradeAxis, number>>;
  rationale: string;
  boardAnswers: Record<string, string>;
}

export interface TradeEvaluation {
  overall: number;
  passed: boolean;
  dimensionScores: Record<string, number>;
  feedback: string[];
  boardResults: {
    id: string;
    score: number;
    feedback: string;
  }[];
  radar: { axis: TradeAxis; selected: number; weight: number }[];
  prestigeDelta: number;
}

const ALL_AXES: TradeAxis[] = [
  "security",
  "resilience",
  "cost",
  "complexity",
  "time_to_value",
  "operability",
  "clean_core",
  "scalability",
  "data_governance",
  "team_fit",
];

function scoreKeywords(text: string, keys: string[]): number {
  if (!text.trim()) return 0;
  const lower = text.toLowerCase();
  const hits = keys.filter((k) => lower.includes(k.toLowerCase())).length;
  return keys.length ? hits / keys.length : 0;
}

export function evaluateTradeoff(
  scenario: TradeScenario,
  sub: TradeSubmission,
): TradeEvaluation {
  const feedback: string[] = [];
  const option = scenario.options.find((o) => o.id === sub.selectedOptionId);
  if (!option) {
    return {
      overall: 0,
      passed: false,
      dimensionScores: {},
      feedback: ["No option selected."],
      boardResults: [],
      radar: [],
      prestigeDelta: 0,
    };
  }

  // Weight quality: did learner assign meaningful priorities?
  const weightEntries = ALL_AXES.map((a) => [a, sub.weights[a] ?? 0] as const);
  const weightSum = weightEntries.reduce((s, [, w]) => s + w, 0) || 1;
  const normalized = Object.fromEntries(
    weightEntries.map(([a, w]) => [a, w / weightSum]),
  ) as Record<TradeAxis, number>;

  // Weighted option score
  let weighted = 0;
  for (const axis of ALL_AXES) {
    weighted += (option.scores[axis] ?? 0.5) * (normalized[axis] ?? 0);
  }

  // Rationale quality
  const rationaleScore = Math.min(
    1,
    scoreKeywords(sub.rationale, [
      "because",
      "trade",
      "risk",
      "constraint",
      "reject",
      "cost",
      "security",
      "resilience",
      "operat",
      "clean",
      "scale",
      "latency",
      "owner",
      "rollback",
      "assume",
    ]) *
      1.4 +
      (sub.rejectedOptionIds.length > 0 ? 0.15 : 0) +
      (sub.rationale.length > 120 ? 0.15 : 0),
  );

  // Explicit rejection credit
  const rejectScore = Math.min(1, sub.rejectedOptionIds.length / Math.max(scenario.options.length - 1, 1));

  // Non-negotiable awareness
  const nnScore = scoreKeywords(
    sub.rationale + " " + Object.values(sub.boardAnswers).join(" "),
    scenario.nonNegotiables.flatMap((n) => n.toLowerCase().split(/\s+/).filter((w) => w.length > 4)).slice(0, 12),
  );

  const boardResults = scenario.boardChallenges.map((ch) => {
    const ans = sub.boardAnswers[ch.id] ?? "";
    const strong = scoreKeywords(ans, ch.strongAnswerKeywords);
    const weakHit = ch.weakPatterns.some((w) => ans.toLowerCase().includes(w.toLowerCase()));
    const score = Math.max(0, strong - (weakHit ? 0.35 : 0));
    let fb = ch.modelAnswer;
    if (score >= 0.6) fb = `Board (${ch.voice}) accepts your line of reasoning. ${ch.modelAnswer}`;
    else if (weakHit)
      fb = `Board (${ch.voice}) challenges a weak pattern in your answer. ${ch.modelAnswer}`;
    else fb = `Board (${ch.voice}) wants deeper trade-off detail. ${ch.modelAnswer}`;
    return { id: ch.id, score: Math.min(1, score), feedback: fb };
  });

  const boardAvg =
    boardResults.length === 0
      ? 0.5
      : boardResults.reduce((s, b) => s + b.score, 0) / boardResults.length;

  const overall =
    weighted * 0.25 + rationaleScore * 0.25 + rejectScore * 0.1 + nnScore * 0.1 + boardAvg * 0.3;

  if (rationaleScore < 0.4)
    feedback.push("Strengthen rationale: cite constraints, risks, and what you explicitly reject.");
  if (rejectScore < 0.3)
    feedback.push("Architects document rejected alternatives — pick at least one option you discard and why.");
  if (boardAvg < 0.5)
    feedback.push("Board answers need mechanism-level detail (identity, failure modes, ownership), not slogans.");
  if (overall >= 0.7)
    feedback.push("Solid architect-level trade-off defense. Prestige reflects demonstrated judgment, not XP farming.");

  const radar = ALL_AXES.map((axis) => ({
    axis,
    selected: option.scores[axis] ?? 0.5,
    weight: normalized[axis] ?? 0,
  }));

  const passed = overall >= 0.65 && rationaleScore >= 0.35 && boardAvg >= 0.35;
  const prestigeDelta = passed ? Math.round(8 + overall * 12 + boardAvg * 10) : Math.round(overall * 5);

  return {
    overall,
    passed,
    dimensionScores: {
      weighted_fit: weighted,
      rationale: rationaleScore,
      rejections: rejectScore,
      constraints: nnScore,
      board: boardAvg,
    },
    feedback,
    boardResults,
    radar,
    prestigeDelta,
  };
}

/** Built-in mega architect scenarios */
export const ARCHITECT_SCENARIOS: TradeScenario[] = [
  {
    id: "arch-cap-rap-global-orders",
    title: "Global Order Extension — CAP vs RAP vs Hybrid",
    businessContext:
      "A global manufacturer needs discount approval + order insight UX. S/4 remains system of record. Clean-core mandate. EU+US users. Peak 2k approvals/hour. Team: 4 ABAP seniors, 2 CAP juniors, thin SRE.",
    constraints: [
      "No core modifications",
      "P95 approve < 800ms regional",
      "Audit every approval",
      "Budget limits two major new runtimes in year 1",
    ],
    nonNegotiables: [
      "clean-core",
      "audit",
      "least privilege",
      "system of record remains S/4",
    ],
    options: [
      {
        id: "rap-onstack",
        title: "RAP on-stack extension + Fiori elements",
        summary: "Extend close to ABAP BOs with RAP, draft, and released APIs.",
        scores: {
          security: 0.75,
          resilience: 0.7,
          cost: 0.7,
          complexity: 0.65,
          time_to_value: 0.55,
          operability: 0.7,
          clean_core: 0.85,
          scalability: 0.6,
          data_governance: 0.7,
          team_fit: 0.9,
        },
        risks: ["ABAP skill bottleneck for UX innovation", "Side-by-side analytics still needed later"],
        whenToChoose: ["Transactional fidelity to core BO", "Strong ABAP bench"],
        whenToReject: ["Heavy event-native multi-cloud orchestration is primary need"],
      },
      {
        id: "cap-side",
        title: "CAP side-by-side + UI5 + events",
        summary: "BTP CAP service, UI5 app, Event Mesh-style projection, Integration Suite sync.",
        scores: {
          security: 0.7,
          resilience: 0.75,
          cost: 0.55,
          complexity: 0.5,
          time_to_value: 0.7,
          operability: 0.6,
          clean_core: 0.8,
          scalability: 0.8,
          data_governance: 0.65,
          team_fit: 0.45,
        },
        risks: ["Thin CAP skills", "Dual stack ops", "Identity propagation design burden"],
        whenToChoose: ["Differentiating UX/API velocity", "Event fan-out important"],
        whenToReject: ["No BTP ops capacity"],
      },
      {
        id: "hybrid",
        title: "Hybrid: RAP for postings, CAP for insight UX",
        summary: "RAP writes/approvals near core; CAP reads via APIs/events for analytics UX.",
        scores: {
          security: 0.8,
          resilience: 0.8,
          cost: 0.4,
          complexity: 0.35,
          time_to_value: 0.45,
          operability: 0.45,
          clean_core: 0.9,
          scalability: 0.85,
          data_governance: 0.8,
          team_fit: 0.55,
        },
        risks: ["Highest coordination cost", "Contract versioning across stacks"],
        whenToChoose: ["Both transactional purity and modern UX required"],
        whenToReject: ["Year-1 budget forbids dual runtime"],
      },
      {
        id: "lowcode-bpa",
        title: "Build Process Automation only",
        summary: "Workflow + forms for approvals without full app stack.",
        scores: {
          security: 0.55,
          resilience: 0.5,
          cost: 0.75,
          complexity: 0.8,
          time_to_value: 0.85,
          operability: 0.55,
          clean_core: 0.7,
          scalability: 0.4,
          data_governance: 0.45,
          team_fit: 0.7,
        },
        risks: ["Complex OData analytics UX weak", "Governance of citizen automation"],
        whenToChoose: ["Approval workflow is 90% of need"],
        whenToReject: ["Rich analytical Fiori experience is mandatory"],
      },
    ],
    boardChallenges: [
      {
        id: "bc-identity",
        voice: "Security Architect",
        question:
          "How does principal/user identity flow for approve action, and how do you prevent over-privileged technical users?",
        strongAnswerKeywords: [
          "destination",
          "scope",
          "role",
          "principal",
          "least",
          "audit",
          "token",
          "propagation",
        ],
        weakPatterns: ["just use admin", "disable auth", "hardcode user"],
        modelAnswer:
          "Prefer user-centric tokens with explicit scopes (e.g., Discount.Approve), destination auth that preserves identity where required, and audit of actor — not a shared god technical user.",
      },
      {
        id: "bc-failure",
        voice: "SRE",
        question:
          "What fails first at 3× peak, and what is your degradation mode?",
        strongAnswerKeywords: [
          "queue",
          "retry",
          "idempoten",
          "timeout",
          "backoff",
          "shed",
          "slo",
          "circuit",
        ],
        weakPatterns: ["it will scale automatically", "hope"],
        modelAnswer:
          "Name the bottleneck (API, workflow engine, or event consumer), define load shedding / retry with idempotency, and SLOs with user-visible degradation (read-only insights).",
      },
      {
        id: "bc-cleancore",
        voice: "Enterprise Architect",
        question: "Prove clean-core alignment and upgrade impact of your choice.",
        strongAnswerKeywords: [
          "released",
          "api",
          "side-by-side",
          "extension",
          "upgrade",
          "rap",
          "no modification",
        ],
        weakPatterns: ["modify standard", "copy sap code"],
        modelAnswer:
          "No core mods; use released APIs / RAP extensions / side-by-side CAP; document upgrade test scope.",
      },
      {
        id: "bc-cost",
        voice: "CFO advisor",
        question: "What is year-1 cost driver and what do you defer?",
        strongAnswerKeywords: [
          "runtime",
          "hana",
          "operat",
          "defer",
          "phase",
          "fte",
          "license",
          "event",
        ],
        weakPatterns: ["cost is free on cloud"],
        modelAnswer:
          "Call out runtime/HANA/ops FTE as drivers; phase event mesh or multi-region until metrics justify.",
      },
    ],
    recommendedPrimary: "rap-onstack",
    note: "Recommended depends on weights — hybrid wins if UX+core both non-negotiable and budget allows.",
  },
  {
    id: "arch-multi-region-data",
    title: "Multi-Region Insights — Residency vs Latency",
    businessContext:
      "Order insights must serve EU and US sales. EU PII residency strict. Leadership wants 'one global dashboard'. Analytics team proposes raw replica to US.",
    constraints: [
      "EU personal data residency",
      "P95 read < 500ms regional",
      "Single semantic definition of Net Revenue",
      "Audit findings close in 30 days",
    ],
    nonNegotiables: ["residency", "pii", "semantic ownership", "audit"],
    options: [
      {
        id: "eu-only",
        title: "EU primary only + US uses anonymized aggregates",
        summary: "Keep PII in EU; publish aggregate data products for US.",
        scores: {
          security: 0.9,
          resilience: 0.65,
          cost: 0.7,
          complexity: 0.7,
          time_to_value: 0.6,
          operability: 0.7,
          clean_core: 0.7,
          scalability: 0.6,
          data_governance: 0.95,
          team_fit: 0.75,
        },
        risks: ["US detail drill-down limited"],
        whenToChoose: ["Residency is hard constraint"],
        whenToReject: ["US legally needs row-level PII (then need approved US region store)"],
      },
      {
        id: "dual-region",
        title: "Dual-region active with approved US store",
        summary: "Separate regional stores after legal approval; shared semantics.",
        scores: {
          security: 0.75,
          resilience: 0.85,
          cost: 0.35,
          complexity: 0.35,
          time_to_value: 0.4,
          operability: 0.45,
          clean_core: 0.65,
          scalability: 0.9,
          data_governance: 0.8,
          team_fit: 0.55,
        },
        risks: ["Cost and dual-ops", "Semantic drift across regions"],
        whenToChoose: ["Both regions need row-level with approvals"],
        whenToReject: ["No residency approval path"],
      },
      {
        id: "raw-us-replica",
        title: "Unapproved raw PII replica to US (anti-pattern)",
        summary: "Copy EU PII to US for faster charts.",
        scores: {
          security: 0.1,
          resilience: 0.5,
          cost: 0.55,
          complexity: 0.6,
          time_to_value: 0.8,
          operability: 0.5,
          clean_core: 0.4,
          scalability: 0.7,
          data_governance: 0.05,
          team_fit: 0.6,
        },
        risks: ["Regulatory breach", "Audit freeze"],
        whenToChoose: [],
        whenToReject: ["Always under current constraints"],
      },
      {
        id: "edge-cdn-only",
        title: "CDN static UI only, data still EU API",
        summary: "Speed UI assets via CDN; data calls remain EU with caching of non-PII.",
        scores: {
          security: 0.8,
          resilience: 0.6,
          cost: 0.75,
          complexity: 0.75,
          time_to_value: 0.75,
          operability: 0.7,
          clean_core: 0.7,
          scalability: 0.55,
          data_governance: 0.85,
          team_fit: 0.8,
        },
        risks: ["Does not fix true multi-region data latency alone"],
        whenToChoose: ["Quick win alongside aggregate strategy"],
        whenToReject: ["Mistaken for full data residency solution"],
      },
    ],
    boardChallenges: [
      {
        id: "bc-residency",
        voice: "Privacy Counsel",
        question: "Where does personal data rest and process for US users in your design?",
        strongAnswerKeywords: [
          "eu",
          "aggregat",
          "anonym",
          "approv",
          "replica",
          "process",
          "store",
          "residency",
        ],
        weakPatterns: ["cdn holds pii", "copy everything"],
        modelAnswer:
          "Separate UI asset delivery from data residency. PII stays in approved regions; US may consume aggregates or approved regional stores only.",
      },
      {
        id: "bc-semantic",
        voice: "Data Architect",
        question: "How do you prevent Net Revenue semantic drift across regions?",
        strongAnswerKeywords: [
          "owner",
          "contract",
          "lineage",
          "product",
          "definition",
          "version",
        ],
        weakPatterns: ["each team defines own"],
        modelAnswer:
          "Single owned data product contract, versioned metrics, lineage checks in CI/pipelines.",
      },
      {
        id: "bc-latency",
        voice: "Product",
        question: "If EU API is cold for US users, what is the user-visible trade-off?",
        strongAnswerKeywords: [
          "cache",
          "aggregat",
          "async",
          "sla",
          "degrad",
          "regional",
          "latency",
        ],
        weakPatterns: ["ignore latency"],
        modelAnswer:
          "Publish regional SLOs; prefer aggregates/caching of non-PII; escalate to dual-region only with approval.",
      },
    ],
    recommendedPrimary: "eu-only",
    note: "Raw US replica is a known failing option under residency non-negotiables.",
  },
  {
    id: "arch-event-vs-sync",
    title: "Partner Orders — Sync API vs Events vs Dual-Write",
    businessContext:
      "20 partners submit orders. Today: brittle file drops. Target: reliable intake, duplicate-safe, near-real-time inventory signal to warehouse.",
    constraints: [
      "Partners have uneven API maturity",
      "At-least-once network reality",
      "Finance forbids silent duplicates",
      "Warehouse wants < 2 min signal",
    ],
    nonNegotiables: ["idempotency", "audit", "no silent duplicates"],
    options: [
      {
        id: "sync-api",
        title: "Synchronous API Management + CAP intake",
        summary: "Partners POST orders; immediate validation response.",
        scores: {
          security: 0.75,
          resilience: 0.55,
          cost: 0.6,
          complexity: 0.65,
          time_to_value: 0.7,
          operability: 0.65,
          clean_core: 0.7,
          scalability: 0.55,
          data_governance: 0.7,
          team_fit: 0.75,
        },
        risks: ["Partner timeouts under load", "Spike amplification"],
        whenToChoose: ["Strong immediate validation UX for partners"],
        whenToReject: ["Partners cannot sustain sync SLAs"],
      },
      {
        id: "event-first",
        title: "Event-first intake + async validation",
        summary: "Accept to durable log/topic; validate async; emit OrderAccepted/Rejected.",
        scores: {
          security: 0.7,
          resilience: 0.85,
          cost: 0.5,
          complexity: 0.45,
          time_to_value: 0.5,
          operability: 0.55,
          clean_core: 0.7,
          scalability: 0.9,
          data_governance: 0.75,
          team_fit: 0.5,
        },
        risks: ["Harder partner mental model", "Need good status APIs"],
        whenToChoose: ["Burst traffic", "Many slow partners"],
        whenToReject: ["No event ops skill"],
      },
      {
        id: "dual-write",
        title: "Dual-write DB + warehouse (anti-pattern)",
        summary: "App writes two systems in one request without outbox.",
        scores: {
          security: 0.4,
          resilience: 0.2,
          cost: 0.7,
          complexity: 0.7,
          time_to_value: 0.75,
          operability: 0.3,
          clean_core: 0.4,
          scalability: 0.3,
          data_governance: 0.35,
          team_fit: 0.6,
        },
        risks: ["Partial failure inconsistency"],
        whenToChoose: [],
        whenToReject: ["Almost always"],
      },
      {
        id: "outbox-hybrid",
        title: "Sync validate + transactional outbox events",
        summary: "Sync ack after durable accept; outbox publishes inventory events.",
        scores: {
          security: 0.8,
          resilience: 0.9,
          cost: 0.45,
          complexity: 0.4,
          time_to_value: 0.45,
          operability: 0.6,
          clean_core: 0.75,
          scalability: 0.85,
          data_governance: 0.8,
          team_fit: 0.55,
        },
        risks: ["Implementation complexity"],
        whenToChoose: ["Need both ack and reliable fan-out"],
        whenToReject: ["Extreme time pressure with no platform patterns ready"],
      },
    ],
    boardChallenges: [
      {
        id: "bc-idem",
        voice: "Integration Architect",
        question: "Specify idempotency key and replay behavior.",
        strongAnswerKeywords: [
          "orderid",
          "idempoten",
          "replay",
          "dedup",
          "partner",
          "key",
          "dlq",
        ],
        weakPatterns: ["just retry", "unique enough"],
        modelAnswer:
          "Business key (partnerId+orderId), store processed keys, safe replay, DLQ for poison.",
      },
      {
        id: "bc-consistency",
        voice: "Enterprise Architect",
        question: "What consistency model do warehouse signals use?",
        strongAnswerKeywords: [
          "eventual",
          "outbox",
          "at-least-once",
          "compensat",
          "signal",
          "consistency",
        ],
        weakPatterns: ["exactly once everywhere", "dual write is fine"],
        modelAnswer:
          "At-least-once + idempotent consumers; avoid dual-write; outbox/inbox patterns; eventual consistency with explicit lag SLO.",
      },
    ],
    recommendedPrimary: "outbox-hybrid",
    note: "Dual-write should lose under resilience weights.",
  },
  {
    id: "arch-saas-isolation",
    title: "Multi-Tenant SaaS — Isolation vs Support Velocity",
    businessContext:
      "You sell a multi-tenant CAP app. Support demands cross-tenant tools. Enterprise customers demand isolation evidence. Audit in 60 days.",
    constraints: [
      "Shared app runtime",
      "Support MTTR < 4h",
      "No cross-tenant data access in normal ops",
      "Break-glass must be audited",
    ],
    nonNegotiables: ["tenant isolation", "least privilege", "audit"],
    options: [
      {
        id: "shared-schema",
        title: "Shared schema + mandatory tenant predicate",
        summary: "Discriminator column enforced in middleware + tests.",
        scores: {
          security: 0.65,
          resilience: 0.7,
          cost: 0.85,
          complexity: 0.7,
          time_to_value: 0.8,
          operability: 0.7,
          clean_core: 0.6,
          scalability: 0.75,
          data_governance: 0.6,
          team_fit: 0.8,
        },
        risks: ["One missed filter = incident"],
        whenToChoose: ["Early stage cost pressure with strong test discipline"],
        whenToReject: ["Regulated customers require stronger isolation"],
      },
      {
        id: "schema-per-tenant",
        title: "Schema/DB per tenant",
        summary: "Strong isolation, higher ops cost.",
        scores: {
          security: 0.9,
          resilience: 0.75,
          cost: 0.3,
          complexity: 0.35,
          time_to_value: 0.4,
          operability: 0.4,
          clean_core: 0.6,
          scalability: 0.6,
          data_governance: 0.85,
          team_fit: 0.5,
        },
        risks: ["Provisioning complexity", "Cost"],
        whenToChoose: ["Enterprise isolation demands"],
        whenToReject: ["Hundreds of tiny tenants with no ops automation"],
      },
      {
        id: "support-admin-all",
        title: "Support Admin.All (anti-pattern)",
        summary: "Give support god mode for speed.",
        scores: {
          security: 0.05,
          resilience: 0.4,
          cost: 0.9,
          complexity: 0.9,
          time_to_value: 0.9,
          operability: 0.3,
          clean_core: 0.3,
          scalability: 0.5,
          data_governance: 0.1,
          team_fit: 0.7,
        },
        risks: ["Catastrophic breach path"],
        whenToChoose: [],
        whenToReject: ["Always"],
      },
      {
        id: "breakglass",
        title: "Least-privilege support + time-boxed break-glass",
        summary: "Normal support scoped; elevation temporary, dual-control, fully audited.",
        scores: {
          security: 0.9,
          resilience: 0.8,
          cost: 0.55,
          complexity: 0.5,
          time_to_value: 0.55,
          operability: 0.75,
          clean_core: 0.65,
          scalability: 0.75,
          data_governance: 0.85,
          team_fit: 0.7,
        },
        risks: ["Process discipline required"],
        whenToChoose: ["Need MTTR and isolation together"],
        whenToReject: ["No willingness to operate break-glass process"],
      },
    ],
    boardChallenges: [
      {
        id: "bc-tenant",
        voice: "Security Architect",
        question: "How do you prove tenant guards on admin export APIs?",
        strongAnswerKeywords: [
          "tenant",
          "guard",
          "middleware",
          "test",
          "export",
          "predicate",
          "audit",
        ],
        weakPatterns: ["trust the ui", "admin needs all"],
        modelAnswer:
          "Server-side tenant context mandatory; CI isolation tests; admin export requires tenant scope + audit.",
      },
      {
        id: "bc-support",
        voice: "Customer Success",
        question: "How does support solve Sev-1 without Admin.All?",
        strongAnswerKeywords: [
          "break-glass",
          "time",
          "audit",
          "scoped",
          "ticket",
          "elevat",
          "least",
        ],
        weakPatterns: ["give admin permanently"],
        modelAnswer:
          "Scoped tools first; break-glass elevation time-boxed, ticket-linked, dual control, recorded.",
      },
    ],
    recommendedPrimary: "breakglass",
    note: "Admin.All must fail security-weighted evaluation.",
  },
];

export function getTradeScenario(id: string): TradeScenario | undefined {
  return ARCHITECT_SCENARIOS.find((s) => s.id === id);
}
