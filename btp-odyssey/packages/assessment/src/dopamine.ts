/**
 * Ethical "return loop" design inspired by:
 * - Dopamine as anticipation (Schultz) — build-up before reveal, not random loot
 * - Variable interesting challenges (not variable-ratio gambling)
 * - Goal gradient (Hull/Kivetz) — near unlocks feel closer
 * - Peak-end rule (Kahneman) — strong clear moments + good session endings
 * - Self-determination (Deci/Ryan) — optional stakes, autonomy, competence
 * - Zeigarnik — unfinished challenge invite without shame
 * - Flow (Csikszentmihalyi) — challenge matches skill; combo = focus chain
 * - Endowed progress (Nunes/Dreze) — show campaign progress already made
 *
 * Explicitly NOT: loot boxes, shame streaks, sleep pressure, FOMO timers that
 * punish absence, infinite scroll traps, or compulsory daily play.
 */

export interface ReturnState {
  unfinishedChallengeId: string | null;
  unfinishedTitle: string | null;
  unfinishedStep: number;
  nextUnlockId: string | null;
  nextUnlockTitle: string | null;
  clearedCount: number;
  totalChallenges: number;
  /** 0..1 progress along campaign */
  goalGradient: number;
  /** Steps remaining in unfinished challenge (Zeigarnik strength) */
  stepsLeftInLoop: number | null;
  /** True when next unlock is one clear away */
  nearMiss: boolean;
  /** Optional daily seed (bonus only — missing it never costs) */
  dailySeed: number;
  dailyLabel: string;
  /** Rotating curiosity hook for the day */
  curiosityHook: string;
  comebackLine: string;
  ethicsLine: string;
  /** Progress toward next architect rank (endowed progress) */
  rankProgress: {
    current: string;
    next: string | null;
    prestige: number;
    need: number;
    pct: number;
  };
  /** Soft comeback bonus available (never a penalty if ignored) */
  comebackBonusAvailable: boolean;
  comebackBonusLabel: string | null;
  /** Suggested natural stopping point after a clear */
  stopHint: string;
}

const DAILY_LABELS = [
  "Precision focus day (optional bonus)",
  "Curiosity loop day (optional)",
  "Architect judgment day (optional)",
  "Calm mastery day (optional)",
  "Pattern-spotting day (optional)",
  "Trade-off day (optional)",
];

const CURIOSITY_HOOKS = [
  "Why can a 200 from the token endpoint still mean a 401 on the API?",
  "When is dual-write a temporary bridge — and when is it a permanent smell?",
  "What is more dangerous than a missing UI button: a missing tenant predicate?",
  "When does RAP protect clean core better than CAP — and when is it the reverse?",
  "Is a CDN edge cache a residency control? (Trap.)",
  "What does unbounded OData $expand do to your p99?",
  "Why must Joule answers be grounded before production?",
  "What makes a data product different from a dump of tables?",
  "Where does destination configuration hide the real failure?",
  "Why does ‘works in my tenant’ fail multi-tenant reviews?",
];

const STOP_HINTS = [
  "Natural stop: you just closed a peak. Coming back tomorrow keeps the loop warm.",
  "Good end point — peak-end rule: leave on a win. Progress is saved.",
  "Solid session close. Optional: one curiosity card, then rest.",
];

export function dailySeed(date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return (y * 10000 + m * 100 + d) % 997;
}

export function rankLadder(prestige: number): {
  current: string;
  next: string | null;
  prestige: number;
  need: number;
  pct: number;
} {
  const tiers: { name: string; at: number }[] = [
    { name: "Apprentice Designer", at: 0 },
    { name: "Associate Architect (sim evidence)", at: 50 },
    { name: "Architect (sim evidence)", at: 120 },
    { name: "Senior Architect (sim evidence)", at: 250 },
    { name: "Principal Architect (sim evidence)", at: 400 },
  ];
  let current = tiers[0]!;
  let next: (typeof tiers)[0] | null = tiers[1] ?? null;
  for (let i = 0; i < tiers.length; i++) {
    if (prestige >= tiers[i]!.at) {
      current = tiers[i]!;
      next = tiers[i + 1] ?? null;
    }
  }
  if (!next) {
    return {
      current: current.name,
      next: null,
      prestige,
      need: 0,
      pct: 1,
    };
  }
  const span = next.at - current.at;
  const into = prestige - current.at;
  return {
    current: current.name,
    next: next.name,
    prestige,
    need: Math.max(0, next.at - prestige),
    pct: Math.min(1, Math.max(0, into / span)),
  };
}

