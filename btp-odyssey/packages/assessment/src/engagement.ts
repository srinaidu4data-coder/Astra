/**
 * Ethical engagement model (informed by Flow, Self-Determination Theory,
 * curiosity research, peak-end rule) — WITHOUT dark patterns.
 *
 * Allowed: competence feedback, autonomy, curiosity gaps, meaningful progress,
 * variable interesting challenges, natural stopping points.
 *
 * Forbidden: shame streaks, loot, artificial scarcity, sleep disruption,
 * coercive urgency, pay-to-win, fake social pressure.
 */

export interface EngagementState {
  prestige: number;
  flowScore: number; // 0..100 momentary
  openLoops: { id: string; title: string; missionId?: string; createdAt: string }[];
  masteryMoments: { id: string; title: string; at: string; detail: string }[];
  architectRank: string;
  sessionsToday: number;
  lastBreakNudgeAt?: string;
  curiosityCards: { id: string; hook: string; payoffConcept: string }[];
}

export function rankFromPrestige(p: number): string {
  if (p >= 400) return "Principal Architect (sim evidence)";
  if (p >= 250) return "Senior Architect (sim evidence)";
  if (p >= 120) return "Architect (sim evidence)";
  if (p >= 50) return "Associate Architect (sim evidence)";
  return "Apprentice Designer";
}

export function emptyEngagement(): EngagementState {
  return {
    prestige: 0,
    flowScore: 40,
    openLoops: [],
    masteryMoments: [],
    architectRank: rankFromPrestige(0),
    sessionsToday: 0,
    curiosityCards: [
      {
        id: "cur-aud",
        hook: "Why can a token endpoint return 200 while the API still returns 401?",
        payoffConcept: "sec-jwt-claims",
      },
      {
        id: "cur-dual",
        hook: "Why do senior architects treat dual-write as a smell even when it 'works in dev'?",
        payoffConcept: "cpi-idempotency",
      },
      {
        id: "cur-tenant",
        hook: "What is more dangerous than a missing UI button: a missing tenant predicate — why?",
        payoffConcept: "sec-tenant-isolation",
      },
      {
        id: "cur-cleancore",
        hook: "When is RAP the clean-core move and when does CAP protect the core better?",
        payoffConcept: "rap-vs-cap",
      },
      {
        id: "cur-res",
        hook: "Is a CDN edge cache a residency control? (Trap question.)",
        payoffConcept: "sec-tenant-isolation",
      },
      {
        id: "cur-odata",
        hook: "What does an OData $expand do to performance if left unbounded?",
        payoffConcept: "odata-query-perf",
      },
      {
        id: "cur-joule",
        hook: "Why must Joule/AI answers be grounded before production use?",
        payoffConcept: "ai-hallucination",
      },
      {
        id: "cur-bdc",
        hook: "What makes a data product different from a dump of tables?",
        payoffConcept: "bdc-data-product",
      },
    ],
  };
}

/** Flow increases with successful checks and diagnosis — not with raw time-on-site. */
export function bumpFlow(
  state: EngagementState,
  event: "check_pass" | "check_fail" | "diagnose_pass" | "board_pass" | "idle",
): EngagementState {
  let flow = state.flowScore;
  switch (event) {
    case "check_pass":
      flow = Math.min(100, flow + 6);
      break;
    case "diagnose_pass":
      flow = Math.min(100, flow + 12);
      break;
    case "board_pass":
      flow = Math.min(100, flow + 10);
      break;
    case "check_fail":
      flow = Math.max(15, flow - 4);
      break;
    case "idle":
      flow = Math.max(20, flow - 1);
      break;
  }
  return { ...state, flowScore: flow };
}

export function addPrestige(state: EngagementState, delta: number, moment?: string): EngagementState {
  const prestige = Math.max(0, state.prestige + delta);
  const masteryMoments = moment
    ? [
        {
          id: `mm-${Date.now()}`,
          title: moment,
          at: new Date().toISOString(),
          detail: `+${delta} prestige from demonstrated judgment`,
        },
        ...state.masteryMoments,
      ].slice(0, 20)
    : state.masteryMoments;
  return {
    ...state,
    prestige,
    architectRank: rankFromPrestige(prestige),
    masteryMoments,
  };
}

export function openLoop(
  state: EngagementState,
  loop: { id: string; title: string; missionId?: string },
): EngagementState {
  if (state.openLoops.some((l) => l.id === loop.id)) return state;
  return {
    ...state,
    openLoops: [
      { ...loop, createdAt: new Date().toISOString() },
      ...state.openLoops,
    ].slice(0, 8),
  };
}

export function closeLoop(state: EngagementState, id: string): EngagementState {
  return {
    ...state,
    openLoops: state.openLoops.filter((l) => l.id !== id),
  };
}
