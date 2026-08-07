/**
 * Comeback / risk-reward chrome — ethical only.
 * Science: goal gradient, Zeigarnik open loops, peak-end, optional stakes,
 * endowed rank progress, curiosity hooks. No shame streaks or FOMO punishment.
 */
import "./return-loop.css";

export interface ReturnLoopData {
  unfinishedChallengeId: string | null;
  unfinishedTitle: string | null;
  unfinishedStep: number;
  nextUnlockId: string | null;
  nextUnlockTitle: string | null;
  clearedCount: number;
  totalChallenges: number;
  goalGradient: number;
  stepsLeftInLoop?: number | null;
  nearMiss?: boolean;
  dailySeed: number;
  dailyLabel: string;
  curiosityHook?: string;
  comebackLine: string;
  ethicsLine: string;
  rankProgress?: {
    current: string;
    next: string | null;
    prestige: number;
    need: number;
    pct: number;
  };
  comebackBonusAvailable?: boolean;
  comebackBonusLabel?: string | null;
  stopHint?: string;
}

export function ReturnLoopBanner({
  data,
  onResume,
  onPlayNext,
  onCuriosity,
}: {
  data: ReturnLoopData;
  onResume?: () => void;
  onPlayNext?: () => void;
  onCuriosity?: () => void;
}) {
  const pct = Math.round((data.goalGradient || 0) * 100);
  const rankPct = Math.round((data.rankProgress?.pct ?? 0) * 100);
  return (
    <section
      className={`return-loop${data.nearMiss ? " near-miss" : ""}${data.unfinishedChallengeId ? " has-loop" : ""}`}
      aria-label="Comeback and progress"
    >
      <div className="return-loop-main">
        <div className="return-kicker">
          Return loop · goal gradient
          {data.nearMiss ? " · almost there" : ""}
          {data.comebackBonusAvailable ? " · soft comeback bonus" : ""}
        </div>
        <p className="return-line">{data.comebackLine}</p>
        <div className="return-bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="return-meta">
          <span>
            {data.clearedCount}/{data.totalChallenges} challenges
          </span>
          <span>{pct}% campaign</span>
          <span className="daily-pill">{data.dailyLabel}</span>
          {data.stepsLeftInLoop != null && data.unfinishedChallengeId && (
            <span className="loop-pill">
              {data.stepsLeftInLoop} beat{data.stepsLeftInLoop === 1 ? "" : "s"} left in open loop
            </span>
          )}
        </div>

        {data.rankProgress && (
          <div className="rank-strip">
            <div className="rank-labels">
              <span>{data.rankProgress.current}</span>
              {data.rankProgress.next ? (
                <span className="muted">
                  → {data.rankProgress.next} ({data.rankProgress.need} pr)
                </span>
              ) : (
                <span className="muted">Peak rank (sim evidence)</span>
              )}
            </div>
            <div className="return-bar rank-bar" aria-hidden>
              <i style={{ width: `${rankPct}%` }} />
            </div>
          </div>
        )}

        {data.curiosityHook && (
          <p className="curiosity-hook">
            <span className="return-kicker">Today’s curiosity</span>
            {data.curiosityHook}
          </p>
        )}

        <div className="action-row">
          {data.unfinishedChallengeId && onResume && (
            <button type="button" className="btn primary pulse-cta" onClick={onResume}>
              Resume open loop
            </button>
          )}
          {data.nextUnlockId && onPlayNext && (
            <button type="button" className="btn violet" onClick={onPlayNext}>
              {data.nearMiss ? "Close the gap" : "Play next unlock"}
            </button>
          )}
          {data.curiosityHook && onCuriosity && (
            <button type="button" className="btn" onClick={onCuriosity}>
              Chase curiosity
            </button>
          )}
        </div>
      </div>
      <p className="return-ethics">{data.ethicsLine}</p>
    </section>
  );
}

export function AnticipationOverlay({
  open,
  label,
}: {
  open: boolean;
  label: string;
}) {
  if (!open) return null;
  return (
    <div className="anticipation" role="status" aria-live="polite">
      <div className="anticipation-ring" />
      <span>{label}</span>
    </div>
  );
}

export function ComboBadge({ combo }: { combo: number }) {
  if (combo < 2) return null;
  const label =
    combo < 4 ? `Focus ×${combo}` : combo < 7 ? `Flow ×${combo}` : `Deep focus ×${combo}`;
  return (
    <div className={`combo-badge combo-${Math.min(combo, 9)}`} aria-live="polite">
      {label}
    </div>
  );
}

export function PrecisionToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`precision-toggle${on ? " on" : ""}`}
      onClick={onToggle}
      aria-pressed={on}
      title="Optional stakes: higher prestige if clean; reduced if many wrongs. Never loses your unlock progress."
    >
      <span className="pt-dot" />
      {on ? "Precision ON — stakes active" : "Precision OFF — safe run"}
    </button>
  );
}

export function FloatReward({ text, keyId }: { text: string; keyId: number }) {
  return (
    <div key={keyId} className="float-reward" aria-hidden>
      {text}
    </div>
  );
}

export function PeakReveal({
  open,
  peak,
  headline,
  sub,
  breakdown,
}: {
  open: boolean;
  peak: "normal" | "strong" | "epic";
  headline: string;
  sub: string;
  breakdown?: string[];
}) {
  if (!open) return null;
  return (
    <div className={`peak-reveal peak-${peak}`} role="status">
      <div className="peak-burst" aria-hidden />
      <div className="peak-card">
        <div className="return-kicker">{peak} peak</div>
        <h3>{headline}</h3>
        <p>{sub}</p>
        {breakdown && breakdown.length > 0 && (
          <ul className="peak-breakdown">
            {breakdown.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