/** Hours since last activity → soft comeback bonus (never a debt). */
export function comebackBonus(hoursAway: number | null | undefined): {
  available: boolean;
  label: string | null;
  prestigeBoost: number;
} {
  if (hoursAway == null || hoursAway < 6) {
    return { available: false, label: null, prestigeBoost: 0 };
  }
  if (hoursAway < 24) {
    return {
      available: true,
      label: "Warm return (+4 prestige on next clear)",
      prestigeBoost: 4,
    };
  }
  if (hoursAway < 72) {
    return {
      available: true,
      label: "Welcome back (+8 prestige on next clear)",
      prestigeBoost: 8,
    };
  }
  return {
    available: true,
    label: "Long break, zero debt (+12 prestige on next clear)",
    prestigeBoost: 12,
  };
}

export function buildReturnState(input: {
  challenges: { id: string; title: string; unlockAfter: string | null; stepCount?: number }[];
  clearedIds: string[];
  unfinished?: { challengeId: string; title: string; stepIndex: number } | null;
  prestige?: number;
  lastActiveAt?: string | null;
  unfinishedStepCount?: number;
}): ReturnState {
  const cleared = new Set(input.clearedIds);
  const total = input.challenges.length || 1;
  const clearedCount = input.challenges.filter((c) => cleared.has(c.id)).length;

  const next = input.challenges.find((c) => {
    if (cleared.has(c.id)) return false;
    if (!c.unlockAfter) return true;
    return cleared.has(c.unlockAfter);
  });

  const seed = dailySeed();
  const prestige = input.prestige ?? 0;
  const rankProgress = rankLadder(prestige);

  let hoursAway: number | null = null;
  if (input.lastActiveAt) {
    const t = Date.parse(input.lastActiveAt);
    if (!Number.isNaN(t)) {
      hoursAway = (Date.now() - t) / 3_600_000;
    }
  }
  const cb = comebackBonus(hoursAway);

  let stepsLeft: number | null = null;
  if (input.unfinished) {
    const totalSteps =
      input.unfinishedStepCount ??
      input.challenges.find((c) => c.id === input.unfinished!.challengeId)?.stepCount ??
      5;
    stepsLeft = Math.max(0, totalSteps - (input.unfinished.stepIndex + 1));
  }

  const nearMiss =
    !!next &&
    clearedCount > 0 &&
    clearedCount / total >= 0.5 &&
    total - clearedCount <= 2;

  let comebackLine =
    "Welcome back. Your progress is saved — returning is always a win, never a debt.";
  if (input.unfinished) {
    const left =
      stepsLeft != null && stepsLeft > 0
        ? ` ~${stepsLeft} beat${stepsLeft === 1 ? "" : "s"} left`
        : "";
    comebackLine = `Open loop: “${input.unfinished.title}” waits at step ${input.unfinished.stepIndex + 1}.${left} No penalty for the pause.`;
  } else if (nearMiss && next) {
    comebackLine = `Almost there — “${next.title}” is the next gate. Goal gradient ${Math.round((clearedCount / total) * 100)}%.`;
  } else if (next) {
    comebackLine = `Next unlock ready: “${next.title}”. Goal gradient ${Math.round((clearedCount / total) * 100)}% of campaign.`;
  } else if (clearedCount >= total) {
    comebackLine =
      "Campaign cleared. Replay any challenge in Precision mode for optional stakes — never required.";
  }

  if (cb.available && cb.label) {
    comebackLine = `${comebackLine} ${cb.label}.`;
  }

  return {
    unfinishedChallengeId: input.unfinished?.challengeId ?? null,
    unfinishedTitle: input.unfinished?.title ?? null,
    unfinishedStep: input.unfinished?.stepIndex ?? 0,
    nextUnlockId: next?.id ?? null,
    nextUnlockTitle: next?.title ?? null,
    clearedCount,
    totalChallenges: total,
    goalGradient: clearedCount / total,
    stepsLeftInLoop: stepsLeft,
    nearMiss,
    dailySeed: seed,
    dailyLabel: DAILY_LABELS[seed % DAILY_LABELS.length]!,
    curiosityHook: CURIOSITY_HOOKS[seed % CURIOSITY_HOOKS.length]!,
    comebackLine,
    ethicsLine:
      "Risk/reward here is competence stakes you opt into. Missing a day never punishes you. No loot boxes, shame streaks, or sleep traps.",
    rankProgress,
    comebackBonusAvailable: cb.available,
    comebackBonusLabel: cb.label,
    stopHint: STOP_HINTS[seed % STOP_HINTS.length]!,
  };
}

