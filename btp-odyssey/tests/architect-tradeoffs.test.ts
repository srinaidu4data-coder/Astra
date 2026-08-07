import { describe, expect, it } from "vitest";
import {
  ARCHITECT_SCENARIOS,
  evaluateTradeoff,
} from "@btp-odyssey/assessment";

describe("architect trade-off engine", () => {
  it("ships multiple complex scenarios with board challenges", () => {
    expect(ARCHITECT_SCENARIOS.length).toBeGreaterThanOrEqual(4);
    for (const s of ARCHITECT_SCENARIOS) {
      expect(s.options.length).toBeGreaterThanOrEqual(3);
      expect(s.boardChallenges.length).toBeGreaterThanOrEqual(2);
      expect(s.nonNegotiables.length).toBeGreaterThan(0);
    }
  });

  it("rewards reasoned CAP/RAP defense and rejects admin-all thinking", () => {
    const s = ARCHITECT_SCENARIOS.find((x) => x.id === "arch-cap-rap-global-orders")!;
    const good = evaluateTradeoff(s, {
      selectedOptionId: "rap-onstack",
      rejectedOptionIds: ["lowcode-bpa"],
      weights: {
        security: 0.8,
        clean_core: 0.9,
        team_fit: 0.8,
        cost: 0.5,
        resilience: 0.6,
        complexity: 0.5,
        time_to_value: 0.4,
        operability: 0.6,
        scalability: 0.5,
        data_governance: 0.5,
      },
      rationale:
        "I choose RAP because clean-core transactional fidelity and ABAP team fit. I reject BPA-only because rich analytics UX is required. Trade risk is ops ownership. Constraints: no modification, audit, least privilege.",
      boardAnswers: {
        "bc-identity":
          "Use destination OAuth with least privilege scopes for approve; principal identity; audit actor; no admin technical user.",
        "bc-failure":
          "Bottleneck on approve API; retry with backoff and idempotency; SLO and shed load; circuit breaker.",
        "bc-cleancore":
          "No core modification; released API and RAP extension; upgrade test scope documented.",
        "bc-cost":
          "Year-1 cost is runtime and FTE; defer multi-region event mesh to phase 2.",
      },
    });
    expect(good.overall).toBeGreaterThan(0.55);
    expect(good.prestigeDelta).toBeGreaterThan(0);

    const bad = evaluateTradeoff(s, {
      selectedOptionId: "cap-side",
      rejectedOptionIds: [],
      weights: { cost: 1 },
      rationale: "use cloud",
      boardAnswers: {
        "bc-identity": "just use admin",
        "bc-failure": "hope",
        "bc-cleancore": "modify standard",
        "bc-cost": "cost is free on cloud",
      },
    });
    expect(bad.overall).toBeLessThan(good.overall);
  });

  it("penalizes unapproved raw PII replica under residency case", () => {
    const s = ARCHITECT_SCENARIOS.find((x) => x.id === "arch-multi-region-data")!;
    const anti = evaluateTradeoff(s, {
      selectedOptionId: "raw-us-replica",
      rejectedOptionIds: ["eu-only"],
      weights: { time_to_value: 1, security: 0.1 },
      rationale: "faster charts",
      boardAnswers: {
        "bc-residency": "cdn holds pii copy everything",
        "bc-semantic": "each team defines own",
        "bc-latency": "ignore latency",
      },
    });
    const good = evaluateTradeoff(s, {
      selectedOptionId: "eu-only",
      rejectedOptionIds: ["raw-us-replica"],
      weights: { security: 0.9, data_governance: 0.9, cost: 0.5 },
      rationale:
        "Residency is non-negotiable for PII. Reject raw US replica. Use aggregates for US and single semantic owner for Net Revenue with lineage.",
      boardAnswers: {
        "bc-residency":
          "PII stored and processed in EU; US gets anonymized aggregates after approval gates; not CDN as store.",
        "bc-semantic":
          "Single owner and versioned data product contract with lineage checks.",
        "bc-latency":
          "Regional SLA; cache non-PII; degrade to aggregates rather than illegal replica.",
      },
    });
    expect(good.overall).toBeGreaterThan(anti.overall);
  });
});
