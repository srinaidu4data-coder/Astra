import type { StepCheck } from "@btp-odyssey/shared";

export interface CheckAttempt {
  selectedOptionIds?: string[];
  shortText?: string;
  orderedIds?: string[];
}

export interface CheckResult {
  passed: boolean;
  score: number;
  feedback: string[];
  explanation: string;
  correctOptionIds: string[];
}

export function evaluateStepCheck(
  check: StepCheck,
  attempt: CheckAttempt,
): CheckResult {
  const correctOptionIds = check.options.filter((o) => o.correct).map((o) => o.id);
  const feedback: string[] = [];

  if (check.type === "mc" || check.type === "multi") {
    const selected = new Set(attempt.selectedOptionIds ?? []);
    const correct = new Set(correctOptionIds);
    let hits = 0;
    let wrong = 0;
    for (const id of selected) {
      const opt = check.options.find((o) => o.id === id);
      if (!opt) continue;
      feedback.push(opt.feedback);
      if (opt.correct) hits += 1;
      else wrong += 1;
    }
    for (const id of correct) {
      if (!selected.has(id)) {
        const opt = check.options.find((o) => o.id === id);
        if (opt) feedback.push(`Missed: ${opt.feedback}`);
      }
    }
    const denom = Math.max(correct.size + wrong, 1);
    const score = Math.max(0, (hits - wrong * 0.5) / denom);
    const passed = score >= (check.passScore ?? 1) && wrong === 0 && hits === correct.size;
    return {
      passed,
      score: Math.min(1, Math.max(0, score)),
      feedback: feedback.length ? feedback : [check.explanation],
      explanation: check.explanation,
      correctOptionIds,
    };
  }

  if (check.type === "short") {
    const text = (attempt.shortText ?? "").toLowerCase();
    const keys = check.acceptKeywords;
    const hits = keys.filter((k) => text.includes(k.toLowerCase())).length;
    const score = keys.length ? hits / keys.length : text.trim() ? 0.5 : 0;
    const passed = score >= (check.passScore ?? 0.6);
    feedback.push(
      passed
        ? "Your wording covers the key ideas."
        : `Include more of: ${keys.join(", ")}`,
    );
    feedback.push(check.explanation);
    return { passed, score, feedback, explanation: check.explanation, correctOptionIds };
  }

  if (check.type === "order") {
    const ordered = attempt.orderedIds ?? [];
    const expected = check.options.map((o) => o.id);
    let match = 0;
    for (let i = 0; i < expected.length; i++) {
      if (ordered[i] === expected[i]) match += 1;
    }
    const score = expected.length ? match / expected.length : 0;
    const passed = score >= (check.passScore ?? 1);
    feedback.push(passed ? "Order is correct." : "Sequence still off — rethink dependencies.");
    feedback.push(check.explanation);
    return { passed, score, feedback, explanation: check.explanation, correctOptionIds: expected };
  }

  return {
    passed: false,
    score: 0,
    feedback: [check.explanation],
    explanation: check.explanation,
    correctOptionIds,
  };
}