/** Prestige from a challenge clear, with optional precision bonus + comeback. */
export function challengeClearReward(input: {
  wrongs: number;
  hintsUsed: number;
  precisionMode: boolean;
  stepCount: number;
  /** Soft return bonus — only positive */
  comebackBoost?: number;
  /** Focus chain at clear time */
  combo?: number;
}): { prestige: number; label: string; peak: "normal" | "strong" | "epic"; breakdown: string[] } {
  let prestige = 12 + Math.max(0, input.stepCount) * 2;
  let label = "Challenge clear";
  let peak: "normal" | "strong" | "epic" = "normal";
  const breakdown: string[] = [`Base clear +${12 + Math.max(0, input.stepCount) * 2}`];

  if (input.precisionMode) {
    // Risk: you opted into higher stakes. Reward only if clean-ish run.
    if (input.wrongs === 0 && input.hintsUsed <= 1) {
      prestige = Math.round(prestige * 2.2);
      label = "Precision clear — clean run";
      peak = "epic";
      breakdown.push("Precision clean ×2.2");
    } else if (input.wrongs <= 1) {
      prestige = Math.round(prestige * 1.3);
      label = "Precision clear — nearly clean";
      peak = "strong";
      breakdown.push("Precision near-clean ×1.3");
    } else {
      prestige = Math.round(prestige * 0.7);
      label = "Precision clear — stakes taught, base reward reduced";
      peak = "normal";
      breakdown.push("Precision messy ×0.7 (still learned)");
    }
  } else if (input.wrongs === 0) {
    prestige += 6;
    label = "Clean clear";
    peak = "strong";
    breakdown.push("Clean run +6");
  }

  if (input.combo && input.combo >= 4) {
    const bonus = Math.min(10, input.combo);
    prestige += bonus;
    breakdown.push(`Focus chain +${bonus}`);
    if (peak === "normal") peak = "strong";
  }

  if (input.comebackBoost && input.comebackBoost > 0) {
    prestige += input.comebackBoost;
    breakdown.push(`Comeback +${input.comebackBoost}`);
  }

  // Diminishing punishment: never zero out learning reward entirely
  prestige = Math.max(8, prestige);
  return { prestige, label, peak, breakdown };
}

/** Micro-reward for a single correct beat (anticipation / partial reinforcement of skill). */
export function stepMicroReward(input: {
  combo: number;
  precisionMode: boolean;
  wasWrongBefore?: boolean;
}): { float: string; sfx: "tick" | "success" | "unlock" } {
  if (input.combo >= 5) {
    return { float: `Flow ×${input.combo}`, sfx: "success" };
  }
  if (input.combo >= 3) {
    return { float: `Focus ×${input.combo}`, sfx: "success" };
  }
  if (input.wasWrongBefore) {
    return { float: "Recovered", sfx: "tick" };
  }
  if (input.precisionMode) {
    return { float: "Stakes hold", sfx: "tick" };
  }
  return { float: "Unlocked", sfx: "tick" };
}

/** Session combo: only positive framing; break is silent */
export function comboLabel(combo: number): string | null {
  if (combo < 2) return null;
  if (combo < 4) return `Focus chain ×${combo}`;
  if (combo < 7) return `Flow chain ×${combo}`;
  return `Deep focus ×${combo}`;
}

/** Anticipation delay ms — longer under precision (Schultz prediction error window). */
export function anticipationMs(precisionMode: boolean, kind: "success" | "fail"): number {
  if (precisionMode) return kind === "success" ? 520 : 480;
  return kind === "success" ? 280 : 200;
}

/** Peak-end reveal copy after clear */
export function peakEndCopy(peak: "normal" | "strong" | "epic", prestige: number): {
  headline: string;
  sub: string;
} {
  if (peak === "epic") {
    return {
      headline: "Epic peak — precision mastery",
      sub: `+${prestige} prestige. That clean run is the feeling worth returning for.`,
    };
  }
  if (peak === "strong") {
    return {
      headline: "Strong clear",
      sub: `+${prestige} prestige. Peak-end locked — progress saved, next gate warm.`,
    };
  }
  return {
    headline: "Challenge cleared",
    sub: `+${prestige} prestige. Wrong moves taught; right moves advanced. Come back when ready.`,
  };
}
